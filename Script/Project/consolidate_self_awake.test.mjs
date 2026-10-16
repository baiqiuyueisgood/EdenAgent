import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '../../packages/store/src/database.ts'
import { SessionRepository } from '../../Server/src/modules/sessions/index.ts'
import { JobRepository } from '../../Server/src/modules/jobs/index.ts'
import { consolidateSelfAwake } from './consolidate_self_awake.mjs'

test('maintenance previews without changing data, rejects stale evidence and merges synthetic plans transactionally', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'eden-clock-maintenance-')), filename = path.join(root, 'fixture.db')
  const db = new EdenDatabase(filename, 'mon'), sessions = new SessionRepository(db, 'mon'), jobs = new JobRepository(db)
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }) })
  db.connection.prepare("INSERT INTO realm_meta VALUES('account_key',?)").run('["http://fixture.invalid/","2"]')
  for (let i = 0; i < 7; i++) {
    const session = sessions.create('synthetic', [{ assistantId: 4, characterId: 4 }], {}, { purpose: 'self_awake', sourceChannel: 'internal' })
    jobs.schedule({ kind: 'self_awake', sessionId: session.id, dueAt: Date.now() + 60000 + i, key: `fixture-${i}`, payload: { prompt: `事项 ${i}` }, causationId: '', depth: 0 })
  }
  const plan = consolidateSelfAwake({ filename })
  assert.equal(plan.applied, false); assert.equal(plan.busy, false); assert.equal(plan.pendingWakePlans, 7)
  assert.equal(db.connection.prepare('SELECT count(*) AS n FROM self_awake_role_scopes').get().n, 0)
  assert.throws(() => consolidateSelfAwake({ filename, apply: true, expectedFingerprint: 'outdated' }), /Snapshot changed/)
  const result = consolidateSelfAwake({ filename, apply: true, expectedFingerprint: plan.fingerprint })
  assert.equal(result.pendingWakePlans, 1); assert.equal(result.retainedPlans, 7); assert.equal(result.roleClocks, 1)
  assert.equal(result.modelInvoked, false); assert.equal(result.historyDeleted, false)
  assert.equal(db.connection.prepare('PRAGMA foreign_key_check').all().length, 0)
  assert.throws(() => consolidateSelfAwake({ filename, apply: true, expectedFingerprint: plan.fingerprint }), /Snapshot changed/)
})
