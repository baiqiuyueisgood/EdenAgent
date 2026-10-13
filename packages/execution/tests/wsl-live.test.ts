import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { runWslCommand, listWslDistributions } from '../src/index.ts'
import { wslShellArguments } from '../src/wsl-shell.ts'

// Explicit opt-in: no user's service, database, /tmp mount or WSL settings are modified.
const distribution = process.env.EDEN_TEST_WSL_DISTRIBUTION
const enabled = process.platform === 'win32' && Boolean(distribution)
const options = { skip: !enabled, timeout: 30_000 }
let scratch: string, root: string
before(async () => {
  if (!enabled) return
  assert.ok((await listWslDistributions()).includes(distribution!))
  scratch = await mkdtemp(path.join(os.tmpdir(), 'eden-wsl-live-'))
  root = path.join(scratch, '工作区 with spaces; $literal')
  await mkdir(root)
})
after(async () => {
  if (!enabled || !scratch) return
  try {
    const result = await run('case "$TMPDIR" in "$HOME"/.local/state/eden-agent/command-tmp/*) rmdir -- "$TMPDIR";; *) exit 99;; esac')
    assert.equal(result.exitCode, 0, result.stderr)
  } finally {
    if (path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir())) throw new Error('Unexpected WSL fixture cleanup path')
    await rm(scratch, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 })
  }
})
const run = (command: string) => runWslCommand(root, command, distribution!, new AbortController().signal, 15_000)

test('WSL executes once without enumeration and resolves a Unicode workspace with literal metacharacters', options, async t => {
  t.mock.method(childProcess, 'execFile', () => { assert.fail('Execution must not enumerate distributions') })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  const result = await run('pwd; printf "中文输出\\n"; printf "Linux 中文警告\\n" >&2')
  assert.equal(result.exitCode, 0, result.stderr)
  assert.match(result.stdout, /工作区 with spaces; \$literal\n中文输出/)
  assert.match(result.stderr, /Linux 中文警告/)
  assert.doesNotMatch(result.stderr, /\u0000|\ufffd/)
})
test('a failed pipeline stage survives a successful output filter', options, async () => {
  const result = await run("sh -c 'printf failure >&2; exit 17' 2>&1 | cat")
  assert.equal(result.exitCode, 17, result.stderr)
  assert.equal(result.stdout, 'failure')
})
test('a minimal PATH without bash still executes stdin through the fallback shell', options, async () => {
  const args = wslShellArguments(root, distribution!), script = args[5]!, key = args[8]!
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  const command = [
    'mkdir -- "$TMPDIR/minimal"',
    'ln -s "$(command -v wslpath)" "$TMPDIR/minimal/wslpath"',
    'ln -s "$(command -v mkdir)" "$TMPDIR/minimal/mkdir"',
    `PATH="$TMPDIR/minimal" /bin/sh -c ${quote(script)} eden-agent ${quote(root)} ${quote(key)} <<'EDEN_FALLBACK_INPUT'`,
    'printf "fallback-中文"', 'exit 23', 'EDEN_FALLBACK_INPUT',
  ].join('\n')
  try {
    const result = await run(command)
    assert.equal(result.exitCode, 23, result.stderr)
    assert.equal(result.stdout, 'fallback-中文')
  } finally {
    const cleanup = await run('rm -f -- "$TMPDIR/minimal/wslpath" "$TMPDIR/minimal/mkdir"; rmdir -- "$TMPDIR/minimal"')
    assert.equal(cleanup.exitCode, 0, cleanup.stderr)
  }
})
test('WSL TMPDIR uses a persistent filesystem and survives an independent shell call', options, async () => {
  const first = await run('printf "temp-value" > "$TMPDIR/value.txt"; printf "%s\\n" "$TMPDIR"; findmnt -n -o FSTYPE -T "$TMPDIR"')
  try {
    assert.equal(first.exitCode, 0, first.stderr)
    const [directory, filesystem] = first.stdout.trim().split('\n')
    assert.match(directory!, /\/\.local\/state\/eden-agent\/command-tmp\/[a-f0-9]{64}$/)
    assert.ok(filesystem && filesystem !== 'tmpfs', first.stdout)
    const second = await run('cat "$TMPDIR/value.txt"')
    assert.equal(second.exitCode, 0, second.stderr)
    assert.equal(second.stdout, 'temp-value')
  } finally { const cleanup = await run('rm -f -- "$TMPDIR/value.txt"'); assert.equal(cleanup.exitCode, 0, cleanup.stderr) }
})
test('shell variables do not persist and WSL errors retain their actual exit status', options, async () => {
  assert.equal((await run('export EDEN_WSL_FIXTURE=first')).exitCode, 0)
  const result = await run('printf "%s" "${EDEN_WSL_FIXTURE-unset}"; exit 23')
  assert.equal(result.exitCode, 23)
  assert.equal(result.stdout, 'unset')
})
test('separate workspaces receive separate persistent temporary directories', options, async () => {
  const secondRoot = path.join(scratch, 'second-workspace')
  await mkdir(secondRoot)
  const first = await run('printf "%s" "$TMPDIR"')
  const second = await runWslCommand(secondRoot, 'printf "%s" "$TMPDIR"', distribution!, new AbortController().signal)
  try {
    assert.equal(first.exitCode, 0, first.stderr)
    assert.equal(second.exitCode, 0, second.stderr)
    assert.notEqual(first.stdout, second.stdout)
  } finally {
    const cleanup = await runWslCommand(secondRoot, 'case "$TMPDIR" in "$HOME"/.local/state/eden-agent/command-tmp/*) rmdir -- "$TMPDIR";; *) exit 99;; esac', distribution!, new AbortController().signal)
    assert.equal(cleanup.exitCode, 0, cleanup.stderr)
  }
})
test('an absent distribution returns the native WSL diagnostic without retrying', options, async () => {
  const result = await runWslCommand(root, 'printf must-not-run', 'eden-test-missing-distribution-4c71d8', new AbortController().signal, 15_000)
  assert.notEqual(result.exitCode, 0)
  assert.doesNotMatch(result.stdout, /must-not-run/)
  assert.match(result.stderr + result.stdout, /WSL_E_DISTRO_NOT_FOUND|Wsl\/Service|发行版|distribution/i)
  assert.doesNotMatch(result.stderr + result.stdout, /\u0000|\ufffd/)
})
test('an already cancelled WSL command starts no process', options, async () => {
  const controller = new AbortController(), reason = new Error('cancelled-before-start')
  controller.abort(reason)
  await assert.rejects(runWslCommand(root, 'printf must-not-run', distribution!, controller.signal), error => error === reason)
})
