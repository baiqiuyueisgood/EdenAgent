import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { serviceConfig, systemdUnit, scheduledTask } from './wsl_service_plan.mjs'
import { reconcile, health, command } from './wsl_service_supervisor.mjs'
const config = { distribution: 'Ubuntu', user: 'fixture', directory: '/mnt/e/my workspace', bind: '127.0.0.1', port: 8123, service: 'eden-agent-web-8123.service', taskName: 'Eden Agent WSL HTTP 8123' }

test('persistent plan separates login trigger, WSL keepalive and systemd restart without storing a password', () => {
  const unit = systemdUnit(config), task = scheduledTask(config, { userId: 'fixture-sid', nodePath: 'C:/Program Files/nodejs/node.exe', supervisor: 'E:/fixture/supervisor.mjs', configPath: 'E:/fixture/service.json', launcher: 'E:/fixture/hidden.vbs' })
  assert.match(unit, /Restart=on-failure/); assert.match(unit, /User=fixture/); assert.match(unit, /"\/mnt\/e\/my workspace"/)
  assert.match(task, /InteractiveToken/); assert.match(task, /LeastPrivilege/); assert.match(task, /LogonTrigger/); assert.match(task, /PT0S/)
  assert.doesNotMatch(task + unit, /password|sudo|shutdown/i)
  assert.throws(() => serviceConfig({ ...config, directory: '/tmp/\ninjected' }))
  assert.throws(() => serviceConfig({ ...config, service: 'foreign.service' }))
})

test('supervisor starts stopped units, restarts unhealthy active units and leaves foreign healthy ports alone', async () => {
  for (const active of ['inactive', 'active']) {
    const calls = [], run = async (_file, args) => { calls.push(args); return calls.length === 1 ? active : '' }
    let count = 0
    const result = await reconcile(config, run, async () => ++count > 1)
    assert.equal(result.healthy, true)
    assert.equal(result.action, active === 'active' ? 'restart' : 'start')
    assert.ok(calls.every(args => args.includes(config.service)))
  }
  const calls = []
  await assert.rejects(reconcile(config, async (_file, args) => { calls.push(args); return 'inactive' }, async () => true), /unknown server/)
  assert.equal(calls.length, 1)
  const healthy = await reconcile(config, async () => 'active', async () => true)
  assert.equal(healthy.action, 'none')
})

test('real health check distinguishes an isolated HTTP fixture, unavailable endpoint and redirects', async t => {
  const server = createServer((request, response) => { if (request.url === '/redirect') { response.writeHead(302, { Location: '/' }); response.end() } else response.end('fixture') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}`
  assert.equal(await health(`${url}/`), true)
  assert.equal(await health(`${url}/redirect`), false)
  await new Promise(resolve => server.close(resolve))
  assert.equal(await health(url), false)
})

test('actual WSL systemd validates the generated unit including a working directory containing spaces', { timeout: 30000 }, async t => {
  if (process.platform !== 'win32') { t.skip('WSL is a Windows integration'); return }
  const distributions = await command('wsl.exe', ['--list', '--running', '--quiet']).catch(() => '')
  const distribution = distributions.replaceAll('\0', '').split(/[\r\n]+/).find(Boolean)
  if (!distribution) { t.skip('No running WSL distribution'); return }
  const filename = `/tmp/eden-unit-fixture-${randomUUID()}.service`
  const script = "import pathlib,sys,subprocess; p=pathlib.Path(sys.argv[1]); p.write_text(sys.stdin.read()); result=subprocess.run(['systemd-analyze','verify',str(p)],capture_output=True,text=True); p.unlink(); print(result.stderr); sys.exit(result.returncode)"
  const output = await command('wsl.exe', ['-d', distribution, '--exec', 'python3', '-c', script, filename], systemdUnit(config))
  assert.doesNotMatch(output, /fatal|not absolute|bad unit/i)
})
