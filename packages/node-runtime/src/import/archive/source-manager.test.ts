import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'

import { ArchiveImportError } from './errors'
import { ArchiveImportSourceManager } from './source-manager'
import { writeZipFixture } from './test-utils'
import { resolveChatLabTempRoot } from '../../temp-workspace'

function createMinimalTakeout(zipPath: string): void {
  writeZipFixture(zipPath, [
    {
      name: 'Takeout/Google Chat/Users/User sample/user_info.json',
      content: JSON.stringify({
        user: { email: 'owner@example.com', name: 'Owner', user_type: 'Human' },
      }),
    },
    {
      name: 'Takeout/Google Chat/Groups/DM sample/group_info.json',
      content: JSON.stringify({
        members: [
          { email: 'owner@example.com', name: 'Owner', user_type: 'Human' },
          { email: 'other@example.com', name: 'Other User', user_type: 'Human' },
        ],
      }),
    },
    {
      name: 'Takeout/Google Chat/Groups/DM sample/messages.json',
      content: JSON.stringify({ messages: [] }),
    },
  ])
}

describe('ArchiveImportSourceManager', () => {
  it('uses the centralized imports scope by default and removes its owned root on close', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlab-source-default-root-'))
    try {
      const zipPath = join(dir, 'takeout.zip')
      createMinimalTakeout(zipPath)
      const manager = new ArchiveImportSourceManager()
      const source = await manager.prepareLocalArchive(zipPath)
      let managerRoot = ''

      await manager.withMaterializedChat(source.sourceId, 'Groups/DM sample', async (manifestPath) => {
        managerRoot = dirname(dirname(manifestPath))
        assert.equal(dirname(managerRoot), join(resolveChatLabTempRoot(), 'imports'))
      })

      assert.equal(existsSync(managerRoot), true)
      await manager.close()
      assert.equal(existsSync(managerRoot), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps local archives and deletes owned archives on release', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlab-source-ownership-'))
    try {
      const localZip = join(dir, 'local.zip')
      const ownedZip = join(dir, 'owned.zip')
      createMinimalTakeout(localZip)
      createMinimalTakeout(ownedZip)
      const manager = new ArchiveImportSourceManager({ tempRoot: join(dir, 'temp') })

      const local = await manager.prepareLocalArchive(localZip)
      const owned = await manager.prepareOwnedArchive(ownedZip)
      assert.equal(local.platform, 'google-chat')
      assert.equal(local.chats[0].chatId, 'Groups/DM sample')

      await manager.release(local.sourceId)
      await manager.release(owned.sourceId)
      await manager.release(owned.sourceId)

      assert.equal(existsSync(localZip), true)
      assert.equal(existsSync(ownedZip), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cleans materialized directories after success and errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlab-source-materialize-'))
    try {
      const zipPath = join(dir, 'takeout.zip')
      createMinimalTakeout(zipPath)
      const manager = new ArchiveImportSourceManager({ tempRoot: join(dir, 'temp') })
      const source = await manager.prepareLocalArchive(zipPath)
      let successDir = ''

      const result = await manager.withMaterializedChat(source.sourceId, 'Groups/DM sample', async (manifestPath) => {
        successDir = dirname(manifestPath)
        assert.equal(existsSync(manifestPath), true)
        return 'ok'
      })
      assert.equal(result, 'ok')
      assert.equal(existsSync(successDir), false)

      let errorDir = ''
      await assert.rejects(
        () =>
          manager.withMaterializedChat(source.sourceId, 'Groups/DM sample', async (manifestPath) => {
            errorDir = dirname(manifestPath)
            throw new Error('handler failed')
          }),
        /handler failed/
      )
      assert.equal(existsSync(errorDir), false)
      await manager.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('expires inactive sources and distinguishes expired from unknown IDs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlab-source-expiry-'))
    let now = 1_000
    try {
      const ownedZip = join(dir, 'owned.zip')
      createMinimalTakeout(ownedZip)
      const manager = new ArchiveImportSourceManager({
        tempRoot: join(dir, 'temp'),
        ttlMs: 500,
        now: () => now,
      })
      const source = await manager.prepareOwnedArchive(ownedZip)
      now = 2_000

      assert.equal(await manager.cleanupExpired(), 1)
      assert.equal(existsSync(ownedZip), false)
      await assert.rejects(
        () => manager.withMaterializedChat(source.sourceId, 'Groups/DM sample', async () => undefined),
        (error) => error instanceof ArchiveImportError && error.code === 'error.import_source_expired'
      )
      await assert.rejects(
        () => manager.withMaterializedChat('missing', 'Groups/DM sample', async () => undefined),
        (error) => error instanceof ArchiveImportError && error.code === 'error.import_source_not_found'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
