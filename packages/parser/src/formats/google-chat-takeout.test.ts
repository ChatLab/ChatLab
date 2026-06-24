import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'

import { detectFormat, parseFileSync } from '../index'

interface FixtureMessage {
  message_id: string
  created_date?: string
  updated_date?: string
  creator: {
    email?: string
    name: string
    user_type: string
  }
  text?: string
  attached_files?: Array<{
    original_name?: string
    export_name?: string
  }>
  quoted_message_metadata?: {
    creator?: {
      email?: string
      name?: string
      user_type?: string
    }
    text?: string
  }
}

async function parseGoogleChatFixture(options: {
  chatType?: 'private' | 'group'
  chatName?: string
  date: string
  messages?: FixtureMessage[]
}) {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-google-chat-parser-'))
  try {
    const manifestPath = join(dir, 'google-chat-import.json')
    writeFileSync(
      manifestPath,
      JSON.stringify({
        format: 'chatlab-google-chat-takeout',
        version: 1,
        chatId: options.chatType === 'group' ? 'Groups/Space sample' : 'Groups/DM sample',
        chatType: options.chatType ?? 'private',
        chatName: options.chatName,
        userInfoFile: 'user_info.json',
        groupInfoFile: 'group_info.json',
        messagesFile: 'messages.json',
      }),
      'utf8'
    )
    writeFileSync(
      join(dir, 'user_info.json'),
      JSON.stringify({
        user: {
          email: 'Owner@Example.com',
          name: 'Owner',
          user_type: 'Human',
        },
      }),
      'utf8'
    )
    writeFileSync(
      join(dir, 'group_info.json'),
      JSON.stringify({
        name: options.chatType === 'group' ? options.chatName : undefined,
        members: [
          { email: 'Owner@Example.com', name: 'Owner', user_type: 'Human' },
          { email: 'Other@Example.com', name: 'Other User', user_type: 'Human' },
        ],
      }),
      'utf8'
    )
    writeFileSync(
      join(dir, 'messages.json'),
      JSON.stringify({
        messages: options.messages ?? [
          {
            message_id: 'message-1',
            created_date: options.date,
            creator: {
              email: 'Other@Example.com',
              name: 'Other User',
              user_type: 'Human',
            },
            text: 'Hello',
          },
          {
            message_id: 'message-2',
            created_date: options.date,
            creator: {
              email: 'Owner@Example.com',
              name: 'Owner',
              user_type: 'Human',
            },
            attached_files: [{ original_name: 'voice_message.m4a', export_name: 'File-voice_message.m4a' }],
          },
        ],
      }),
      'utf8'
    )

    assert.equal(detectFormat(manifestPath)?.id, 'google-chat-takeout')
    return await parseFileSync(manifestPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('google chat takeout parser', () => {
  it('parses Chinese UTC dates and attachment-only messages', async () => {
    const result = await parseGoogleChatFixture({
      date: '2026年5月29日星期五 UTC 03:00:29',
    })

    assert.deepEqual(result.meta, {
      name: 'Other User',
      platform: KNOWN_PLATFORMS.GOOGLE_CHAT,
      type: ChatType.PRIVATE,
      ownerId: 'owner@example.com',
    })
    assert.deepEqual(
      result.members.map((member) => member.platformId),
      ['owner@example.com', 'other@example.com']
    )
    assert.equal(result.messages[0].timestamp, Date.UTC(2026, 4, 29, 3, 0, 29) / 1000)
    assert.equal(result.messages[0].platformMessageId, 'message-1')
    assert.equal(result.messages[1].type, MessageType.FILE)
    assert.equal(result.messages[1].content, '[附件] voice_message.m4a')
  })

  it('parses English UTC dates with narrow no-break spaces', async () => {
    const result = await parseGoogleChatFixture({
      date: 'Friday, May 29, 2026 at 3:00:29\u202fAM UTC',
    })

    assert.equal(result.messages[0].timestamp, Date.UTC(2026, 4, 29, 3, 0, 29) / 1000)
  })

  it('preserves quoted text and attachment names alongside message text', async () => {
    const date = 'Friday, May 29, 2026 at 3:00:29 AM UTC'
    const result = await parseGoogleChatFixture({
      date,
      messages: [
        {
          message_id: 'message-3',
          created_date: date,
          creator: {
            email: 'Other@Example.com',
            name: 'Other User',
            user_type: 'Human',
          },
          text: 'Current reply',
          attached_files: [
            { original_name: 'photo.jpg', export_name: 'File-photo.jpg' },
            { export_name: 'File-document.pdf' },
          ],
          quoted_message_metadata: {
            creator: { name: 'Owner' },
            text: 'Original text',
          },
        },
      ],
    })

    assert.equal(result.messages[0].type, MessageType.TEXT)
    assert.equal(
      result.messages[0].content,
      ['> Owner: Original text', 'Current reply', '[附件] photo.jpg', '[附件] File-document.pdf'].join('\n')
    )
  })

  it('uses Space metadata and marks invalid dates for importer diagnostics', async () => {
    const result = await parseGoogleChatFixture({
      chatType: 'group',
      chatName: 'Project Space',
      date: 'Friday, February 31, 2026 at 3:00:29 AM UTC',
    })

    assert.equal(result.meta.name, 'Project Space')
    assert.equal(result.meta.type, ChatType.GROUP)
    assert.equal(result.meta.groupId, 'Groups/Space sample')
    assert.equal(Number.isNaN(result.messages[0].timestamp), true)
  })

  it('falls back to updated_date for edited messages without created_date', async () => {
    const result = await parseGoogleChatFixture({
      date: 'unused',
      messages: [
        {
          message_id: 'edited-message',
          updated_date: 'Friday, May 29, 2026 at 3:24:57\u202fAM UTC',
          creator: {
            email: 'Other@Example.com',
            name: 'Other User',
            user_type: 'Human',
          },
          text: 'Edited text',
        },
      ],
    })

    assert.equal(result.messages[0].timestamp, Date.UTC(2026, 4, 29, 3, 24, 57) / 1000)
  })
})
