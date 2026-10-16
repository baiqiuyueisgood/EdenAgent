import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { serviceConfig, systemdUnit, scheduledTask, hiddenLauncher } from './wsl_service_plan.mjs'
import { command, health } from './wsl_service_supervisor.mjs'

export async function prepare(configPath, input, userId) {
  const filename = path.resolve(configPath), config = serviceConfig(input)
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, JSON.stringify(config, null, 2))
  await writeFile(`${filename}.service`, systemdUnit(config))
  await writeFile(`${filename}.vbs`, hiddenLauncher)
  const supervisor = fileURLToPath(new URL('./wsl_service_supervisor.mjs', import.meta.url))
  const task = scheduledTask(config, { userId, nodePath: process.execPath, supervisor, configPath: filename, launcher: `${filename}.vbs` })
  await writeFile(`${filename}.task.xml`, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(task, 'utf16le')]))
  return { config: filename, unit: `${filename}.service`, task: `${filename}.task.xml`, supervisor }
}

export async function install(configPath, adoptPid) {
  const filename = path.resolve(configPath), config = serviceConfig(JSON.parse(await readFile(filename, 'utf8')))
  const wsl = ['-d', config.distribution, '-u', 'root', '--exec']
  // Do not overwrite a foreign unit or task. The prepared plan remains reviewable on failure.
  await command('wsl.exe', [...wsl, '/usr/bin/python3', '-c', "import pathlib,sys; p=pathlib.Path('/etc/systemd/system')/sys.argv[1]; f=p.open('x'); f.write(sys.stdin.read()); f.close(); p.chmod(0o644)", config.service], systemdUnit(config))
  await command('wsl.exe', [...wsl, 'systemd-analyze', 'verify', `/etc/systemd/system/${config.service}`])
  await command('wsl.exe', [...wsl, 'systemctl', 'daemon-reload'])
  await command('schtasks.exe', ['/Create', '/TN', config.taskName, '/XML', `${filename}.task.xml`])
  if (adoptPid) await adoptExisting(config, adoptPid)
  await command('wsl.exe', [...wsl, 'systemctl', 'enable', '--now', config.service])
  await command('schtasks.exe', ['/Run', '/TN', config.taskName])
  return { installed: true, service: config.service, taskName: config.taskName, healthy: await health(config.healthUrl) }
}

async function adoptExisting(config, pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('Invalid adoption PID')
  const expected = Buffer.from(['python3', '-m', 'http.server', String(config.port), '--bind', config.bind, ''].join('\0')).toString('base64')
  const directory = Buffer.from(config.directory).toString('base64')
  // Validate command, directory and owner immediately before SIGTERM; never stop unrelated services.
  const script = `import os,base64,pwd,signal\npid=${pid}\nassert open('/proc/%d/cmdline'%pid,'rb').read()==base64.b64decode('${expected}')\nassert os.readlink('/proc/%d/cwd'%pid).encode()==base64.b64decode('${directory}')\nassert pwd.getpwuid(os.stat('/proc/%d'%pid).st_uid).pw_name=='${config.user}'\nos.kill(pid,signal.SIGTERM)\n`
  await command('wsl.exe', ['-d', config.distribution, '-u', 'root', '--exec', '/usr/bin/python3', '-'], script)
}

export async function status(configPath) {
  const filename = path.resolve(configPath), config = serviceConfig(JSON.parse(await readFile(filename, 'utf8')))
  const state = await command('wsl.exe', ['-d', config.distribution, '--exec', 'systemctl', 'show', config.service, '--property=ActiveState,SubState,MainPID'])
  const supervisor = JSON.parse(await readFile(`${filename}.status.json`, 'utf8').catch(() => '{}'))
  return { state, healthy: await health(config.healthUrl), supervisor }
}

export async function uninstall(configPath) {
  const filename = path.resolve(configPath), config = serviceConfig(JSON.parse(await readFile(filename, 'utf8')))
  const unit = Buffer.from(systemdUnit(config)).toString('base64')
  const check = "import pathlib,sys,base64; assert (pathlib.Path('/etc/systemd/system')/sys.argv[1]).read_bytes()==base64.b64decode(sys.argv[2])"
  const wsl = ['-d', config.distribution, '-u', 'root', '--exec']
  await command('wsl.exe', [...wsl, '/usr/bin/python3', '-c', check, config.service, unit])
  // Ending the managed task terminates its own supervisor tree; other WSL instances stay running.
  await command('schtasks.exe', ['/End', '/TN', config.taskName]).catch(() => {})
  const pid = Number(await readFile(`${filename}.pid`, 'utf8').catch(() => '0'))
  if (Number.isSafeInteger(pid) && pid > 0) {
    let alive = true
    for (let attempt = 0; attempt < 20; attempt++) {
      try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') { alive = false; break } throw error }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    if (alive) throw new Error('The task ended but its supervisor remains active; service removal stopped')
  }
  await command('schtasks.exe', ['/Delete', '/TN', config.taskName, '/F'])
  await command('wsl.exe', [...wsl, 'systemctl', 'disable', '--now', config.service])
  await command('wsl.exe', [...wsl, '/usr/bin/python3', '-c', "import pathlib,sys; (pathlib.Path('/etc/systemd/system')/sys.argv[1]).unlink()", config.service])
  await command('wsl.exe', [...wsl, 'systemctl', 'daemon-reload'])
  return { uninstalled: true, service: config.service, taskName: config.taskName }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [action, configPath, argument] = process.argv.slice(2)
  const result = action === 'install' ? await install(configPath, argument ? Number(argument) : undefined)
    : action === 'status' ? await status(configPath) : action === 'uninstall' ? await uninstall(configPath)
      : (() => { throw new Error('Usage: manage_wsl_service.mjs install|status|uninstall config.json [verified-existing-pid]') })()
  console.log(JSON.stringify(result, null, 2))
}
