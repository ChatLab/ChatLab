/**
 * MigrationRunner
 *
 * 在应用启动时执行所有待执行的数据迁移。
 * 版本号存储在 ~/.chatlab/.migration-version 文件中。
 */

import * as fs from 'fs'
import * as path from 'path'
import type { Migration, MigrationContext } from './types'

const VERSION_FILE = '.migration-version'

export class MigrationRunner {
  private migrations: Migration[]
  private context: MigrationContext

  constructor(migrations: Migration[], context: MigrationContext) {
    this.migrations = [...migrations].sort((a, b) => a.version - b.version)
    this.context = context
  }

  getCurrentVersion(): number {
    const versionPath = path.join(this.context.dataDir, VERSION_FILE)
    try {
      if (fs.existsSync(versionPath)) {
        const raw = fs.readFileSync(versionPath, 'utf-8').trim()
        const ver = parseInt(raw, 10)
        return Number.isFinite(ver) ? ver : 0
      }
    } catch {
      // version file unreadable, treat as 0
    }
    return 0
  }

  private writeVersion(version: number): void {
    const versionPath = path.join(this.context.dataDir, VERSION_FILE)
    if (!fs.existsSync(this.context.dataDir)) {
      fs.mkdirSync(this.context.dataDir, { recursive: true })
    }
    fs.writeFileSync(versionPath, String(version), 'utf-8')
  }

  async run(): Promise<{ executed: number; currentVersion: number }> {
    const currentVersion = this.getCurrentVersion()
    const pending = this.migrations.filter((m) => m.version > currentVersion)

    if (pending.length === 0) {
      return { executed: 0, currentVersion }
    }

    this.context.logger.info('Migration', `${pending.length} pending migration(s), current version: ${currentVersion}`)

    let lastVersion = currentVersion
    let executed = 0

    for (const migration of pending) {
      this.context.logger.info('Migration', `Running: v${lastVersion}→v${migration.version} ${migration.name}`)
      try {
        await migration.up(this.context)
      } catch (err) {
        this.context.logger.error('Migration', `Failed: ${migration.name}`, err)
        break
      }

      try {
        this.writeVersion(migration.version)
      } catch (err) {
        this.context.logger.error('Migration', `Failed to persist version ${migration.version}`, err)
        throw err
      }

      lastVersion = migration.version
      executed++
      this.context.logger.info('Migration', `Completed: ${migration.name}`)
    }

    return { executed, currentVersion: lastVersion }
  }
}
