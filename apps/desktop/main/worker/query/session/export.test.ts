import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import { BetterSqliteAdapter } from '@openchatlab/node-runtime/src/better-sqlite3-adapter'
import { exportFilterResultToFile } from './export'

test('closes the export database after writing the file', () => {
  const outputDir = fs.mkdtempSync(path.join(process.env.CHATLAB_TEST_TMPDIR ?? os.tmpdir(), 'chatlab-desktop-export-'))
  const rawDb = new Database(':memory:', {
    nativeBinding: path.resolve('apps/cli/native/better_sqlite3.node'),
  })
  rawDb.exec(CHAT_DB_SCHEMA)
  rawDb.exec(`
    INSERT INTO meta (name, platform, type, imported_at)
    VALUES ('Export test', 'qq', 'private', 1);
    INSERT INTO member (id, platform_id, account_name)
    VALUES (1, 'alice', 'Alice');
    INSERT INTO message (sender_id, ts, type, content)
    VALUES (1, 1, 0, 'hello');
  `)

  let closeCount = 0
  const adapter = new BetterSqliteAdapter(rawDb)
  const close = adapter.close.bind(adapter)
  adapter.close = () => {
    closeCount += 1
    close()
  }

  try {
    const result = exportFilterResultToFile(
      {
        sessionId: 'export-test',
        sessionName: 'Export test',
        outputDir,
      },
      () => adapter
    )

    assert.equal(result.success, true)
    assert.equal(closeCount, 1)
    assert.equal(fs.existsSync(result.filePath!), true)
  } finally {
    if (rawDb.open) rawDb.close()
    fs.rmSync(outputDir, { recursive: true, force: true })
  }
})
