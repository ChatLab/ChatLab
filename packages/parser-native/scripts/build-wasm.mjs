import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const crateDirectory = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(crateDirectory, '../web-runtime/src/wasm/generated')
const version = spawnSync('wasm-pack', ['--version'], { encoding: 'utf8' })

if (version.error) throw version.error
if (version.status !== 0) process.exit(version.status ?? 1)
if (version.stdout.trim() !== 'wasm-pack 0.15.0') {
  throw new Error(`Expected wasm-pack 0.15.0, received: ${version.stdout.trim() || 'unknown version'}`)
}

const result = spawnSync(
  'wasm-pack',
  [
    'build',
    '--target',
    'web',
    '--release',
    '--out-dir',
    outputDirectory,
    '--out-name',
    'parser_native',
    '--',
    '--locked',
    '--no-default-features',
    '--features',
    'wasm',
  ],
  { cwd: crateDirectory, stdio: 'inherit' }
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

// wasm-pack emits npm metadata that would be detected as a nested pnpm workspace.
rmSync(resolve(outputDirectory, 'package.json'), { force: true })
rmSync(resolve(outputDirectory, '.gitignore'), { force: true })
