import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import { openBetterSqliteDatabase } from '../better-sqlite3-adapter'
import { analyzeIncrementalImport, incrementalImport, type IncrementalImportDeps } from './incremental-importer'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-incremental-import-'))
}

function writeChatLabJsonl(filePath: string): void {
  const lines = [
    {
      _type: 'header',
      chatlab: { version: '0.0.2', exportedAt: 1780330900 },
      meta: { name: 'CipherTalk Export', platform: 'wechat', type: 'private' },
    },
    {
      _type: 'member',
      platformId: 'wxid_alice',
      accountName: 'Alice',
    },
    {
      _type: 'message',
      sender: 'wxid_alice',
      accountName: 'Alice',
      timestamp: '1780330832',
      type: 0,
      content: 'hello from CipherTalk',
    },
  ]

  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
}

function writeMediaJsonl(filePath: string): void {
  const lines = [
    {
      _type: 'header',
      chatlab: { version: '0.0.2', exportedAt: 1780330900 },
      meta: { name: 'CipherTalk Export', platform: 'wechat', type: 'private' },
    },
    {
      _type: 'member',
      platformId: 'wxid_alice',
      accountName: 'Alice',
    },
    {
      _type: 'message',
      sender: 'wxid_alice',
      accountName: 'Alice',
      timestamp: '1780330832',
      type: 0,
      content: 'images/photo.jpg',
      platformMessageId: 'media-1',
    },
  ]

  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
}

function seedSessionDb(dbPath: string): void {
  const db = openBetterSqliteDatabase(dbPath, { nativeBinding })
  db.exec(CHAT_DB_SCHEMA)
  db.prepare(
    `INSERT INTO meta (name, platform, type, imported_at, schema_version)
     VALUES (?, ?, ?, ?, ?)`
  ).run('Existing Session', 'wechat', 'private', 1780330000, 6)
  db.close()
}

function createDeps(dbPath: string): IncrementalImportDeps {
  return {
    openDatabase: (_sessionId, readonly = false) => openBetterSqliteDatabase(dbPath, { readonly, nativeBinding }),
    onProgress: () => {},
  }
}

test('imports ChatLab JSONL messages with numeric string timestamps consistently with analysis', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const dbPath = path.join(tempDir, 'session.db')
  const filePath = path.join(tempDir, 'cipher-talk.jsonl')
  seedSessionDb(dbPath)
  writeChatLabJsonl(filePath)

  const deps = createDeps(dbPath)

  const analysis = await analyzeIncrementalImport('session', filePath, deps)
  assert.deepEqual(analysis, {
    newMessageCount: 1,
    duplicateCount: 0,
    totalInFile: 1,
  })

  const result = await incrementalImport('session', filePath, deps)
  assert.equal(result.success, true)
  assert.equal(result.newMessageCount, 1)
  assert.equal(result.batch?.writtenCount, 1)
  assert.equal(result.batch?.errorCount, 0)

  const db = openBetterSqliteDatabase(dbPath, { readonly: true, nativeBinding })
  const row = db.prepare('SELECT ts, content FROM message').get() as { ts: number; content: string } | undefined
  db.close()

  assert.deepEqual(row, {
    ts: 1780330832,
    content: 'hello from CipherTalk',
  })
})

test('cleans newly archived media files when incremental import rolls back', async (t) => {
  const tempDir = makeTempDir()
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const dbPath = path.join(tempDir, 'session.db')
  const importDir = path.join(tempDir, 'import')
  const imageDir = path.join(importDir, 'images')
  const mediaDir = path.join(tempDir, 'media', 'session')
  fs.mkdirSync(imageDir, { recursive: true })
  fs.mkdirSync(mediaDir, { recursive: true })
  const imagePath = path.join(imageDir, 'photo.jpg')
  fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  fs.writeFileSync(path.join(mediaDir, 'existing.jpg'), 'existing')
  const existingArchiveName = `00000001-${crypto.createHash('sha1').update(fs.realpathSync(imagePath)).digest('hex').slice(0, 10)}-photo.jpg`
  fs.writeFileSync(path.join(mediaDir, existingArchiveName), 'preexisting archive')

  const filePath = path.join(importDir, 'media.jsonl')
  seedSessionDb(dbPath)
  writeMediaJsonl(filePath)

  const db = openBetterSqliteDatabase(dbPath, { nativeBinding })
  db.exec(`
    CREATE TRIGGER fail_media_insert
    BEFORE INSERT ON message
    WHEN NEW.media_path IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'forced media insert failure');
    END;
  `)
  db.close()

  const originalConsoleError = console.error
  console.error = () => {}
  let result: Awaited<ReturnType<typeof incrementalImport>>
  try {
    result = await incrementalImport('session', filePath, {
      ...createDeps(dbPath),
      getSessionMediaDir: () => mediaDir,
    })
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(result.success, false)
  assert.equal(fs.existsSync(path.join(mediaDir, 'existing.jpg')), true)
  assert.deepEqual(fs.readdirSync(mediaDir).sort(), [existingArchiveName, 'existing.jpg'].sort())
})
