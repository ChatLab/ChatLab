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
    })
    assert.deepEqual(
      parsed.members.map((member) => ({
        platformId: member.platformId,
        accountName: member.accountName,
        groupNickname: member.groupNickname,
        roles: member.roles,
      })),
      [
        {
          platformId: 'alice',
          accountName: 'Alice Account',
          groupNickname: '爱丽丝',
          roles: [{ id: 'owner' }],
        },
        {
          platformId: 'bob',
          accountName: 'Bob Account',
          groupNickname: '鲍勃',
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
  } finally {
    rawDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
})
