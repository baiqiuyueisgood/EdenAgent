import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { recordedModel } from '../../packages/runtime-pi/tests/recorded-model.ts'
import { loadConfig } from '../../Server/src/bootstrap/config.ts'
import { EdenAgentRpcClient } from '../../frontend/web/src/lib/rpc-client.ts'
import { buildRuntimeWorker } from './build_server.mjs'

test('fresh bundled turns deliver text through the actual frontend RPC client and retain prior context', { timeout: 60000 }, async t => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const scratch = await mkdtemp(path.join(tmpdir(), 'eden-dialogue-latency-'))
  const model = await recordedModel([{ text: '第一次合成回答' }, { text: '第二次合成回答' }])
  let host, client
  t.after(async () => {
    try { client?.close(); await host?.close(); await model.close() }
    finally {
      assert.equal(path.dirname(path.resolve(scratch)), path.resolve(tmpdir()))
      await rm(scratch, { recursive: true, force: true })
    }
  })
  await Promise.all([
    build({ absWorkingDir: root, entryPoints: { 'host-api': 'Server/src/bootstrap/container.ts' }, outdir: scratch,
      outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', target: 'node22', format: 'esm',
      define: { EDEN_BUNDLED_SERVER: 'true' },
      banner: { js: "import { createRequire as serverCreateRequire } from 'node:module'; const require = serverCreateRequire(import.meta.url);" },
      external: ['@earendil-works/*', 'ws', 'zod', 'typebox', 'esbuild'] }),
    buildRuntimeWorker(root, scratch),
  ])
  await symlink(path.join(root, 'node_modules'), path.join(scratch, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const workspace = path.join(scratch, 'workspace'); await mkdir(workspace)
  const { startServer } = await import(pathToFileURL(path.join(scratch, 'host-api.mjs')).href)
  const config = { ...loadConfig({ EDEN_AGENT_DATA_ROOT: path.join(scratch, 'data'), EDEN_AGENT_PORT: '0' }, scratch),
    defaultWorkspaceRoot: workspace, model: model.config }
  host = await startServer(config)
  await host.memoryExtractions.close()
  const session = host.sessions.repository.create('Synthetic latency conversation')
  client = new EdenAgentRpcClient(30000)
  await client.connect(`ws://127.0.0.1:${host.port}/rpc`, config.token,
    'latency-test', 'local', undefined, { sessionId: session.id, afterSeq: '0' })
  let active
  client.on('session.event', event => {
    if (!active) return
    const ms = Math.round(performance.now() - active.started)
    if (event.eventType === 'model.request') active.firstRequestMs ??= ms
    if (event.eventType === 'agent.message_update' && event.payload.assistantMessageEvent?.type === 'text_delta') active.firstTextMs ??= ms
    if (event.eventType === 'turn.completed') { active.completedMs = ms; active.finish() }
  })
  const results = []
  for (let index = 0; index < 2; index++) {
    let finish
    const completed = new Promise(resolve => { finish = resolve })
    active = { started: performance.now(), finish }
    const accepted = await client.request('turn.start', { sessionId: session.id, text: `合成输入 ${index}` })
    const timer = setTimeout(() => active.finish(), 30000)
    await completed; clearTimeout(timer)
    assert.ok(active.firstRequestMs >= 0)
    assert.ok(active.firstTextMs >= active.firstRequestMs)
    assert.ok(active.completedMs >= active.firstTextMs)
    assert.ok(host.sessions.repository.checkpoint(session.id))
    results.push({ index, turnId: accepted.turnId, firstRequestMs: active.firstRequestMs,
      firstTextMs: active.firstTextMs, completedMs: active.completedMs })
    active = undefined
  }
  assert.equal(model.requests.length, 2)
  assert.match(JSON.stringify(model.requests[1].messages), /第一次合成回答/)
  assert.notEqual(results[0].turnId, results[1].turnId)
  t.diagnostic(JSON.stringify({ fixture: 'temporary SQLite + compiled host/worker + real frontend WebSocket client + loopback model', results }))
  if (process.env.EDEN_LATENCY_REPORT) await writeFile(process.env.EDEN_LATENCY_REPORT, JSON.stringify(results, null, 2))
})
