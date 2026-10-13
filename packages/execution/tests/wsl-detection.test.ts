import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import childProcess, { type ExecFileException } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { listWslDistributions } from '../src/index.ts'
import { decodeWslListOutput, wslDetectionFailure } from '../src/wsl-output.ts'

for (const encoding of ['utf8', 'utf16le'] as const) test(`WSL list decodes ${encoding} without damaging Chinese names`, () => {
  assert.equal(decodeWslListOutput(Buffer.from('Ubuntu\r\n中文发行版\r\n', encoding)), 'Ubuntu\r\n中文发行版\r\n')
})
test('WSL list strips a UTF-16 BOM', () => {
  assert.equal(decodeWslListOutput(Buffer.from('\ufeffUbuntu\r\n', 'utf16le')), 'Ubuntu\r\n')
})
test('UTF-16 detection does not require an ASCII distribution name on the first line', () => {
  assert.equal(decodeWslListOutput(Buffer.from('中文发行版\r\n', 'utf16le')), '中文发行版\r\n')
})
test('detection timeout retains its cause and never claims the distribution is absent', () => {
  const cause = Object.assign(new Error('timed out'), { killed: true, code: null })
  const error = wslDetectionFailure(cause, Buffer.alloc(0), Buffer.from('系统忙\r\n', 'utf16le'))
  assert.equal(error.cause, cause)
  assert.equal((error as Error & { code: string }).code, 'WSL_DETECTION_TIMEOUT')
  assert.match(error.message, /超时.*不代表发行版未安装/s)
  assert.match(error.message, /系统忙/)
})
test('failed list preserves the WSL error code and diagnostics', () => {
  const cause = Object.assign(new Error('failed'), { code: 42 })
  const error = wslDetectionFailure(cause, Buffer.alloc(0), Buffer.from('Wsl/Service/错误'))
  assert.match(error.message, /42.*Wsl\/Service\/错误/s)
  assert.equal(error.cause, cause)
})
test('excessive diagnostic output is bounded and is not mistaken for a timeout', () => {
  const cause = Object.assign(new Error('maxBuffer'), { killed: true, code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
  const error = wslDetectionFailure(cause, Buffer.alloc(0), Buffer.from('x'.repeat(10_000)))
  assert.doesNotMatch(error.message, /超时/)
  assert.ok(error.message.length < 4300)
})

const wslPresent = process.platform === 'win32' && existsSync(path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe'))
function mockList(t: TestContext, error: ExecFileException | null, stdout: Buffer, stderr = Buffer.alloc(0)) {
  let calls = 0
  t.mock.method(childProcess, 'execFile', (...args: unknown[]) => {
    calls++
    assert.deepEqual(args[1], ['--list', '--quiet'])
    const options = args[2] as { env: NodeJS.ProcessEnv; timeout: number; windowsHide: boolean }
    assert.equal(options.env.WSL_UTF8, '1')
    assert.equal(options.timeout, 5000)
    assert.equal(options.windowsHide, true)
    const callback = args[3] as (error: ExecFileException | null, stdout: Buffer, stderr: Buffer) => void
    queueMicrotask(() => callback(error, stdout, stderr))
    return {}
  })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  return () => calls
}
test('successful enumeration deduplicates and trims UTF-16 names', { skip: !wslPresent }, async t => {
  const calls = mockList(t, null, Buffer.from('Ubuntu\r\nUbuntu\r\n中文发行版\r\n', 'utf16le'))
  assert.deepEqual(await listWslDistributions(), ['Ubuntu', '中文发行版'])
  assert.equal(calls(), 1)
})
test('enumeration does not convert a timeout into an empty list or retry', { skip: !wslPresent }, async t => {
  const calls = mockList(t, Object.assign(new Error('timeout'), { killed: true, code: null }), Buffer.alloc(0))
  await assert.rejects(listWslDistributions(), /检测超时/)
  assert.equal(calls(), 1)
})
test('enumeration exposes a service failure rather than no installed distributions', { skip: !wslPresent }, async t => {
  mockList(t, Object.assign(new Error('failed'), { code: 9 }), Buffer.alloc(0), Buffer.from('WSL 服务错误'))
  await assert.rejects(listWslDistributions(), /9.*WSL 服务错误/s)
})
