import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { runProcess } from './process-runner.ts'
import { windowsProcessEnvironment } from './windows-process.ts'
import { hostProcessEnvironment } from './host-environment.ts'
import { decodeWslListOutput, wslDetectionFailure } from './wsl-output.ts'
import { wslShellArguments } from './wsl-shell.ts'

function wslExecutable(): string {
  const root = windowsProcessEnvironment().SystemRoot!
  return path.win32.join(root, 'System32', 'wsl.exe')
}

/** WSL's list output is UTF-16LE on some Windows releases. */
export async function listWslDistributions(): Promise<string[]> {
  if (process.platform !== 'win32' || !existsSync(wslExecutable())) return []
  const output = await new Promise<Buffer>((resolve, reject) => {
    execFile(wslExecutable(), ['--list', '--quiet'], {
      encoding: 'buffer', timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true,
      env: { ...windowsProcessEnvironment(), WSL_UTF8: '1' },
    }, (error, stdout, stderr) => error ? reject(wslDetectionFailure(error, Buffer.from(stdout), Buffer.from(stderr))) : resolve(Buffer.from(stdout)))
  })
  const decoded = decodeWslListOutput(output)
  return [...new Set(decoded.split(/\r?\n/).map(value => value.trim()).filter(Boolean))]
}

/** WSL is an alternate local shell, not an Eden sandbox. */
export async function runWslCommand(root: string, command: string, distribution: string, signal: AbortSignal, timeoutMs = 30000) {
  if (process.platform !== 'win32') throw new Error('WSL terminal is available only on Windows')
  signal.throwIfAborted()
  // Launch once; a separate list probe can hang even when an existing distribution works.
  // wsl.exe itself reports a missing distribution with its original status and diagnostics.
  return runProcess({
    executable: wslExecutable(),
    args: wslShellArguments(root, distribution), env: { ...hostProcessEnvironment(), WSL_UTF8: '1' },
    cwd: root, input: command, timeoutMs, maxOutputBytes: 1024 * 1024, truncateOutput: true, signal,
  })
}
