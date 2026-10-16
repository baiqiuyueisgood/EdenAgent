import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

function buildOptions(root, outdir) {
  return { absWorkingDir: root, outdir, outExtension: { '.js': '.mjs' }, bundle: true,
    platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
    define: { EDEN_BUNDLED_SERVER: 'true' },
    banner: { js: "import { createRequire as serverCreateRequire } from 'node:module'; const require = serverCreateRequire(import.meta.url);" } }
}

export function buildRuntimeWorker(root, outdir = 'dist/server') {
  return build({ ...buildOptions(root, outdir), entryPoints: { 'runtime-process': 'packages/runtime-pi/src/process-entry.ts' },
    external: ['ws', 'esbuild'] })
}

export async function buildServer(root = fileURLToPath(new URL('../../', import.meta.url))) {
  const common = buildOptions(root, 'dist/server')
  // Workers are created per turn; bundle the public SDK graph to avoid resolving many separate modules again.
  await Promise.all([
    build({ ...common, entryPoints: { main: 'Server/src/main.ts',
      'workspace-search-worker': 'Server/src/modules/workspace/workspace-search-worker.ts' },
      external: ['@earendil-works/*', 'ws', 'zod', 'typebox', 'esbuild', 'playwright-core'] }),
    buildRuntimeWorker(root),
  ])
  process.stdout.write('Built Server and bundled isolated runtime worker\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await buildServer()
