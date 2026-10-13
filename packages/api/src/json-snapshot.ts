import type { JsonValue } from './json.ts'

/** JSON semantics with owned containers, shared immutable strings and preserved aliases. */
export function jsonSnapshot(value: unknown): JsonValue {
  const result = new Snapshot().copy(value, '')
  if (result === undefined) throw new TypeError('Value cannot be represented in JSON')
  return result
}

function normalize(raw: unknown, key: string): unknown {
  const value = raw && (typeof raw === 'object' || typeof raw === 'function') && 'toJSON' in raw && typeof raw.toJSON === 'function' ? raw.toJSON(key) : raw
  if (value instanceof Number || value instanceof String || value instanceof Boolean) return value.valueOf()
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === BigInt.prototype) return value.valueOf()
  return value
}

function primitive(value: unknown): JsonValue | undefined {
  if (value === null) return null
  switch (typeof value) {
    case 'string': case 'boolean': return value
    case 'number': return Number.isFinite(value) ? value : null
    case 'bigint': throw new TypeError('BigInt cannot be represented in JSON')
    default: return undefined
  }
}

class Snapshot {
  private readonly copies = new WeakMap<object, JsonValue>()
  private readonly active = new WeakSet<object>()

  copy(raw: unknown, key: string): JsonValue | undefined {
    const value = normalize(raw, key)
    if (!value || typeof value !== 'object') return primitive(value)
    if (this.active.has(value)) throw new TypeError('Cyclic value cannot be represented in JSON')
    const known = this.copies.get(value)
    if (known !== undefined) return known
    const result: JsonValue[] | Record<string, JsonValue> = Array.isArray(value) ? [] : {}
    this.copies.set(value, result)
    this.active.add(value)
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) (result as JsonValue[]).push(this.copy(value[index], String(index)) ?? null)
    } else this.fields(value, result as Record<string, JsonValue>)
    this.active.delete(value)
    return result
  }

  private fields(value: object, result: Record<string, JsonValue>): void {
    for (const name of Object.keys(value)) {
      const field = this.copy((value as Record<string, unknown>)[name], name)
      if (field !== undefined) Object.defineProperty(result, name, { value: field, enumerable: true, configurable: true, writable: true })
    }
  }
}
