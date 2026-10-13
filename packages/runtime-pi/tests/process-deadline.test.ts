import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { ProcessDeadline } from '../src/process-deadline.ts'

test('wall clock changes cannot expire a monotonic deadline early', async t => {
  let expired = 0
  const deadline = new ProcessDeadline(() => 500, () => expired++, 20)
  t.after(() => deadline.stop())
  t.mock.method(Date, 'now', () => 9e15)
  await delay(150)
  assert.equal(expired, 0)
})

test('a paused host drains pending activity before expiry and stop owns its confirmation timers', async t => {
  let expired = 0
  const deadline = new ProcessDeadline(() => 100, () => expired++, 20)
  t.after(() => deadline.stop())
  const started = performance.now()
  while (performance.now() - started < 300) { /* Simulate synchronous host work, not a stalled child. */ }
  setImmediate(() => deadline.touch())
  await delay(80)
  assert.equal(expired, 0)
  deadline.stop()
  await delay(350)
  assert.equal(expired, 0)
})

test('no-activity child receives bounded grace and expires once, including after host stalls', async t => {
  let expired = 0
  const deadline = new ProcessDeadline(() => 50, () => expired++, 20)
  t.after(() => deadline.stop())
  await delay(450)
  assert.equal(expired, 1)
  await delay(50)
  assert.equal(expired, 1)
  let pausedExpired = 0
  const paused = new ProcessDeadline(() => 50, () => pausedExpired++, 20)
  t.after(() => paused.stop())
  const started = performance.now()
  while (performance.now() - started < 200) { /* Host pause grants one grace, never another full deadline. */ }
  await delay(1250)
  assert.equal(pausedExpired, 1)
})
