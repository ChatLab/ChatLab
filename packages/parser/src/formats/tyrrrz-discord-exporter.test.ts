import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ChatType } from '@openchatlab/shared-types'

import { detectFormat, parseFileSync } from '../index'

const cases = [
  { channelType: 'DirectTextChat', guildName: 'Direct Messages', expectedType: ChatType.PRIVATE },
  { channelType: 'DirectGroupTextChat', guildName: 'Direct Messages', expectedType: ChatType.GROUP },
  { channelType: 'GuildTextChat', guildName: 'Example server', expectedType: ChatType.GROUP },
  { channelType: undefined, guildName: 'Direct Messages', expectedType: ChatType.GROUP },
]

for (const { channelType, guildName, expectedType } of cases) {
  test(`Discord export classifies ${channelType ?? 'missing channel type'} without losing messages`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'chatlab-discord-parser-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const filePath = join(directory, 'discord.json')
    writeFileSync(
      filePath,
      JSON.stringify({
        guild: {
          id: guildName === 'Direct Messages' ? '0' : 'server-1',
          name: guildName,
          iconUrl: 'https://example.com/icon.png',
        },
        channel: { id: 'channel-1', type: channelType, categoryId: null, category: null, name: 'Alice', topic: null },
        messages: ['Alice', 'Bob'].map((name, index) => ({
          id: String(index + 1),
          type: 'Default',
          timestamp: `2026-01-01T00:00:0${index}Z`,
          content: `Hello from ${name}`,
          author: { id: name, name, discriminator: '0000', isBot: false, roles: [] },
          attachments: [],
          embeds: [],
          stickers: [],
        })),
      }),
      'utf8'
    )

    assert.equal(detectFormat(filePath)?.id, 'discord-tyrrrz')
    const result = await parseFileSync(filePath)
    assert.equal(result.meta.type, expectedType)
    assert.equal(result.meta.platform, 'discord')
    const isPrivate = expectedType === ChatType.PRIVATE
    assert.equal(result.meta.name, isPrivate ? 'Alice' : `${guildName} - Alice`)
    assert.equal(result.meta.groupId, 'channel-1')
    assert.equal(result.meta.groupAvatar, isPrivate ? undefined : 'https://example.com/icon.png')
    assert.deepEqual(
      result.members.map((member) => member.platformId),
      ['Alice', 'Bob']
    )
    assert.deepEqual(
      result.messages.map((message) => message.content),
      ['Hello from Alice', 'Hello from Bob']
    )
  })
}
