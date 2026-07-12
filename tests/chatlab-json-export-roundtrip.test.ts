import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { detectFormat, parseFileSync } from '@openchatlab/parser'
import { CHAT_DB_SCHEMA } from '../packages/core/src/schema/tables'
import { BetterSqliteAdapter } from '../packages/node-runtime/src/better-sqlite3-adapter'
import { exportWithFormat } from '../packages/node-runtime/src/export/format-exporter'
import { streamingImport } from '../packages/node-runtime/src/import/streaming-importer'
import { writeParseResultToDb } from '../packages/node-runtime/src/import/write-parse-result'

test('exports JSON as ChatLab format that can be parsed for re-import', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'chatlab-json-export-'))
  const filePath = join(tempDir, 'roundtrip.json')
  const rawDb = new Database(':memory:')

  try {
    rawDb.exec(CHAT_DB_SCHEMA)
    rawDb
      .prepare(
        `INSERT INTO meta (name, platform, type, imported_at, group_id, group_avatar, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('测试群', 'qq', 'group', 100, 'group-1', 'group-avatar', 'alice')

    const insertMember = rawDb.prepare(
      `INSERT INTO member (platform_id, account_name, group_nickname, aliases, avatar, roles)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    const aliceId = insertMember.run(
      'alice',
      'Alice Account',
      '爱丽丝',
      JSON.stringify(['Alice']),
      'alice-avatar',
      JSON.stringify([{ id: 'owner' }])
    ).lastInsertRowid
    const bobId = insertMember.run('bob', 'Bob Account', '鲍勃', '[]', null, '[]').lastInsertRowid

    const insertMessage = rawDb.prepare(
      `INSERT INTO message
        (sender_id, sender_account_name, sender_group_nickname, ts, type, content, platform_message_id, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    insertMessage.run(aliceId, 'Alice Account', '爱丽丝', 100, 0, '筛选范围外', 'msg-1', null)
    insertMessage.run(bobId, 'Bob Account', '鲍勃', 200, 0, '你好', 'msg-2', null)
    insertMessage.run(bobId, 'Bob Account', '鲍勃', 250, 1, null, 'msg-3', 'msg-2')

    const result = exportWithFormat(
      {
        sessionId: 'session-1',
        sessionName: 'UI 中的会话名',
        format: 'json',
        timeFilter: { startTs: 150, endTs: 300 },
      },
      () => new BetterSqliteAdapter(rawDb)
    )

    assert.equal(result.success, true)
    const exported = JSON.parse(result.content)
    assert.equal(exported.chatlab.version, '0.0.2')
    assert.equal(exported.meta.ownerId, 'alice')
    assert.deepEqual(exported.members[0].aliases, ['Alice'])
    assert.deepEqual(
      exported.messages.map((message: { timestamp: number }) => message.timestamp),
      [200, 250]
    )

    writeFileSync(filePath, result.content, 'utf8')
    assert.equal(detectFormat(filePath)?.id, 'chatlab')

    const nativePerfDisabled = process.env.CHATLAB_DISABLE_NATIVE_PERF
    process.env.CHATLAB_DISABLE_NATIVE_PERF = '1'
    const parsed = await parseFileSync(filePath).finally(() => {
      if (nativePerfDisabled === undefined) {
        delete process.env.CHATLAB_DISABLE_NATIVE_PERF
      } else {
        process.env.CHATLAB_DISABLE_NATIVE_PERF = nativePerfDisabled
      }
    })
    assert.deepEqual(parsed.meta, {
      name: '测试群',
      platform: 'qq',
      type: 'group',
      groupId: 'group-1',
      groupAvatar: 'group-avatar',
      ownerId: 'alice',
    })
    assert.deepEqual(
      parsed.members.map((member) => ({
        platformId: member.platformId,
        accountName: member.accountName,
        groupNickname: member.groupNickname,
        aliases: member.aliases,
        roles: member.roles,
      })),
      [
        {
          platformId: 'alice',
          accountName: 'Alice Account',
          groupNickname: '爱丽丝',
          aliases: ['Alice'],
          roles: [{ id: 'owner' }],
        },
        {
          platformId: 'bob',
          accountName: 'Bob Account',
          groupNickname: '鲍勃',
          aliases: undefined,
          roles: undefined,
        },
      ]
    )
    assert.deepEqual(parsed.messages, [
      {
        senderPlatformId: 'bob',
        senderAccountName: 'Bob Account',
        senderGroupNickname: '鲍勃',
        timestamp: 200,
        type: 0,
        content: '你好',
        platformMessageId: 'msg-2',
        replyToMessageId: undefined,
      },
      {
        senderPlatformId: 'bob',
        senderAccountName: 'Bob Account',
        senderGroupNickname: '鲍勃',
        timestamp: 250,
        type: 1,
        content: null,
        platformMessageId: 'msg-3',
        replyToMessageId: 'msg-2',
      },
    ])

    const sharedWriterDb = new Database(':memory:')
    try {
      sharedWriterDb.exec(CHAT_DB_SCHEMA)
      writeParseResultToDb(new BetterSqliteAdapter(sharedWriterDb), parsed.meta, parsed.members, parsed.messages)
      const sharedWriterAlice = sharedWriterDb
        .prepare("SELECT aliases FROM member WHERE platform_id = 'alice'")
        .get() as { aliases: string }
      assert.deepEqual(JSON.parse(sharedWriterAlice.aliases), ['Alice'])
    } finally {
      sharedWriterDb.close()
    }

    const importedDbPath = join(tempDir, 'imported.db')
    const importResult = await streamingImport(
      filePath,
      {
        openDatabase() {
          const db = new Database(importedDbPath)
          db.exec(CHAT_DB_SCHEMA)
          return new BetterSqliteAdapter(db)
        },
        deleteDatabase() {
          /* temp directory cleanup is handled by the outer finally */
        },
        onProgress() {
          /* progress is outside this round-trip assertion */
        },
      },
      undefined,
      'imported-session'
    )
    assert.equal(importResult.success, true)

    const importedDb = new Database(importedDbPath)
    try {
      const importedMeta = importedDb.prepare('SELECT owner_id FROM meta').get() as { owner_id: string | null }
      const importedAlice = importedDb.prepare("SELECT aliases FROM member WHERE platform_id = 'alice'").get() as {
        aliases: string
      }
      assert.equal(importedMeta.owner_id, 'alice')
      assert.deepEqual(JSON.parse(importedAlice.aliases), ['Alice'])
    } finally {
      importedDb.close()
    }
  } finally {
    rawDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
})
