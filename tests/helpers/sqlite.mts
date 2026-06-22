import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'

export const testSqliteNativeBinding = resolve('apps/cli/native/better_sqlite3.node')

function assertTestSqliteNativeBinding(): string {
  if (!existsSync(testSqliteNativeBinding)) {
    throw new Error(
      `Missing test better-sqlite3 native binding: ${testSqliteNativeBinding}. ` +
        'Run `pnpm --filter chatlab-cli run ensure-native` first.'
    )
  }

  // 先用当前 Node 进程验证 ABI，避免 better-sqlite3 抛出难读的默认绑定错误。
  const result = spawnSync(
    process.execPath,
    ['-e', 'require(process.argv[1]); process.stdout.write(process.versions.modules)', testSqliteNativeBinding],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || 'native binding failed to load').trim()
    throw new Error(
      `Invalid test better-sqlite3 native binding: ${testSqliteNativeBinding}. ${detail}. ` +
        'Run `pnpm --filter chatlab-cli run ensure-native` to rebuild it for the current Node.js.'
    )
  }

  return testSqliteNativeBinding
}

export function openTestSqliteDatabase(
  filename: string = ':memory:',
  options?: Omit<Database.Options, 'nativeBinding'>
) {
  return new Database(filename, {
    ...options,
    nativeBinding: assertTestSqliteNativeBinding(),
  })
}
