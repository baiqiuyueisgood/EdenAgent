import { spawn } from 'node:child_process'
import path from 'node:path'

import { discoverTestFiles } from './discover_tests.mjs'

const roots = process.argv.slice(2)
const tests = await discoverTestFiles(roots)
if (tests.length === 0) {
  throw new Error(`No test files found below: ${roots.join(', ')}`)
}

const relativeTests = tests.map(file => path.relative(process.cwd(), file))
console.log(`[test-discovery] ${relativeTests.length} test files`)
for (const root of roots) {
  const absoluteRoot = path.resolve(root)
  const count = tests.filter(file => file === absoluteRoot || file.startsWith(`${absoluteRoot}${path.sep}`)).length
  console.log(`[test-discovery] ${root}: ${count}`)
}

// Integration files create their own model/runtime processes; CPU-count parallelism exhausts startup deadlines.
const concurrency = Number(process.env.EDEN_TEST_CONCURRENCY ?? 2)
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('EDEN_TEST_CONCURRENCY must be between 1 and 32')
const child = spawn(process.execPath, ['--import', 'tsx', '--test', `--test-concurrency=${concurrency}`, ...relativeTests], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})

child.once('error', error => {
  console.error(error)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`[test-discovery] test process stopped by ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})

