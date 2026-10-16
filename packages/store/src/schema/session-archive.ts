/** Archive is an independent, reversible session property; lifecycle and inputs stay intact. */
export const sessionArchiveSchema = `
CREATE TABLE session_archives (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
`
