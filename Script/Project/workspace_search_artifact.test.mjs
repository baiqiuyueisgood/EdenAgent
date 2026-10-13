import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('relocated bundled search finds text and kills a worker blocked inside real file-read dispatch', async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'eden-search-artifact-'))
  const repository = fileURLToPath(new URL('../../', import.meta.url))
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(tmpdir()))
    await rm(scratch, { recursive: true, force: true })
  })
  const runtime = path.join(scratch, '移动后的 程序', 'server')
  const project = path.join(scratch, 'project')
  await mkdir(runtime, { recursive: true })
  await mkdir(project)
  await build({ absWorkingDir: repository, entryPoints: ['Server/src/modules/workspace/workspace-search-process.ts'],
    outfile: path.join(runtime, 'facade.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22',
    define: { EDEN_BUNDLED_SERVER: 'true' }, external: ['zod'] })
  await cp(path.join(repository, 'dist/server/workspace-search-worker.mjs'), path.join(runtime, 'workspace-search-worker.mjs'))
  await symlink(path.join(repository, 'node_modules'), path.join(scratch, '移动后的 程序', 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir')
  const { runSearchProcess } = await import(pathToFileURL(path.join(runtime, 'facade.mjs')).href)
  await writeFile(path.join(project, 'a-found.txt'), 'first\nneedle in bundled search\nlast')
  const request = { root: project, requested: '.', query: 'needle', limit: 20 }
  const normal = await runSearchProcess(request, new AbortController().signal)
  assert.equal(normal.stopReason, 'completed')
  assert.equal(normal.budgetMs, 120_000)
  assert.equal(normal.workerStopped, true)
  assert.deepEqual(normal.matches, [{ path: 'a-found.txt', line: 2, preview: 'needle in bundled search' }])

  // Instrument only the temporary copy of the exact built scanner, preserving its actual scan/IPC code.
  // The real file opens and then FileHandle.read never settles: a between-file deadline cannot pass this test.
  const worker = path.join(runtime, 'workspace-search-worker.mjs')
  const original = await readFile(worker, 'utf8')
  const marker = path.join(scratch, 'blocked-read.json')
  await writeFile(worker, `import { promises as testFs } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const testOpen = testFs.open;
    testFs.open = async (...args) => {
      const handle = await testOpen(...args);
      if (String(args[0]).endsWith('b-slow.txt')) {
        await testFs.writeFile(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid}));
        handle.read = async () => new Promise(() => {});
      }
      return handle;
    };
    syncBuiltinESMExports();\n${original}`)
  await writeFile(path.join(project, 'b-slow.txt'), 'needle in a stalled read')
  const fullBudget = process.env.EDEN_SEARCH_FULL_BUDGET_TEST === '1'
  const budgetMs = fullBudget ? 120_000 : 1500
  const partial = await runSearchProcess(request, new AbortController().signal, fullBudget ? undefined : { budgetMs })
  const { pid } = JSON.parse(await readFile(marker, 'utf8'))
  assert.equal(partial.stopReason, 'timeout')
  assert.equal(partial.truncated, true)
  assert.equal(partial.workerStopped, true)
  assert.equal(partial.scannedFiles, 2)
  assert.deepEqual(partial.matches, normal.matches)
  assert.equal(partial.budgetMs, budgetMs)
  assert.ok(partial.elapsedMs >= budgetMs - 10 && partial.elapsedMs < budgetMs + 2000)
  t.diagnostic(`blocked file read: budget=${partial.budgetMs}ms elapsed=${partial.elapsedMs}ms workerStopped=${partial.workerStopped}`)
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH')

  // Closing a handle can stall too; matches from that very file must already be checkpointed.
  await writeFile(worker, `import { promises as closeFs } from 'node:fs';
    import { syncBuiltinESMExports as syncCloseExports } from 'node:module';
    const closeOpen = closeFs.open;
    closeFs.open = async (...args) => {
      const handle = await closeOpen(...args);
      if (String(args[0]).endsWith('a-found.txt')) handle.close = async () => new Promise(() => {});
      return handle;
    };
    syncCloseExports();\n${original}`)
  const closePartial = await runSearchProcess(request, new AbortController().signal, { budgetMs: 1500 })
  assert.equal(closePartial.stopReason, 'timeout')
  assert.equal(closePartial.workerStopped, true)
  assert.equal(closePartial.scannedFiles, 1)
  assert.deepEqual(closePartial.matches, normal.matches)
})
