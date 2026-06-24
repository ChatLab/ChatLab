import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { ArchiveImportSourceManager } from '@openchatlab/node-runtime'

import { writeZipFixture } from '../../../../../../packages/node-runtime/src/import/archive/test-utils'
import { registerImportRoutes } from './import'

function createTakeoutZip(zipPath: string): void {
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

function multipartPayload(fileName: string, file: Buffer): { payload: Buffer; contentType: string } {
  const boundary = '----chatlab-import-source-test'
  const header = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
      'Content-Type: application/zip',
      '',
      '',
    ].join('\r\n')
  )
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    payload: Buffer.concat([header, file, footer]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

describe('CLI Web archive import source routes', () => {
  it('uploads once, reuses the source for imports, and releases idempotently', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlab-import-source-route-'))
    const app = Fastify()
    try {
      const zipPath = join(dir, 'takeout.zip')
      createTakeoutZip(zipPath)
      await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })

      const manager = new ArchiveImportSourceManager({ tempRoot: join(dir, 'sources') })
      const importedManifests: string[] = []
      registerImportRoutes(app, {} as any, {
        sourceManager: manager,
        runPreparedImport: async (manifestPath) => {
          importedManifests.push(readFileSync(manifestPath, 'utf8'))
          return { success: true, sessionId: `session-${importedManifests.length}` }
        },
      })

      const body = multipartPayload('takeout.zip', readFileSync(zipPath))
      const prepare = await app.inject({
        method: 'POST',
        url: '/_web/import-sources',
        headers: { 'content-type': body.contentType },
        payload: body.payload,
      })
      assert.equal(prepare.statusCode, 200)
      const prepared = prepare.json()
      assert.equal(prepared.success, true)
      assert.equal(prepared.source.platform, 'google-chat')
      assert.equal(prepared.source.chats[0].chatId, 'Groups/DM sample')

      for (let index = 0; index < 2; index++) {
        const response = await app.inject({
          method: 'POST',
          url: `/_web/import-sources/${prepared.source.sourceId}/import`,
          payload: { chatId: 'Groups/DM sample' },
        })
        assert.equal(response.statusCode, 200)
        assert.match(response.body, /event: done/)
        assert.match(response.body, new RegExp(`session-${index + 1}`))
      }
      assert.equal(importedManifests.length, 2)

      for (let index = 0; index < 2; index++) {
        const response = await app.inject({
          method: 'DELETE',
          url: `/_web/import-sources/${prepared.source.sourceId}`,
        })
        assert.equal(response.statusCode, 200)
      }
    } finally {
      await app.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns stable errors for unsupported archives and missing sources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlab-import-source-errors-'))
    const app = Fastify()
    try {
      await app.register(multipart)
      const manager = new ArchiveImportSourceManager({ tempRoot: join(dir, 'sources') })
      registerImportRoutes(app, {} as any, {
        sourceManager: manager,
        runPreparedImport: async () => ({ success: true, sessionId: 'unused' }),
      })

      const body = multipartPayload('invalid.zip', Buffer.from('not a zip'))
      const prepare = await app.inject({
        method: 'POST',
        url: '/_web/import-sources',
        headers: { 'content-type': body.contentType },
        payload: body.payload,
      })
      assert.equal(prepare.statusCode, 400)
      assert.equal(prepare.json().error, 'error.archive_corrupt')

      const missing = await app.inject({
        method: 'POST',
        url: '/_web/import-sources/missing/import',
        payload: { chatId: 'Groups/DM sample' },
      })
      assert.equal(missing.statusCode, 200)
      assert.match(missing.body, /error\.import_source_not_found/)
    } finally {
      await app.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
