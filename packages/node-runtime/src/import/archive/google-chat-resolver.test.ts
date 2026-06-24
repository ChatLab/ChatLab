import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'

import { ZipArchiveReader } from './archive-reader'
import { ArchiveImportError } from './errors'
import { GoogleChatTakeoutResolver } from './google-chat-resolver'
import { writeZipFixture } from './test-utils'

class CountingZipArchiveReader extends ZipArchiveReader {
  visitCount = 0

  override async visitEntries(...args: Parameters<ZipArchiveReader['visitEntries']>): Promise<void> {
    this.visitCount++
    return super.visitEntries(...args)
  }
}

function createTakeoutZip(
  zipPath: string,
  options: {
    mixedProduct?: boolean
    omitGroupInfo?: boolean
    omitMessages?: boolean
  } = {}
): void {
  const entries = [
    {
      name: 'Takeout/Google Chat/Users/User sample/user_info.json',
      content: JSON.stringify({
        user: { email: 'owner@example.com', name: 'Owner', user_type: 'Human' },
      }),
    },
    ...(!options.omitGroupInfo
      ? [
          {
            name: 'Takeout/Google Chat/Groups/DM sample/group_info.json',
            content: JSON.stringify({
              members: [
                { email: 'owner@example.com', name: 'Owner', user_type: 'Human' },
                { email: 'other@example.com', name: 'Other User', user_type: 'Human' },
              ],
            }),
          },
        ]
      : []),
    ...(!options.omitMessages
      ? [
          {
            name: 'Takeout/Google Chat/Groups/DM sample/messages.json',
            content: JSON.stringify({
              messages: [
                {
                  message_id: 'dm-1',
                  created_date: 'Friday, May 29, 2026 at 3:00:29 AM UTC',
                  creator: { email: 'other@example.com', name: 'Other User', user_type: 'Human' },
                  text: 'Hello',
                },
                {
                  message_id: 'dm-2',
                  created_date: 'Friday, May 29, 2026 at 3:01:29 AM UTC',
                  creator: { email: 'owner@example.com', name: 'Owner', user_type: 'Human' },
                  attached_files: [{ original_name: 'photo.jpg', export_name: 'File-photo.jpg' }],
                },
              ],
            }),
          },
        ]
      : []),
    {
      name: 'Takeout/Google Chat/Groups/DM sample/File-测试.txt',
      content: 'attachment bytes must not be extracted',
    },
    {
      name: 'Takeout/Google Chat/Groups/Space project/group_info.json',
      content: JSON.stringify({
        name: 'Project Space',
        members: [
          { email: 'owner@example.com', name: 'Owner', user_type: 'Human' },
          { email: 'member@example.com', name: 'Member', user_type: 'Human' },
        ],
      }),
    },
    {
      name: 'Takeout/Google Chat/Groups/Space project/messages.json',
      content: JSON.stringify({ messages: [] }),
    },
    ...(options.mixedProduct ? [{ name: 'Takeout/Drive/file.txt', content: 'unrelated' }] : []),
  ]

  writeZipFixture(zipPath, entries)
}

describe('GoogleChatTakeoutResolver', () => {
  it('detects and scans DMs, Spaces, and empty conversations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlab-google-chat-resolver-'))
    try {
      const zipPath = join(dir, 'takeout.zip')
      createTakeoutZip(zipPath)
      const reader = new ZipArchiveReader(zipPath)
      const entries = await reader.listEntries()
      const resolver = new GoogleChatTakeoutResolver()

      assert.equal(resolver.detect(entries), true)
      assert.deepEqual(await resolver.scan(reader), [
        {
          chatId: 'Groups/DM sample',
          name: 'Other User',
          type: 'private',
          messageCount: 2,
          memberCount: 2,
        },
        {
          chatId: 'Groups/Space project',
          name: 'Project Space',
          type: 'group',
          messageCount: 0,
          memberCount: 2,
        },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('materializes only selected JSON entries with a fixed internal manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlab-google-chat-materialize-'))
    try {
      const zipPath = join(dir, 'takeout.zip')
      const targetDir = join(dir, 'selected')
      createTakeoutZip(zipPath)
      const resolver = new GoogleChatTakeoutResolver()
      const reader = new CountingZipArchiveReader(zipPath)
      const chats = await resolver.scan(reader)

      const materialized = await resolver.materialize(reader, chats[0], targetDir)
      assert.equal(reader.visitCount, 3)
      assert.equal(materialized.manifestPath, join(targetDir, 'google-chat-import.json'))
      assert.deepEqual(readdirSync(targetDir).sort(), [
        'google-chat-import.json',
        'group_info.json',
        'messages.json',
        'user_info.json',
      ])
      assert.equal(existsSync(join(targetDir, 'File-测试.txt')), false)
      assert.deepEqual(JSON.parse(readFileSync(materialized.manifestPath, 'utf8')), {
        format: 'chatlab-google-chat-takeout',
        version: 1,
        chatId: 'Groups/DM sample',
        chatType: 'private',
        chatName: 'Other User',
        userInfoFile: 'user_info.json',
        groupInfoFile: 'group_info.json',
        messagesFile: 'messages.json',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects mixed Takeout products and incomplete conversation structures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlab-google-chat-invalid-'))
    try {
      const mixedPath = join(dir, 'mixed.zip')
      createTakeoutZip(mixedPath, { mixedProduct: true })
      const resolver = new GoogleChatTakeoutResolver()
      assert.equal(resolver.detect(await new ZipArchiveReader(mixedPath).listEntries()), false)

      for (const [name, options] of [
        ['missing-group.zip', { omitGroupInfo: true }],
        ['missing-messages.zip', { omitMessages: true }],
      ] as const) {
        const zipPath = join(dir, name)
        createTakeoutZip(zipPath, options)
        await assert.rejects(
          () => resolver.scan(new ZipArchiveReader(zipPath)),
          (error) => error instanceof ArchiveImportError && error.code === 'error.google_chat_conversation_incomplete'
        )
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
