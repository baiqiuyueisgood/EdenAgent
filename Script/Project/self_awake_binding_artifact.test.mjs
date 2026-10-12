import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { EdenDatabase } from '@eden/store'
import { accountKey, withAccount } from '../../Server/src/modules/accounts/index.ts'
import { SessionRepository } from '../../Server/src/modules/sessions/session-repository.ts'
import { JobRepository } from '../../Server/src/modules/jobs/repository.ts'
import { SelfAwakeBridgeRepository } from '../../Server/src/modules/self-awake/bridge-repository.ts'
import { artifactHost, artifactClient } from './workspace_artifact_fixture.mjs'

const sourceEntry = fileURLToPath(new URL('../../Server/src/main.ts', import.meta.url))
const compiledEntry = fileURLToPath(new URL('../../dist/server/main.mjs', import.meta.url))
const secret = 'isolated-self-awake-binding-fixture', coreToken = 'isolated-binding-account'

async function fixture(root, portable, coreUrl) {
  const module = portable ? 'runtime/os' : 'BaseOs', dataRoot = path.join(root, 'Data/Agent/realms/mon')
  await mkdir(path.join(root, module), { recursive: true })
  await mkdir(path.join(root, 'Config/ENV'), { recursive: true })
  await writeFile(path.join(root, '.monconfig'), '')
  await writeFile(path.join(root, '.monworkspace'), JSON.stringify({ modules: [{ id: 'baseos', root: module, config: '.monconfig' }] }))
  await writeFile(path.join(root, module, '.monconfig'), `[self_awake]\nDATA_DIR=${portable ? '../../Data/Os/SelfAwake' : 'Data/SelfAwake'}\n`)
  await writeFile(path.join(root, 'Config/ENV/service-auth.env'), `MON_SERVICE_SHARED_SECRET=${secret}\nMON_SERVICE_USER_ID=2\n`)
  const account = { key: accountKey(coreUrl, '2'), userId: '2', coreBaseUrl: coreUrl }
  const accountRoot = path.join(dataRoot, 'accounts', createHash('sha256').update(account.key).digest('hex'))
  await mkdir(path.join(accountRoot, 'storage'), { recursive: true })
  await writeFile(path.join(accountRoot, 'account.json'), JSON.stringify(account))
  const database = new EdenDatabase(path.join(accountRoot, 'storage/eden-agent.db'), 'mon')
  try {
    withAccount(account, () => {
      const session = new SessionRepository(database, 'mon').create('isolated timer ownership')
      new SelfAwakeBridgeRepository(database, new JobRepository(database, true)).submit('2', 'fixture', 'fixture-hash', {
        kind: 'self_awake', sessionId: session.id, dueAt: Date.now() + 86400000,
        payload: {}, key: 'fixture', causationId: '', depth: 0,
      })
    })
  } finally { database.close() }
  return { dataRoot, stateFile: path.join(root, portable ? 'Data/Os/SelfAwake/state.json' : 'BaseOs/Data/SelfAwake/state.json') }
}

test('source and compiled portable processes read the same MonOs contract, show faults and survive relocation', { timeout: 90000 }, async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'eden-awake-artifact-')), active = new Set(), clients = new Set()
  const core = createServer((request, response) => {
    if (request.url === '/api/users/me/profile/' && request.headers.authorization === `Token ${coreToken}`) {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"2"}')
    } else response.writeHead(404).end()
  })
  core.listen(0, '127.0.0.1'); await once(core, 'listening')
  t.after(async () => {
    for (const client of clients) client.close()
    await Promise.all([...active].map(host => host.close()))
    core.closeAllConnections(); await new Promise(resolve => core.close(resolve))
    await rm(temporary, { recursive: true, force: true })
  })
  const coreUrl = `http://127.0.0.1:${core.address().port}`
  const nextWakeAt = new Date(Date.now() + 3600000).toISOString()
  for (const portable of [false, true]) {
    let root = path.join(temporary, portable ? '便携安装' : '源码安装'), setup = await fixture(root, portable, coreUrl)
    const options = { origin: 'mon', coreUrl, source: !portable }
    let host = await artifactHost(portable ? compiledEntry : sourceEntry, root, setup.dataRoot, options); active.add(host)
    let client = await artifactClient(host, { origin: 'mon', coreToken }); clients.add(client)
    assert.equal((await client.rpc('self_awake.list')).schedule.status, 'unavailable')
    await assert.rejects(readFile(setup.stateFile), /ENOENT/, 'Agent must not create a fake MonOs state')
    await mkdir(path.dirname(setup.stateFile), { recursive: true })
    await writeFile(setup.stateFile, JSON.stringify({ enabled: true, next_wake_at: nextWakeAt, next_wake_source: 'watchdog' }))
    assert.equal((await client.rpc('self_awake.list')).schedule.nextWakeAt, nextWakeAt)
    if (portable) {
      client.close(); clients.delete(client); await host.close(); active.delete(host)
      const moved = path.join(temporary, '搬迁后的便携安装'); await rename(root, moved); root = moved
      host = await artifactHost(compiledEntry, root, path.join(root, 'Data/Agent/realms/mon'), options); active.add(host)
      client = await artifactClient(host, { origin: 'mon', coreToken }); clients.add(client)
      const page = await client.rpc('self_awake.list')
      assert.equal(page.schedule.status, 'scheduled'); assert.equal(page.schedule.nextWakeAt, nextWakeAt)
    }
    client.close(); clients.delete(client); await host.close(); active.delete(host)
  }
})
