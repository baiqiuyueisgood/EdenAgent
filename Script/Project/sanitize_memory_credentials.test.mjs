import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../../Server/src/modules/sessions/index.ts'
import { MemoryRepository } from '../../Server/src/modules/memories/index.ts'
import { sanitizeMemory } from './sanitize_memory_credentials.mjs'

test('maintenance cleanup preserves request hashes and compressed stream replay using synthetic account data only', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-credential-cleanup-')), filename = path.join(root, 'fixture.db')
  const db = new EdenDatabase(filename, 'mon'), sessions = new SessionRepository(db, 'mon'), accountKey = '["http://fixture.invalid/","1"]'
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }) })
  db.connection.prepare("INSERT INTO realm_meta(key,value) VALUES('account_key',?)").run(accountKey)
  const session = sessions.create('Synthetic cleanup', [{ assistantId: 1, characterId: 7 }])
  const memories = new MemoryRepository(db), memory = memories.create({ scopeType: 'agent_character', scopeKey: '7' }, 'ordinary', 'fact', session.id)
  const ordinary = memories.create({ scopeType: 'agent_character', scopeKey: '7' }, '{ "unrelated": "user text" }', 'fact', session.id)
  const secret = 'cleanup-fixture-only-password'
  db.connection.prepare('UPDATE memories SET content=? WHERE id=?').run(`sudo 密码是 ${secret}`, memory.id)
  let text = ''
  for (const piece of ['说明密码：', 'cleanup-fixture-', 'only-password', ' 后续文字']) {
    text += piece
    sessions.events.append(session.id, null, 'agent.message_update', { messageId: 'stream-id', message: { role: 'assistant', content: [{ type: 'text', text }] },
      assistantMessageEvent: { type: 'text_delta', delta: piece, partial: { role: 'assistant', content: [{ type: 'text', text }] } } })
  }
  const message = { role: 'tool', content: `sudo 密码是 ${secret} ` + 'context '.repeat(120) }
  sessions.events.append(session.id, null, 'model.request', { requestId: 'request-id', payload: { messages: [message] } })
  const args = { filename, sessionId: session.id, characterId: 7, memoryId: memory.id, expectedUpdatedAt: memory.updatedAt }
  const original = db.connection.prepare('SELECT content FROM memories WHERE id=?').get(memory.id).content
  const plan = sanitizeMemory(args)
  assert.equal(plan.applied, false); assert.ok(plan.maskedRows > 0); assert.ok(plan.requestContents > 0)
  assert.equal(db.connection.prepare('SELECT content FROM memories WHERE id=?').get(memory.id).content, original)
  assert.throws(() => sanitizeMemory({ ...args, expectedUpdatedAt: 0, apply: true }), /version/)
  const result = sanitizeMemory({ ...args, apply: true })
  assert.equal(result.applied, true)
  const restored = new SessionRepository(db, 'mon').events.list(session.id, '0', 1000)
  assert.doesNotMatch(JSON.stringify(restored), new RegExp(secret))
  assert.doesNotMatch(JSON.stringify(db.connection.prepare('SELECT content_json FROM request_contents').all()), new RegExp(secret))
  assert.doesNotMatch(JSON.stringify(db.connection.prepare('SELECT payload_json FROM events').all()), /cleanup-fixture-|only-password/)
  assert.ok(restored.some(event => event.kind === 'model.request'))
  assert.match(memories.read({ scopeType: 'agent_character', scopeKey: '7' }, memory.id).content, /老师保管/)
  assert.equal(memories.read({ scopeType: 'agent_character', scopeKey: '7' }, ordinary.id).content, ordinary.content)
})
