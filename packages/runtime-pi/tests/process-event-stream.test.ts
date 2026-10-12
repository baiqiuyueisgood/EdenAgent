import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate, setTimeout as delay } from 'node:timers/promises'
import type { JsonValue } from '@eden/api'
import { ProcessEventStream } from '../src/process-event-stream.ts'

function update(text: string, delta = text.at(-1)!, type = 'text_delta', contentIndex = 0) {
  const message = { role: 'assistant', content: [{ type: 'text', text }] }
  return { messageId: 'message', message, assistantMessageEvent: { type, contentIndex, delta, partial: message } }
}

function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('1000 deltas continue while ACK is held, one flight and one pending batch preserve all characters', async () => {
  const gate = deferred(), sent: { payload: JsonValue; coalesced: boolean }[] = []
  let concurrent = 0, maximum = 0
  const stream = new ProcessEventStream(async (_kind, payload, coalesced) => {
    concurrent++; maximum = Math.max(maximum, concurrent)
    sent.push({ payload, coalesced })
    if (sent.length === 1) await gate.promise
    concurrent--
  }, { intervalMs: 10 })
  stream.begin()
  for (let index = 1; index <= 1000; index++) await stream.event('message_update', update('x'.repeat(index), 'x'))
  assert.equal(sent.length, 1, 'Raw deltas must not await one RPC ACK each')
  let drained = false
  const finish = stream.finish().then(() => { drained = true })
  await setImmediate()
  assert.equal(drained, false, 'Finish remains a durable boundary')
  gate.resolve(); await finish
  assert.equal(sent.length, 2)
  assert.equal(maximum, 1)
  assert.ok(sent.every(item => item.coalesced))
  assert.equal(sent.map(item => (item.payload as ReturnType<typeof update>).assistantMessageEvent.delta).join(''), 'x'.repeat(1000))
  assert.deepEqual(sent[1]!.payload, update('x'.repeat(1000), 'x'.repeat(999)))
  await delay(25)
  assert.equal(sent.length, 2, 'No timer writes after finish')
})

test('timer publishes the last pending update without another SDK event and owns an immutable snapshot', async () => {
  const sent: JsonValue[] = []
  const stream = new ProcessEventStream(async (_kind, payload) => { sent.push(payload) }, { intervalMs: 10 })
  stream.begin()
  await stream.event('message_update', update('a'))
  await setImmediate()
  const payload = update('ab')
  await stream.event('message_update', payload)
  payload.message.content[0]!.text = 'later SDK mutation'
  payload.assistantMessageEvent.delta = 'incorrect'
  await delay(30)
  assert.equal(sent.length, 2)
  assert.deepEqual(sent[1], update('ab'))
  await stream.finish()
  await assert.rejects(stream.event('message_update', update('late')), /finished runtime/)
  stream.begin()
  await stream.event('message_update', update('new turn'))
  await stream.finish()
  assert.equal(sent.length, 3)
})

test('large accumulated snapshots still merge small deltas instead of forcing per-character ACKs', async () => {
  const gate = deferred(), sent: JsonValue[] = []
  const stream = new ProcessEventStream(async (_kind, payload) => {
    sent.push(payload)
    if (sent.length === 1) await gate.promise
  })
  stream.begin()
  const prefix = 'h'.repeat(300 * 1024)
  for (let index = 1; index <= 8; index++) await stream.event('message_update', update(prefix + 'x'.repeat(index), 'x'))
  assert.equal(sent.length, 1)
  gate.resolve(); await stream.finish()
  assert.equal(sent.length, 2)
  assert.equal((sent[1] as ReturnType<typeof update>).assistantMessageEvent.delta, 'x'.repeat(7))
})

for (const boundary of ['message_end', 'agent_end', 'error', 'message_start', 'tool_execution_start']) {
  test(`${boundary} waits for the final batch before publishing its semantic event`, async () => {
    const gate = deferred(), sent: string[] = []
    const stream = new ProcessEventStream(async kind => {
      sent.push(kind)
      if (sent.length === 1) await gate.promise
    })
    stream.begin()
    await stream.event('message_update', update('a'))
    await stream.event('message_update', update('ab'))
    const ending = stream.event(boundary, { reason: 'fixture' })
    await setImmediate()
    assert.deepEqual(sent, ['message_update'])
    gate.resolve(); await ending; await stream.finish()
    assert.deepEqual(sent, ['message_update', 'message_update', boundary])
  })
}

test('message, actor, delta type and block changes never merge incompatible streams', async () => {
  const sent: JsonValue[] = []
  const stream = new ProcessEventStream(async (_kind, payload) => { sent.push(payload) })
  stream.begin()
  await stream.event('message_update', update('a'))
  await stream.event('message_update', update('ab'))
  await stream.event('message_update', update('thinking', 'think', 'thinking_delta'))
  await stream.event('message_update', update('thinking more', ' more', 'thinking_delta'))
  await stream.event('message_update', update('arguments', '{', 'toolcall_delta', 1))
  await stream.event('message_update', { ...update('second'), messageId: 'second' })
  await stream.event('message_update', { ...update('actor'), messageId: 'second', actor: { assistantID: 'other' } })
  await stream.finish()
  assert.equal(sent.length, 7)
  assert.deepEqual(sent[1], update('ab'))
  assert.deepEqual(sent[3], update('thinking more', ' more', 'thinking_delta'))
})

for (const limit of [{ maxPendingUpdates: 2 }, { maxPendingBytes: 1 }]) {
  test(`pending limit ${JSON.stringify(limit)} applies backpressure rather than dropping input`, async () => {
    const gate = deferred(), sent: JsonValue[] = []
    const stream = new ProcessEventStream(async (_kind, payload) => {
      sent.push(payload)
      if (sent.length === 1) await gate.promise
    }, limit)
    stream.begin()
    let completed = false
    const work = (async () => {
      await stream.event('message_update', update('中', '中'))
      await stream.event('message_update', update('中文', '文'))
      await stream.event('message_update', update('中文好', '好'))
      completed = true
    })()
    await setImmediate()
    assert.equal(completed, false)
    assert.equal(sent.length, 1)
    gate.resolve(); await work; await stream.finish()
    assert.equal(sent.map(payload => (payload as ReturnType<typeof update>).assistantMessageEvent.delta).join(''), '中文好')
  })
}

test('background failure aborts the owner once, retains the durable error and prevents tools or retries', async () => {
  const gate = deferred(), error = new Error('fixture durable failure'), sent: string[] = [], failures: unknown[] = []
  const stream = new ProcessEventStream(async kind => { sent.push(kind); await gate.promise }, {}, value => { failures.push(value) })
  stream.begin()
  await stream.event('message_update', update('a'))
  await stream.event('message_update', update('ab'))
  gate.reject(error)
  await setImmediate()
  assert.deepEqual(failures, [error])
  await assert.rejects(stream.event('tool_execution_start', {}), value => value === error)
  await assert.rejects(stream.finish(), value => value === error)
  assert.throws(() => stream.begin(), value => value === error)
  await delay(110)
  assert.deepEqual(sent, ['message_update'])
})

test('host shutdown discards unsent data and clears timers instead of writing after disposal', async () => {
  const sent: JsonValue[] = []
  const stream = new ProcessEventStream(async (_kind, payload) => { sent.push(payload) }, { intervalMs: 10 })
  stream.begin()
  await stream.event('message_update', update('a'))
  await setImmediate()
  await stream.event('message_update', update('ab'))
  stream.stop(new Error('fixture disconnected'))
  await delay(30)
  assert.equal(sent.length, 1)
  await assert.rejects(stream.flush(), /disconnected/)
})

test('work and final persistence failures are both preserved without replay', async () => {
  const gate = deferred(), writeError = new Error('write failure'), workError = new Error('model failure')
  const stream = new ProcessEventStream(async () => gate.promise)
  const task = stream.run(async () => {
    await stream.event('message_update', update('a'))
    throw workError
  })
  const failure = assert.rejects(task, error => error instanceof AggregateError && error.errors[0] === workError && error.errors[1] === writeError)
  await setImmediate(); gate.reject(writeError); await failure
})
