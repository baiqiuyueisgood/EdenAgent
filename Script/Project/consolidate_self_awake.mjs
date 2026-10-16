import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { EdenDatabase } from '../../packages/store/src/database.ts'
import { SessionRepository } from '../../Server/src/modules/sessions/index.ts'
import { JobRepository } from '../../Server/src/modules/jobs/index.ts'
import { SelfAwakeRepository } from '../../Server/src/modules/self-awake/index.ts'

function snapshot(db) {
  const account = db.prepare("SELECT value FROM realm_meta WHERE key='account_key'").get()?.value
  if (typeof account !== 'string' || db.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== 'mon') throw new Error('Requires an account-bound Mon database')
  const background = db.prepare(`SELECT s.id,s.status,s.updated_at,o.account_key,
    (SELECT payload_json FROM events WHERE session_id=s.id AND kind IN ('session.created','session.metadata.updated') ORDER BY seq DESC LIMIT 1) AS metadata
    FROM sessions s JOIN session_classification c ON c.session_id=s.id LEFT JOIN session_owners o ON o.session_id=s.id
    WHERE c.purpose='self_awake' ORDER BY s.id`).all()
  if (background.some(row => row.account_key !== account)) throw new Error('Background ownership requires manual reconciliation')
  const pending = db.prepare("SELECT id,session_id,due_at,payload_json,state,updated_at FROM jobs WHERE kind='self_awake' AND state IN ('queued','running','dispatched','unknown') ORDER BY id").all()
  const busy = Boolean(db.prepare("SELECT 1 FROM inputs WHERE state IN ('running','queued') LIMIT 1").get()
    || db.prepare("SELECT 1 FROM self_awake_runs WHERE state IN ('preparing','running','awaiting_action','action_running','action_interrupted') LIMIT 1").get()
    || pending.some(row => row.state !== 'queued'))
  const fingerprint = createHash('sha256').update(JSON.stringify({ account, background, pending, busy })).digest('hex')
  return { account, fingerprint, busy, backgroundSessions: background.filter(row => row.status === 'active').length,
    pendingWakePlans: pending.filter(row => row.state === 'queued').length }
}

/** Authorized maintenance only: exact account snapshot, idle runtime, transactional merge, no model invocation. */
export function consolidateSelfAwake({ filename, schedulerState, apply = false, expectedFingerprint }) {
  const reader = new DatabaseSync(filename, { readOnly: true })
  let plan
  try { plan = snapshot(reader) } finally { reader.close() }
  if (!apply) { const { account: _account, ...view } = plan; return { applied: false, ...view } }
  if (!expectedFingerprint || plan.fingerprint !== expectedFingerprint || plan.busy) throw new Error('Snapshot changed or an agent is busy; inspect again before consolidation')
  const database = new EdenDatabase(filename, 'mon')
  try {
    const repo = new SelfAwakeRepository(database, schedulerState, Boolean(schedulerState))
    repo.roles.reconcile(new SessionRepository(database, 'mon'), new JobRepository(database, Boolean(schedulerState)), () => {
      const current = snapshot(database.connection)
      if (current.fingerprint !== expectedFingerprint || current.busy) throw new Error('Runtime changed before the write lock; no plans merged')
    })
    if (schedulerState) repo.timerPublication.publish()
    const after = snapshot(database.connection)
    return { applied: true, previousWakePlans: plan.pendingWakePlans, pendingWakePlans: after.pendingWakePlans,
      roleClocks: Number(database.connection.prepare('SELECT count(*) AS n FROM self_awake_role_scopes').get().n),
      retainedPlans: Number(database.connection.prepare('SELECT count(*) AS n FROM self_awake_merged_plans').get().n),
      deliveryError: repo.timerPublication.fault ?? null, modelInvoked: false, historyDeleted: false }
  } finally { database.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { database: { type: 'string' }, 'scheduler-state': { type: 'string' }, apply: { type: 'boolean', default: false }, fingerprint: { type: 'string' } } })
  if (!values.database) throw new Error('--database is required')
  console.log(JSON.stringify(consolidateSelfAwake({ filename: values.database, schedulerState: values['scheduler-state'], apply: values.apply, expectedFingerprint: values.fingerprint })))
}
