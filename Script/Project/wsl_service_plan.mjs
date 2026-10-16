import path from 'node:path'
const clean = value => { if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) throw new Error('Invalid service configuration'); return value }
const unitArgument = value => `"${clean(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`
const xml = value => clean(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export function serviceConfig(input) {
  for (const key of ['distribution', 'user', 'directory', 'bind', 'taskName', 'service']) clean(input[key])
  if (!/^[a-z_][a-z0-9_-]*$/.test(input.user) || !/^eden-agent-web-[0-9]+\.service$/.test(input.service)) throw new Error('Invalid managed service identity')
  if (!input.directory.startsWith('/') || input.directory.trim() !== input.directory || input.directory.includes('\\') || input.directory.split('/').includes('..') || !['127.0.0.1', '0.0.0.0'].includes(input.bind)) throw new Error('Invalid HTTP service location')
  if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) throw new Error('Invalid HTTP port')
  if (input.service !== `eden-agent-web-${input.port}.service`) throw new Error('Service and port mismatch')
  if (input.taskName !== `Eden Agent WSL HTTP ${input.port}`) throw new Error('Invalid managed task name')
  return { version: 1, distribution: input.distribution, user: input.user, directory: input.directory, bind: input.bind,
    port: input.port, service: input.service, taskName: input.taskName, healthUrl: `http://127.0.0.1:${input.port}/`, intervalMs: 10000 }
}

export function systemdUnit(config) {
  const c = serviceConfig(config)
  return `[Unit]\nDescription=Eden Agent local web ${c.port}\nAfter=network.target\nStartLimitIntervalSec=60\nStartLimitBurst=5\n\n[Service]\nType=simple\nUser=${c.user}\nWorkingDirectory=${c.directory.replaceAll('%', '%%')}\nExecStart=/usr/bin/python3 -m http.server ${c.port} --bind ${c.bind} --directory ${unitArgument(c.directory)}\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=10\n\n[Install]\nWantedBy=multi-user.target\n`
}

export function scheduledTask(config, { userId, nodePath, supervisor, configPath, launcher }) {
  const c = serviceConfig(config)
  // wscript starts Node without a console window. The script waits and returns Node's exit status.
  const args = `//B //NoLogo "${path.resolve(launcher)}" "${nodePath}" "${path.resolve(supervisor)}" "${path.resolve(configPath)}"`
  return `<?xml version="1.0" encoding="UTF-16"?>\n<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n<RegistrationInfo><Description>Eden Agent WSL local web supervisor</Description></RegistrationInfo>\n<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(userId)}</UserId><Delay>PT10S</Delay></LogonTrigger></Triggers>\n<Principals><Principal id="Owner"><UserId>${xml(userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\n<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><Enabled>true</Enabled><Hidden>true</Hidden><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure></Settings>\n<Actions Context="Owner"><Exec><Command>WScript.exe</Command><Arguments>${xml(args)}</Arguments><WorkingDirectory>${xml(path.dirname(path.resolve(configPath)))}</WorkingDirectory></Exec></Actions>\n</Task>`
}

export const hiddenLauncher = `Option Explicit\nDim shell, args, command, i, code\nSet shell = CreateObject("WScript.Shell")\nSet args = WScript.Arguments\nIf args.Count &lt; 3 Then WScript.Quit 2\ncommand = ""\nFor i = 0 To args.Count - 1\n  If i &gt; 0 Then command = command &amp; " "\n  command = command &amp; Chr(34) &amp; args(i) &amp; Chr(34)\nNext\ncode = shell.Run(command, 0, True)\nWScript.Quit code\n`.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
