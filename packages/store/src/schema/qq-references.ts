/** Platform identifiers stay private; model-facing references are scoped to a session and bot binding. */
export const qqReferencesSchema = `
CREATE TABLE qq_action_references(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id), scope TEXT NOT NULL,
  kind TEXT NOT NULL, value_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(session_id,scope,kind,value_json)
);
CREATE INDEX qq_action_references_scope ON qq_action_references(session_id,scope);
`
