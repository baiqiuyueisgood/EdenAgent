import assert from 'node:assert/strict'
import test from 'node:test'
import { InMemorySessionStorage, Session } from '@earendil-works/pi-agent-core'
import { toJson } from '@eden/api'
import type { JsonValue, RuntimeCheckpoint } from '@eden/api'
import { removeCheckpointMessages, assertRuntimeCheckpoint } from '../src/index.ts'
import { parseCheckpoint } from '../src/checkpoint-schema.ts'

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
const assistant = (content: JsonValue[]) => ({ role: 'assistant', content, timestamp: 1000,
  api: 'openai-completions', provider: 'recorded', model: 'recorded', stopReason: 'stop', usage })
const entry = (id: string, parentId: string | null, fields: Record<string, JsonValue>) => (
  { id, parentId, timestamp: '2026-01-01T00:00:00Z', ...fields }
)
const checkpoint = (entries: JsonValue[]): RuntimeCheckpoint => ({ format: 'eden.pi-harness.v1', runtimeVersion: '0.82.0',
  sessionId: 'fixture', createdAt: '2026-01-01T00:00:00Z', entries })
const deletion = (id: string) => ({ matchesMessage: (_: JsonValue, entryId: string) => entryId === id,
  projectHistory: (values: JsonValue[]) => values, invalidateSummariesBefore: Date.parse('2026-02-01T00:00:00Z') })

async function context(snapshot: RuntimeCheckpoint) {
  assertRuntimeCheckpoint(snapshot, snapshot.sessionId)
  const storage = new InMemorySessionStorage({ metadata: { id: snapshot.sessionId, createdAt: snapshot.createdAt },
    entries: parseCheckpoint(snapshot, snapshot.sessionId) })
  return (await new Session(storage).buildContext()).messages
}

test('legacy identities reject ambiguity and their deletion keys prevent a later variant from matching another answer', async () => {
  const original = checkpoint([
    entry('old', null, { type: 'message', message: assistant([{ type: 'text', text: 'OLD_BODY' }]) }),
    entry('other', 'old', { type: 'message', message: assistant([{ type: 'text', text: 'OTHER_BODY' }]) }),
  ])
  const old = original.entries[0] as { message: JsonValue }, other = original.entries[1] as { message: JsonValue }
  const options = { ...deletion('missing'), legacyMessages: [{ key: 'original-event', messages: [old.message] }] }
  const projected = removeCheckpointMessages(original, options)
  const retried = removeCheckpointMessages(projected, { ...options,
    legacyMessages: [{ key: 'original-event', messages: [old.message, other.message] }] })
  assert.equal(retried, projected)
  assert.match(JSON.stringify(await context(retried)), /OTHER_BODY/)
  assert.doesNotMatch(JSON.stringify(retried), /OLD_BODY/)
  const duplicate = checkpoint([...original.entries, entry('duplicate', 'other', { type: 'message', message: old.message })])
  assert.throws(() => removeCheckpointMessages(duplicate, options), /uniquely locate/)
})

test('redaction keeps branch, label and leaf identities while removing a selected message and its tool receipt', async () => {
  const original = checkpoint([
    entry('user', null, { type: 'message', message: { role: 'user', content: 'USER_PRESERVED', timestamp: 1 } }),
    entry('answer', 'user', { type: 'message', message: assistant([{ type: 'text', text: 'DELETED_BODY' },
      { type: 'toolCall', id: 'call', name: 'echo', arguments: { text: 'DELETED_ARGUMENT' } }]) }),
    entry('receipt', 'answer', { type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'DELETED_RECEIPT' }],
      toolCallId: 'call', toolName: 'echo', isError: false, timestamp: 2 } }),
    entry('kept', 'receipt', { type: 'message', message: assistant([{ type: 'text', text: 'KEPT_BODY' }]) }),
    entry('label', 'kept', { type: 'label', targetId: 'answer', label: 'history' }),
    entry('leaf', 'label', { type: 'leaf', targetId: 'kept' }),
  ])
  const projected = removeCheckpointMessages(original, deletion('answer'))
  assert.deepEqual(projected.entries.map(value => (value as { id: string }).id), ['user', 'answer', 'receipt', 'kept', 'label', 'leaf'])
  assert.doesNotMatch(JSON.stringify(projected), /DELETED_BODY|DELETED_ARGUMENT|DELETED_RECEIPT/)
  assert.match(JSON.stringify(original), /DELETED_BODY/)
  const messages = await context(projected)
  assert.match(JSON.stringify(messages), /USER_PRESERVED|KEPT_BODY/)
  assert.equal(messages.length, 2)
})

test('a repeated tool call ID does not remove the receipt belonging to a different assistant entry', async () => {
  const call = { type: 'toolCall', id: 'same-call', name: 'echo', arguments: {} }
  const receipt = (text: string) => ({ role: 'toolResult', content: [{ type: 'text', text }],
    toolCallId: 'same-call', toolName: 'echo', isError: false, timestamp: 2 })
  const projected = removeCheckpointMessages(checkpoint([
    entry('one', null, { type: 'message', message: assistant([call]) }),
    entry('receipt-one', 'one', { type: 'message', message: receipt('REMOVED_RESULT') }),
    entry('two', 'receipt-one', { type: 'message', message: assistant([call]) }),
    entry('receipt-two', 'two', { type: 'message', message: receipt('KEPT_RESULT') }),
  ]), deletion('one'))
  assert.doesNotMatch(JSON.stringify(projected), /REMOVED_RESULT/)
  assert.match(JSON.stringify(projected), /KEPT_RESULT/)
  const messages = await context(projected)
  assert.equal(messages.length, 2)
  assert.equal(messages[0]?.role, 'assistant')
  assert.equal(messages[1]?.role, 'toolResult')
})

test('old compaction and branch summaries are discarded, while a new clean compaction can be retained', async () => {
  const original = checkpoint([
    entry('user', null, { type: 'message', message: { role: 'user', content: 'ORIGINAL_USER', timestamp: 1 } }),
    entry('answer', 'user', { type: 'message', message: assistant([{ type: 'text', text: 'REMOVED_TEXT' }]) }),
    entry('kept', 'answer', { type: 'message', message: assistant([{ type: 'text', text: 'RETAINED_TEXT' }]) }),
    entry('compact', 'kept', { type: 'compaction', summary: 'OLD_COMPACT_REMOVED_TEXT', tokensBefore: 100,
      firstKeptEntryId: 'kept' }),
    entry('branch', 'compact', { type: 'branch_summary', fromId: 'answer', summary: 'OLD_BRANCH_REMOVED_TEXT' }),
  ])
  const projected = removeCheckpointMessages(original, deletion('answer'))
  const messages = await context(projected)
  assert.doesNotMatch(JSON.stringify(projected), /REMOVED_TEXT|OLD_COMPACT|OLD_BRANCH/)
  assert.match(JSON.stringify(messages), /ORIGINAL_USER|RETAINED_TEXT/)
  const clean = { ...projected, entries: [...projected.entries, toJson({ type: 'compaction', id: 'new-summary', parentId: 'branch',
    timestamp: '2026-03-01T00:00:00Z', summary: 'CLEAN_NEW_SUMMARY', tokensBefore: 100 })] }
  const repeated = removeCheckpointMessages(clean, deletion('answer'))
  assert.equal(repeated, clean)
  assert.match(JSON.stringify(await context(repeated)), /CLEAN_NEW_SUMMARY/)
})

test('malformed stored handoff context fails rather than falling back to its raw contents', () => {
  const original = checkpoint([entry('handoff', null, { type: 'custom_message', customType: 'eden.public_handoff_history',
    display: false, content: 'broken stored context' })])
  assert.throws(() => removeCheckpointMessages(original, deletion('missing')), /invalid wrapper/)
})
