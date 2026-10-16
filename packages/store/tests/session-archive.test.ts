import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase, migrations, databaseSchemaVersion } from '../src/migrations.ts'

test('archive migration preserves existing six-column sessions and events and can run twice', () => {
  const database = new DatabaseSync(':memory:')
  try {
    const previous = migrations.length - 1
    for (const sql of migrations.slice(0, previous)) database.exec(sql)
    database.exec(`PRAGMA user_version=${previous}`)
    database.exec("INSERT INTO sessions VALUES('session','history','local','active',1,2)")
    database.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run('event', 'session', null, 1, 'user.message', '{"text":"keep"}', 1)
    migrateDatabase(database); migrateDatabase(database)
    assert.equal(database.prepare('SELECT title FROM sessions').get()?.title, 'history')
    assert.equal(database.prepare('SELECT payload_json FROM events').get()?.payload_json, '{"text":"keep"}')
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM session_archives').get()?.n, 0)
    assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, databaseSchemaVersion)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=?').get(databaseSchemaVersion)?.n, 1)
  } finally { database.close() }
})
