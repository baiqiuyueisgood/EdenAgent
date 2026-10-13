import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('actual portable package includes a hashed search worker and executes without source or tsx', { timeout: 180_000 }, async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'eden-search-package-'))
  const repository = fileURLToPath(new URL('../../', import.meta.url))
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(tmpdir()))
    await rm(scratch, { recursive: true, force: true })
  })
  const packaged = path.join(scratch, 'runtime')
  await promisify(execFile)(process.execPath, [path.join(repository, 'Script/Project/package_server.mjs'), packaged],
    { cwd: repository, timeout: 120_000, windowsHide: true, maxBuffer: 1024 * 1024 })
  const manifest = JSON.parse(await readFile(path.join(packaged, 'runtime-manifest.json'), 'utf8'))
  assert.equal(manifest.searchWorker, 'server/workspace-search-worker.mjs')
  const worker = path.join(packaged, manifest.searchWorker)
  assert.equal(createHash('sha256').update(await readFile(worker)).digest('hex'), manifest.searchWorkerSha256)
  const facade = path.join(packaged, 'server', 'search-test-facade.mjs')
  await build({ absWorkingDir: repository, entryPoints: ['Server/src/modules/workspace/workspace-search.ts'],
    outfile: facade, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    define: { EDEN_BUNDLED_SERVER: 'true' }, external: ['zod'] })
  const project = path.join(scratch, 'project')
  await mkdir(project)
  await writeFile(path.join(project, 'note.txt'), 'needle from the portable worker')
  const check = path.join(packaged, 'verify.mjs')
  await writeFile(check, `import {searchWorkspace} from './server/search-test-facade.mjs';
    const result = await searchWorkspace(${JSON.stringify(project)}, '.', 'needle', 20, new AbortController().signal);
    process.stdout.write(JSON.stringify(result));`)
  const { stdout } = await promisify(execFile)(path.join(packaged, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
    [check], { cwd: scratch, timeout: 20_000, windowsHide: true })
  const result = JSON.parse(stdout)
  assert.equal(result.stopReason, 'completed')
  assert.equal(result.budgetMs, 120_000)
  assert.equal(result.workerStopped, true)
  assert.deepEqual(result.matches, [{ path: 'note.txt', line: 1, preview: 'needle from the portable worker' }])
})
