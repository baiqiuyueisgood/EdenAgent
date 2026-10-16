import { spawn } from 'node:child_process'
import { readFile, writeFile, unlink, appendFile, open, rename } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { serviceConfig } from './wsl_service_plan.mjs'

export function command(file, args, input = '', timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, WSL_UTF8: '1' } })
    let stdout = '', stderr = '', timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    child.stdout.on('data', bytes => { stdout = (stdout + bytes.toString('utf8')).slice(-16000) })
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-4000) })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); timedOut || code !== 0 ? reject(new Error(timedOut ? 'Command timed out' : stderr || `Command exited ${code}`)) : resolve(stdout.trim()) })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

export async function health(url) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'error' }); await response.body?.cancel(); return response.ok }
  catch { return false }
}

export async function reconcile(config, run = command, check = health) {
  const c = serviceConfig(config), args = ['-d', c.distribution, '-u', 'root', '--exec', 'systemctl']
  const active = await run('wsl.exe', [...args, 'show', c.service, '--property=ActiveState', '--value'])
  if (await check(c.healthUrl)) {
    if (active !== 'active') throw new Error('Port responds but the managed unit is inactive; refusing to replace an unknown server')
    return { healthy: true, action: 'none' }
  }
  // Start a registered unit only. Never terminate a process occupying this port.
  await run('wsl.exe', [...args, active === 'active' ? 'restart' : 'start', c.service])
  return { healthy: await check(c.healthUrl), action: active === 'active' ? 'restart' : 'start' }
}

async function lock(filename) {
  try { return await open(filename, 'wx', 0o600) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    const pid = Number(await readFile(filename, 'utf8'))
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); throw new Error('Supervisor already running') }
      catch (check) { if (check.code !== 'ESRCH') throw check }
    }
    await unlink(filename)
    return open(filename, 'wx', 0o600)
  }
}

export async function supervise(configPath) {
  const filename = path.resolve(configPath), config = serviceConfig(JSON.parse(await readFile(filename, 'utf8')))
  const handle = await lock(`${filename}.pid`)
  await handle.writeFile(String(process.pid)); await handle.close()
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  let keepalive, previous = ''
  try {
    while (!controller.signal.aborted) {
      if (!keepalive || keepalive.exitCode !== null) {
        const child = spawn('wsl.exe', ['-d', config.distribution, '--exec', '/bin/sleep', 'infinity'], { windowsHide: true, stdio: 'ignore' })
        keepalive = child
        const lost = () => { if (keepalive === child) keepalive = undefined }
        child.on('error', lost); child.on('exit', lost)
      }
      let status
      try { status = await reconcile(config) }
      catch (error) { status = { healthy: false, error: error.message } }
      const text = JSON.stringify(status)
      if (text !== previous) { await appendFile(`${filename}.log`, `${new Date().toISOString()} ${text}\n`); previous = text }
      await writeFile(`${filename}.status.tmp`, JSON.stringify({ ...status, pid: process.pid, checkedAt: new Date().toISOString() }))
      await rename(`${filename}.status.tmp`, `${filename}.status.json`)
      try { await delay(config.intervalMs, undefined, { signal: controller.signal }) } catch { break }
    }
  } finally {
    keepalive?.kill()
    await unlink(`${filename}.pid`).catch(() => {})
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await supervise(process.argv[2]).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
