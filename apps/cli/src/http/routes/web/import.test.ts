import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'

import { registerImportRoutes } from './import'

function multipartPayload(): { payload: Buffer; contentType: string } {
  const boundary = '----chatlab-auto-import-route-test'
  const field = (name: string, value: string) =>
    [`--${boundary}`, `Content-Disposition: form-data; name="${name}"`, '', value].join('\r\n')
  const file = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="chat.json"',
    'Content-Type: application/json',
    '',
    '{"messages":[]}',
  ].join('\r\n')

  return {
    payload: Buffer.from(
      [field('formatId', 'telegram-json'), field('chatIndex', '2'), file, `--${boundary}--`, ''].join('\r\n')
    ),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function directoryMultipartPayload(): { payload: Buffer; contentType: string } {
  const boundary = '----chatlab-directory-import-route-test'
  const document = JSON.stringify({
    chatlab: { version: '0.0.2', exportedAt: 1711468800 },
    meta: { name: 'Test Chat', platform: 'line', type: 'group' },
    members: [{ platformId: 'u1', accountName: 'Alice' }],
    messages: [{ sender: 'u1', accountName: 'Alice', timestamp: 1711468800, type: 0, content: 'hello' }],
  })
  const relativePath = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="relativePaths"',
    '',
    'export/chat.json',
  ].join('\r\n')
  const file = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="files"; filename="chat.json"',
    'Content-Type: application/json',
    '',
    document,
  ].join('\r\n')

  return {
    payload: Buffer.from([relativePath, file, `--${boundary}--`, ''].join('\r\n')),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

describe('CLI Web automatic import route', () => {
  it('forwards parser options and preserves a zero-new incremental result in the done event', async () => {
    const app = Fastify()
    const calls: Array<{ formatId?: string; chatIndex?: number }> = []
    try {
      await app.register(multipart)
      registerImportRoutes(
        app,
        {} as any,
        {
          runAutoImport: async (_filePath: string, options: Record<string, unknown>) => {
            calls.push({
              formatId: options.formatId as string | undefined,
              chatIndex: options.chatIndex as number | undefined,
            })
            return {
              success: true,
              sessionId: 'existing-session',
              importMode: 'incremental',
              matchedBy: 'trailing-messages',
              newMessageCount: 0,
              duplicateCount: 5,
            }
          },
        } as any
      )

      const body = multipartPayload()
      const response = await app.inject({
        method: 'POST',
        url: '/_web/import',
        headers: { 'content-type': body.contentType },
        payload: body.payload,
      })

      assert.equal(response.statusCode, 200)
      assert.deepEqual(calls, [{ formatId: 'telegram-json', chatIndex: 2 }])
      assert.match(response.body, /event: done/)
      assert.doesNotMatch(response.body, /event: error/)
      assert.match(response.body, /"importMode":"incremental"/)
      assert.match(response.body, /"newMessageCount":0/)
      assert.match(response.body, /"duplicateCount":5/)
    } finally {
      await app.close()
    }
  })

  it('returns a stable import-in-progress error event instead of an internal database error', async () => {
    const app = Fastify()
    try {
      await app.register(multipart)
      registerImportRoutes(
        app,
        {} as any,
        {
          runAutoImport: async () => ({ success: false, error: 'error.import_in_progress' }),
        } as any
      )

      const body = multipartPayload()
      const response = await app.inject({
        method: 'POST',
        url: '/_web/import',
        headers: { 'content-type': body.contentType },
        payload: body.payload,
      })

      assert.equal(response.statusCode, 200)
      assert.match(response.body, /event: error/)
      assert.match(response.body, /"error":"error\.import_in_progress"/)
      assert.doesNotMatch(response.body, /no such column|SQLITE/i)
    } finally {
      await app.close()
    }
  })

  it('preserves the parsed platform in a failed created-import event', async () => {
    const app = Fastify()
    try {
      await app.register(multipart)
      registerImportRoutes(
        app,
        {} as any,
        {
          runAutoImport: async () => ({
            success: false,
            platform: 'line',
            error: 'database unavailable',
          }),
        } as any
      )

      const body = multipartPayload()
      const response = await app.inject({
        method: 'POST',
        url: '/_web/import',
        headers: { 'content-type': body.contentType },
        payload: body.payload,
      })

      assert.equal(response.statusCode, 200)
      assert.match(response.body, /event: error/)
      assert.match(response.body, /"platform":"line"/)
      assert.match(response.body, /"error":"database unavailable"/)
    } finally {
      await app.close()
    }
  })

  it('preserves the parsed platform in a failed directory-import event', async () => {
    const app = Fastify()
    try {
      await app.register(multipart)
      registerImportRoutes(
        app,
        {} as any,
        {
          runAutoImport: async () => ({
            success: false,
            platform: 'line',
            error: 'database unavailable',
          }),
        } as any
      )

      const body = directoryMultipartPayload()
      const response = await app.inject({
        method: 'POST',
        url: '/_web/import-directory',
        headers: { 'content-type': body.contentType },
        payload: body.payload,
      })

      assert.equal(response.statusCode, 200)
      assert.match(response.body, /event: error/)
      assert.match(response.body, /"platform":"line"/)
      assert.match(response.body, /"error":"database unavailable"/)
    } finally {
      await app.close()
    }
  })

  it('preserves an ambiguous create reason in the done event', async () => {
    const app = Fastify()
    try {
      await app.register(multipart)
      registerImportRoutes(
        app,
        {} as any,
        {
          runAutoImport: async () => ({
            success: true,
            sessionId: 'new-session',
            importMode: 'created',
            createReason: 'ambiguous',
            newMessageCount: 3,
            duplicateCount: 0,
          }),
        } as any
      )

      const body = multipartPayload()
      const response = await app.inject({
        method: 'POST',
        url: '/_web/import',
        headers: { 'content-type': body.contentType },
        payload: body.payload,
      })

      assert.equal(response.statusCode, 200)
      assert.match(response.body, /event: done/)
      assert.match(response.body, /"importMode":"created"/)
      assert.match(response.body, /"createReason":"ambiguous"/)
    } finally {
      await app.close()
    }
  })
})
