import { isDeepStrictEqual } from 'node:util'
import { toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core'

export interface LegacyContextDeletion {
  key: string
  messages: JsonValue[]
}

function sameMessage(message: JsonValue, original: JsonValue): boolean {
  if (!message || !original || typeof message !== 'object' || typeof original !== 'object'
    || Array.isArray(message) || Array.isArray(original)) return false
  return message.timestamp === original.timestamp && isDeepStrictEqual(message.content, original.content)
}

/** Legacy matching is exact, including known privacy projections; ambiguous identities fail closed. */
export function legacyContextEntries(entries: SessionTreeEntry[], targets: LegacyContextDeletion[]): Map<string, string> {
  const removed = new Map<string, string>()
  for (const target of targets) {
    if (entries.some(entry => entry.type === 'custom' && entry.customType === 'eden.deleted_context'
      && (entry.data as { deletionKey?: string } | undefined)?.deletionKey === target.key)) continue
    const matches = entries.filter(entry => entry.type === 'message' && entry.message.role === 'assistant'
      && target.messages.some(message => sameMessage(toJson(entry.message), message)))
    if (matches.length > 1) throw new Error('Cannot uniquely locate deleted legacy assistant context')
    if (matches[0]) removed.set(matches[0].id, target.key)
  }
  return removed
}
