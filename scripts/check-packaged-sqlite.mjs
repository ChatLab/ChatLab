#!/usr/bin/env node
/**
 * Verify that the packaged Windows Electron runtime can load the shipped
 * better-sqlite3 binding and execute a real SQLite query.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFile = fileURLToPath(import.meta.url)
const repoRoot = resolve(import.meta.dirname, '..')
const defaultDistDir = join(repoRoot, 'apps', 'desktop', 'dist')
const desktopRequire = createRequire(join(repoRoot, 'apps', 'desktop', 'package.json'))

export function getPackagedSqlitePaths(distDir) {
  const appDir = join(distDir, 'win-unpacked')
  return {
    executablePath: join(appDir, 'ChatLab.exe'),
    bindingPath: join(appDir, 'resources', 'native', 'better_sqlite3.node'),
  }
}

function assertNonEmptyFile(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`)
  if (statSync(filePath).size === 0) throw new Error(`${label} is empty: ${filePath}`)
}

function safeChildError(result) {
  return (result.stderr || result.stdout || result.error?.message || `child exited with status ${result.status}`).trim()
}

/**
 * 使用最终 ChatLab.exe 的 Electron ABI 加载最终 binding，并执行真实内存 SQLite 查询。
 * 该检查只读成品文件且只创建内存数据库，不会访问任何用户数据目录。
 */
export function verifyPackagedSqlite({
  distDir = defaultDistDir,
  betterSqliteEntry = desktopRequire.resolve('better-sqlite3'),
  spawn = spawnSync,
} = {}) {
  const { executablePath, bindingPath } = getPackagedSqlitePaths(distDir)
  assertNonEmptyFile(executablePath, 'Packaged ChatLab executable')
  assertNonEmptyFile(bindingPath, 'Packaged better-sqlite3 binding')

  const probe = `
    const Database = require(process.argv[1]);
    const db = new Database(':memory:', { nativeBinding: process.argv[2] });
    const row = db.prepare('SELECT 1 AS value').get();
    db.close();
    process.stdout.write(JSON.stringify({ abi: process.versions.modules, value: row.value }));
  `
  const result = spawn(executablePath, ['-e', probe, betterSqliteEntry, bindingPath], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })

  if (result.status !== 0) {
    throw new Error(`Packaged better-sqlite3 failed to load: ${safeChildError(result)}`)
  }

  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`Invalid packaged SQLite probe output: ${result.stdout}`, { cause: error })
  }
  if (parsed.value !== 1 || typeof parsed.abi !== 'string') {
    throw new Error(`Invalid packaged SQLite probe result: ${JSON.stringify(parsed)}`)
  }
  return { abi: parsed.abi, value: parsed.value }
}

function main() {
  try {
    const result = verifyPackagedSqlite()
    console.log(`[check-packaged-sqlite] OK: Electron ABI ${result.abi}, SELECT 1 = ${result.value}`)
  } catch (error) {
    console.error(`[check-packaged-sqlite] FAILED: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && currentFile === resolve(process.argv[1])) main()
