/** A role owns its autonomous clock; execution sessions and legacy plans remain auditable. */
export const selfAwakeRoleSchema = `
CREATE TABLE self_awake_role_scopes (
  scope_key TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  character_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE self_awake_role_members (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  scope_key TEXT NOT NULL REFERENCES self_awake_role_scopes(scope_key),
  retired INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX self_awake_role_members_scope ON self_awake_role_members(scope_key);
CREATE TABLE self_awake_merged_plans (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  scope_key TEXT NOT NULL REFERENCES self_awake_role_scopes(scope_key),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  due_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  merged_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE TRIGGER self_awake_role_pending_insert BEFORE INSERT ON jobs
WHEN NEW.kind='self_awake' AND NEW.state='queued' AND json_extract(NEW.payload_json,'$.roleScope') IS NOT NULL BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE kind='self_awake' AND state='queued'
    AND json_extract(payload_json,'$.roleScope')=json_extract(NEW.payload_json,'$.roleScope'))
    THEN RAISE(ABORT,'Role already has a pending self-awake plan') END;
END;
CREATE TRIGGER self_awake_role_pending_update BEFORE UPDATE OF state,payload_json ON jobs
WHEN NEW.kind='self_awake' AND NEW.state='queued' AND json_extract(NEW.payload_json,'$.roleScope') IS NOT NULL BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE id!=NEW.id AND kind='self_awake' AND state='queued'
    AND json_extract(payload_json,'$.roleScope')=json_extract(NEW.payload_json,'$.roleScope'))
    THEN RAISE(ABORT,'Role already has a pending self-awake plan') END;
END;
`
