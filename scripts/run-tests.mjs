#!/usr/bin/env node

import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CHATLAB_TEMP_ROOT_ENV, getChatLabTempScopeDir } from './chatlab-temp.mjs'

const SKIP_DIRS = new Set([
  '.git',
  '.docs',
  'node_modules',
  'dist',
  'dist-web',
  'out',
  'build',
  'coverage',
  '.vitepress',
])

const TEST_FILE_RE = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|mts|cjs|cts)$/
const SUPPORTED_NODE_MAJOR = 24
const TEST_RUN_TEMP_PREFIX = 'run-'
export const TEST_RUN_TEMP_ENV = 'CHATLAB_TEST_TMPDIR'

function normalizePath(filePath) {
  return filePath.split(sep).join('/')
}

export function filterDefaultTestFiles(files) {
  return files
    .map(normalizePath)
    .filter((file) => TEST_FILE_RE.test(file))
    .filter((file) => !file.startsWith('tests/e2e/'))
    .filter((file) => !file.includes('/smoke/'))
    .filter((file) => !file.includes('.smoke.test.'))
    .filter((file) => !file.includes('.e2e.test.'))
}

function collectFiles(rootDir, dir = rootDir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      files.push(...collectFiles(rootDir, join(dir, entry.name)))
      continue
    }

    if (!entry.isFile()) continue

    const filePath = join(dir, entry.name)
    files.push(normalizePath(relative(rootDir, filePath)))
  }

  return files
}

export function collectDefaultTestFiles(rootDir = process.cwd()) {
  if (!statSync(rootDir).isDirectory()) {
    throw new Error(`Test root is not a directory: ${rootDir}`)
  }
  return filterDefaultTestFiles(collectFiles(rootDir)).sort()
}

export function buildNodeTestArgs(testArgs) {
  return ['--experimental-test-module-mocks', '--import', 'tsx', '--test', ...testArgs]
}

export function checkSupportedNodeVersion(version = process.versions.node) {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10)
  if (major === SUPPORTED_NODE_MAJOR) return { ok: true }
  return {
    ok: false,
    message: `ChatLab tests require Node.js >=24 <25. Current Node.js is ${version}. Switch to Node 24 before running tests.`,
  }
}

export function buildTestEnvironment(tempRoot, env = process.env) {
  return { ...env, TMPDIR: tempRoot, [TEST_RUN_TEMP_ENV]: tempRoot, [CHATLAB_TEMP_ROOT_ENV]: tempRoot }
}

export function withTestRunTempRoot(callback, parentDir = getChatLabTempScopeDir('tests')) {
  const resolvedParent = resolve(parentDir)
  const tempRoot = mkdtempSync(join(resolvedParent, TEST_RUN_TEMP_PREFIX))
  const resolvedRoot = resolve(tempRoot)
  if (dirname(resolvedRoot) !== resolvedParent || !basename(resolvedRoot).startsWith(TEST_RUN_TEMP_PREFIX)) {
    throw new Error(`Refusing to use non-owned test run temp root: ${resolvedRoot}`)
  }
  try {
    return callback(tempRoot)
  } finally {
    rmSync(resolvedRoot, { recursive: true, force: true })
  }
}

function run() {
  const nodeVersion = checkSupportedNodeVersion()
  if (!nodeVersion.ok) {
    console.error(nodeVersion.message)
    process.exit(1)
  }

  const explicitArgs = process.argv.slice(2)
  const testArgs = explicitArgs.length > 0 ? explicitArgs : collectDefaultTestFiles()

  if (testArgs.length === 0) {
    console.error('No test files found.')
    process.exit(1)
  }

  if (explicitArgs.length === 0) {
    console.log(`Running ${testArgs.length} default test files.`)
  }

  const result = withTestRunTempRoot((tempRoot) =>
    spawnSync(process.execPath, buildNodeTestArgs(testArgs), {
      stdio: 'inherit',
      env: buildTestEnvironment(tempRoot),
    })
  )

  if (result.error) {
    throw result.error
  }

  process.exit(result.status ?? 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run()
}
