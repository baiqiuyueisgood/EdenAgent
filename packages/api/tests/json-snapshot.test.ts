import assert from 'node:assert/strict'
import test from 'node:test'
import { jsonSnapshot } from '../src/json-snapshot.ts'

test('stream snapshots own mutable containers and preserve message/partial aliases without serializing text', () => {
  const text = '文'.repeat(1_000_000)
  const message = { content: [{ text }], ignored: undefined }
  const original = { message, partial: message }
  const snapshot = jsonSnapshot(original) as unknown as typeof original
  message.content[0]!.text = 'changed'
  assert.equal(snapshot.message.content[0]!.text, text)
  assert.equal(snapshot.partial, snapshot.message)
  assert.notEqual(snapshot.message, message)
  assert.equal(Object.hasOwn(snapshot.message, 'ignored'), false)
})

test('JSON values, toJSON, omissions, boxed primitives and nonfinite numbers keep JSON semantics', () => {
  const samples = [null, false, 0, NaN, Infinity, 'a\n\\n', [undefined, , NaN, () => 1, Symbol('x')],
    { undefined: undefined, ignored: () => 1, number: NaN, date: new Date(0), nested: { yes: true } },
    { first: { toJSON(key: string) { return key } } }, new Number(2), new String('abc'), new Boolean(false)]
  for (const value of samples) assert.deepEqual(jsonSnapshot(value), JSON.parse(JSON.stringify(value)))
  for (const value of [undefined, Symbol('x'), () => 1, 1n, Object(1n)]) assert.throws(() => jsonSnapshot(value), TypeError)
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
  assert.throws(() => jsonSnapshot(cyclic), /Cyclic/)
})

test('JSON prototype-like fields are data and never alter container prototypes', () => {
  const original = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"yes":true}}}')
  const snapshot = jsonSnapshot(original)
  assert.deepEqual(snapshot, original)
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype)
  assert.equal('polluted' in {}, false)
})
