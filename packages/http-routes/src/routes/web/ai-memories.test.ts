import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import Fastify from 'fastify'
import { AIMemoryService } from '@openchatlab/node-runtime'
import { registerAiMemoryRoutes } from './ai-memories'

const sqliteNativeBinding = process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-ai-memory-routes-'))
  const service = new AIMemoryService(dir, { nativeBinding: sqliteNativeBinding })
  const app = Fastify()
  registerAiMemoryRoutes(app, { aiMemoryService: service })

  return {
    app,
    service,
    async close() {
      await app.close()
      service.close()
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      } catch {
        // Windows can hold SQLite WAL handles briefly after close; temp cleanup is best-effort.
      }
    },
  }
}

describe('AI memory routes', () => {
  it('creates user memories and lists exact scopes', async () => {
    const fixture = createFixture()
    try {
      const globalResponse = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories',
        payload: {
          scopeType: 'global',
          scopeId: null,
          content: '  最近默认按 90 天  ',
          sourceType: 'ai',
        },
      })
      assert.equal(globalResponse.statusCode, 200)
      assert.equal(globalResponse.json().content, '最近默认按 90 天')
      assert.equal(globalResponse.json().sourceType, 'user')

      const selfResponse = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories',
        payload: {
          scopeType: 'self',
          scopeId: null,
          content: '用户目前在上海工作',
        },
      })
      assert.equal(selfResponse.statusCode, 200)
      assert.equal(selfResponse.json().scopeType, 'self')

      await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories',
        payload: { scopeType: 'contact', scopeId: 'contact-a', content: '大学同学' },
      })
      await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories',
        payload: { scopeType: 'contact', scopeId: 'contact-b', content: '前同事' },
      })

      const all = await fixture.app.inject({ method: 'GET', url: '/_web/ai/memories' })
      assert.equal(all.statusCode, 200)
      assert.equal(all.json().length, 4)

      const self = await fixture.app.inject({
        method: 'GET',
        url: '/_web/ai/memories?scopeType=self',
      })
      assert.deepEqual(
        self.json().map((entry: { content: string }) => entry.content),
        ['用户目前在上海工作']
      )

      const filtered = await fixture.app.inject({
        method: 'GET',
        url: '/_web/ai/memories?scopeType=contact&scopeId=contact-a',
      })
      assert.equal(filtered.statusCode, 200)
      assert.deepEqual(
        filtered.json().map((entry: { content: string }) => entry.content),
        ['大学同学']
      )
    } finally {
      await fixture.close()
    }
  })

  it('updates, deletes, and clears memories without letting clients spoof the source', async () => {
    const fixture = createFixture()
    try {
      const created = fixture.service.create({
        scopeType: 'group',
        scopeId: 'group-a',
        content: '旧结论',
        sourceType: 'ai',
        sourceAIChatId: 'chat-a',
      })
      fixture.service.create({
        scopeType: 'group',
        scopeId: 'group-b',
        content: '另一个群',
        sourceType: 'user',
      })

      const updated = await fixture.app.inject({
        method: 'PUT',
        url: `/_web/ai/memories/${created.id}`,
        payload: { content: '用户确认后的结论', sourceType: 'ai' },
      })
      assert.equal(updated.statusCode, 200)
      assert.deepEqual(
        {
          scopeType: updated.json().scopeType,
          scopeId: updated.json().scopeId,
          content: updated.json().content,
          sourceType: updated.json().sourceType,
          sourceAIChatId: updated.json().sourceAIChatId,
        },
        {
          scopeType: 'group',
          scopeId: 'group-a',
          content: '用户确认后的结论',
          sourceType: 'user',
          sourceAIChatId: null,
        }
      )

      const cleared = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories/clear',
        payload: { scopeType: 'group', scopeId: 'group-a' },
      })
      assert.equal(cleared.statusCode, 200)
      assert.deepEqual(cleared.json(), { success: true, cleared: 1 })
      assert.deepEqual(
        fixture.service.list().map((entry) => entry.scopeId),
        ['group-b']
      )

      const remainingId = fixture.service.list()[0]?.id
      assert.ok(remainingId)
      const deleted = await fixture.app.inject({ method: 'DELETE', url: `/_web/ai/memories/${remainingId}` })
      assert.equal(deleted.statusCode, 200)
      assert.deepEqual(deleted.json(), { success: true })

      const missing = await fixture.app.inject({ method: 'DELETE', url: '/_web/ai/memories/missing' })
      assert.equal(missing.statusCode, 404)
    } finally {
      await fixture.close()
    }
  })

  it('requires explicit scope or all confirmation before clearing', async () => {
    const fixture = createFixture()
    try {
      fixture.service.create({ scopeType: 'global', scopeId: null, content: '先给结论', sourceType: 'user' })
      fixture.service.create({
        scopeType: 'contact',
        scopeId: 'contact-a',
        content: '大学同学',
        sourceType: 'user',
      })

      const implicit = await fixture.app.inject({ method: 'POST', url: '/_web/ai/memories/clear', payload: {} })
      assert.equal(implicit.statusCode, 400)
      assert.equal(fixture.service.list().length, 2)

      const ambiguous = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories/clear',
        payload: { all: true, scopeType: 'global' },
      })
      assert.equal(ambiguous.statusCode, 400)
      assert.equal(fixture.service.list().length, 2)

      const explicit = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories/clear',
        payload: { all: true },
      })
      assert.equal(explicit.statusCode, 200)
      assert.deepEqual(explicit.json(), { success: true, cleared: 2 })
      assert.deepEqual(fixture.service.list(), [])
    } finally {
      await fixture.close()
    }
  })

  it('rejects invalid scope and content instead of changing stored memories', async () => {
    const fixture = createFixture()
    try {
      const invalidScope = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories',
        payload: { scopeType: 'contact', content: 'missing id' },
      })
      assert.equal(invalidScope.statusCode, 400)

      const invalidQuery = await fixture.app.inject({
        method: 'GET',
        url: '/_web/ai/memories?scopeId=contact-a',
      })
      assert.equal(invalidQuery.statusCode, 400)

      const invalidContent = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories',
        payload: { scopeType: 'global', content: '   ' },
      })
      assert.equal(invalidContent.statusCode, 400)
      assert.deepEqual(fixture.service.list(), [])
    } finally {
      await fixture.close()
    }
  })
})
