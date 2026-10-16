// Read-only operational diagnosis. Never emit memory content or credentials.
import { DatabaseSync } from 'node:sqlite'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { credentialValues } from '../../packages/api/src/credential-redaction.ts'
const directory = path.resolve('Data/realms/mon/accounts')
const candidates = []
for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const filename = path.join(directory, entry.name, 'storage/eden-agent.db')
  let db
  try {
    db = new DatabaseSync(filename, { readOnly: true })
    const latest = db.prepare("SELECT s.id,s.title,s.updated_at FROM sessions s JOIN session_classification c ON s.id=c.session_id WHERE c.source_channel='app' AND c.purpose='user_chat' AND s.status!='deleted' ORDER BY s.updated_at DESC LIMIT 1").get()
    if (!latest) continue
    const memories = db.prepare('SELECT id,scope_key,content,updated_at FROM memories WHERE id=30').all()
    const event = db.prepare("SELECT payload_json FROM events WHERE session_id=? AND kind IN ('session.created','session.metadata.updated') ORDER BY seq DESC LIMIT 1").get(latest.id)
    const metadata = JSON.parse(event?.payload_json ?? '{}')
    candidates.push({ database: filename, latest: { id: latest.id, title: latest.title, updatedAt: latest.updated_at, participants: metadata.participants?.map(item => ({ assistantId: item.assistantId, characterId: item.characterId, name: item.characterName })) }, memories: memories.map(row => ({ id: row.id, scopeKey: row.scope_key, updatedAt: row.updated_at, containsCredential: credentialValues(row.content).length > 0 })) })
  } catch (error) { console.log(JSON.stringify({ accountDirectory: entry.name, error: error.message })) }
  finally { db?.close() }
}
candidates.sort((a,b) => b.latest.updated_at-a.latest.updated_at)
console.log(JSON.stringify(candidates, null, 2))
