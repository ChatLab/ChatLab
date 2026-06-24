import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'
import { parseFileSync } from '@openchatlab/parser'

import { ArchiveImportSourceManager } from './source-manager'
import { writeZipFixture } from './test-utils'

function createLocalizedTakeout(zipPath: string, createdDate: string): void {
  writeZipFixture(zipPath, [
    {
      name: 'Takeout/Google Chat/Users/User sample/user_info.json',
      content: JSON.stringify({ user: { email: 'owner@example.com', name: 'Owner' } }),
    },
    {
      name: 'Takeout/Google Chat/Groups/DM sample/group_info.json',
      content: JSON.stringify({
        members: [
          { email: 'owner@example.com', name: 'Owner' },
          { email: 'other@example.com', name: 'Other User' },
        ],
      }),
    },
    {
      name: 'Takeout/Google Chat/Groups/DM sample/messages.json',
      content: JSON.stringify({
        messages: [
          {
            message_id: 'message-1',
            created_date: createdDate,
            creator: { email: 'other@example.com', name: 'Other User' },
            attached_files: [{ original_name: 'voice.m4a', export_name: 'File-voice.m4a' }],
          },
        ],
      }),
    },
    {
      name: 'Takeout/Google Chat/Groups/DM sample/File-voice.m4a',
      content: 'attachment bytes',
    },
  ])
}

describe('Google Chat archive import integration', () => {
  for (const [locale, createdDate] of [
    ['Chinese', '2026年5月29日星期五 UTC 03:00:29'],
    ['English', 'Friday, May 29, 2026 at 3:00:29\u202fAM UTC'],
  ] as const) {
    it(`materializes and parses the ${locale} Takeout date format`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'chatlab-google-chat-integration-'))
      try {
        const zipPath = join(dir, `${locale}.zip`)
        createLocalizedTakeout(zipPath, createdDate)
        const manager = new ArchiveImportSourceManager({ tempRoot: join(dir, 'temp') })
        const source = await manager.prepareLocalArchive(zipPath)

        const parsed = await manager.withMaterializedChat(source.sourceId, 'Groups/DM sample', parseFileSync)
        assert.equal(parsed.meta.platform, KNOWN_PLATFORMS.GOOGLE_CHAT)
        assert.equal(parsed.meta.type, ChatType.PRIVATE)
        assert.equal(parsed.messages[0].timestamp, Date.UTC(2026, 4, 29, 3, 0, 29) / 1000)
        assert.equal(parsed.messages[0].type, MessageType.FILE)
        assert.equal(parsed.messages[0].content, '[附件] voice.m4a')
        await manager.close()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
