import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import { writeZipFixture } from '../../../packages/node-runtime/src/import/archive/test-utils'
import { ArchiveImportSourceManager } from '../../../packages/node-runtime/src/import/archive/source-manager'
import { importPreparedChatWithSource } from './import-source-runtime'

function createTakeout(zipPath: string): void {
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
      content: JSON.stringify({ messages: [] }),
    },
  ])
}

describe('desktop archive import runtime', () => {
  it('passes an internal manifest to the importer and preserves the local ZIP', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlab-desktop-import-source-'))
    try {
      const zipPath = join(dir, 'takeout.zip')
      createTakeout(zipPath)
      const manager = new ArchiveImportSourceManager({ tempRoot: join(dir, 'temp') })
      const source = await manager.prepareLocalArchive(zipPath)

      const result = await importPreparedChatWithSource(
        manager,
        source.sourceId,
        'Groups/DM sample',
        async (manifestPath) => {
          assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8')).chatId, 'Groups/DM sample')
          return { success: true, sessionId: 'session-1' }
        }
      )

      assert.deepEqual(result, { success: true, sessionId: 'session-1' })
      assert.equal(existsSync(zipPath), true)
      await manager.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
