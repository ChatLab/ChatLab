import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import Fastify from 'fastify'
import { AIChatManager, AIMemoryService } from '@openchatlab/node-runtime'
import { registerAiAgentStreamRoutes } from './ai-agent-stream'
import { registerAiMemoryRoutes } from './ai-memories'
import { MemoryProvenanceCoordinator } from './memory-provenance-coordinator'

const sqliteNativeBinding = process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-ai-memory-routes-'))
  const service = new AIMemoryService(dir, { nativeBinding: sqliteNativeBinding })
  const aiChatManager = new AIChatManager(dir, { nativeBinding: sqliteNativeBinding })
  const memoryProvenanceCoordinator = new MemoryProvenanceCoordinator()
  const app = Fastify()
  registerAiMemoryRoutes(app, { aiMemoryService: service, aiChatManager }, memoryProvenanceCoordinator)

  return {
    app,
    service,
    aiChatManager,
    memoryProvenanceCoordinator,
    async close() {
      await app.close()
      service.close()
      aiChatManager.close()
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

  it('links only memories and persisted message roles owned by the requested global conversation', async () => {
    const fixture = createFixture()
    try {
      const chat = fixture.aiChatManager.createGlobalAIChat('source', 'general_cn')
      const otherChat = fixture.aiChatManager.createGlobalAIChat('other', 'general_cn')
      const userMessage = fixture.aiChatManager.addMessage(chat.id, 'user', '请记住')
      const assistantMessage = fixture.aiChatManager.addMessage(chat.id, 'assistant', '已经记住')
      const memory = fixture.service.create({
        scopeType: 'global',
        scopeId: null,
        content: '先给结论',
        sourceType: 'user',
        sourceAIChatId: chat.id,
      })
      const provenanceToken = 'test-turn'
      fixture.memoryProvenanceCoordinator.begin(provenanceToken, chat.id)
      fixture.memoryProvenanceCoordinator.record(provenanceToken, memory.id)
      fixture.memoryProvenanceCoordinator.complete(provenanceToken, userMessage.parentId ?? null)

      const linked = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories/link-sources',
        payload: {
          provenanceToken,
          aiChatId: chat.id,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          memoryIds: [memory.id],
        },
      })
      assert.equal(linked.statusCode, 200)
      assert.deepEqual(linked.json(), { linkedMemoryIds: [memory.id], skippedMemoryIds: [] })

      const listed = await fixture.app.inject({ method: 'GET', url: '/_web/ai/memories' })
      assert.equal(listed.json()[0].sourceStatus, 'message')
      assert.equal(listed.json()[0].sourceMessageId, userMessage.id)

      const forged = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories/link-sources',
        payload: {
          provenanceToken,
          aiChatId: otherChat.id,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          memoryIds: [memory.id],
        },
      })
      assert.equal(forged.statusCode, 400)
      assert.equal(fixture.service.get(memory.id)?.sourceMessageId, userMessage.id)
    } finally {
      await fixture.close()
    }
  })

  it('binds source backfill to one completed agent turn and its exact memory change set', async () => {
    const fixture = createFixture()
    try {
      const chat = fixture.aiChatManager.createGlobalAIChat('source', 'general_cn')
      const previousUser = fixture.aiChatManager.addMessage(chat.id, 'user', 'previous')
      const previousAssistant = fixture.aiChatManager.addMessage(chat.id, 'assistant', 'previous answer')
      const memory = fixture.service.create({
        scopeType: 'global',
        scopeId: null,
        content: 'changed this turn',
        sourceType: 'user',
        sourceAIChatId: chat.id,
      })
      const untrackedMemory = fixture.service.create({
        scopeType: 'global',
        scopeId: null,
        content: 'not changed this turn',
        sourceType: 'user',
        sourceAIChatId: chat.id,
      })
      const provenanceToken = 'bound-turn'
      fixture.memoryProvenanceCoordinator.begin(provenanceToken, chat.id)
      fixture.memoryProvenanceCoordinator.record(provenanceToken, memory.id)
      fixture.memoryProvenanceCoordinator.complete(provenanceToken, previousAssistant.id)

      const currentUser = fixture.aiChatManager.addMessage(chat.id, 'user', 'current')
      const currentAssistant = fixture.aiChatManager.addMessage(chat.id, 'assistant', 'current answer')
      const wrongChangeSet = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories/link-sources',
        payload: {
          provenanceToken,
          aiChatId: chat.id,
          userMessageId: currentUser.id,
          assistantMessageId: currentAssistant.id,
          memoryIds: [memory.id, untrackedMemory.id],
        },
      })
      assert.equal(wrongChangeSet.statusCode, 400)
      assert.equal(fixture.service.get(memory.id)?.sourceMessageId, null)

      const oldMessages = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories/link-sources',
        payload: {
          provenanceToken,
          aiChatId: chat.id,
          userMessageId: previousUser.id,
          assistantMessageId: previousAssistant.id,
          memoryIds: [memory.id],
        },
      })
      assert.equal(oldMessages.statusCode, 400)
      assert.equal(fixture.service.get(memory.id)?.sourceMessageId, null)

      const linked = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories/link-sources',
        payload: {
          provenanceToken,
          aiChatId: chat.id,
          userMessageId: currentUser.id,
          assistantMessageId: currentAssistant.id,
          memoryIds: [memory.id],
        },
      })
      assert.equal(linked.statusCode, 200)
      assert.equal(fixture.service.get(memory.id)?.sourceMessageId, currentUser.id)

      const replay = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories/link-sources',
        payload: {
          provenanceToken,
          aiChatId: chat.id,
          userMessageId: currentUser.id,
          assistantMessageId: currentAssistant.id,
          memoryIds: [memory.id],
        },
      })
      assert.equal(replay.statusCode, 400)
    } finally {
      await fixture.close()
    }
  })

  it('links a memory to the current turn after automatic compression changes the active parent', async () => {
    const fixture = createFixture()
    try {
      const chat = fixture.aiChatManager.createGlobalAIChat('source', 'general_cn')
      fixture.aiChatManager.addMessage(chat.id, 'user', 'previous')
      fixture.aiChatManager.addMessage(chat.id, 'assistant', 'previous answer')
      let memoryId = ''
      let summaryMessageId = ''

      registerAiAgentStreamRoutes(
        fixture.app,
        {
          aiChatManager: fixture.aiChatManager,
          runAgentStream: async (_request, onEvent) => {
            const summary = fixture.aiChatManager.addSummaryMessage(chat.id, 'compressed history', {
              bufferBoundaryTimestamp: Date.now(),
              compressedMessageCount: 2,
            })
            summaryMessageId = summary.id
            const memory = fixture.service.create({
              scopeType: 'global',
              scopeId: null,
              content: 'changed after compression',
              sourceType: 'ai',
              sourceAIChatId: chat.id,
            })
            memoryId = memory.id
            onEvent({ type: 'memory_change', memoryId })
            onEvent({ type: 'done', isFinished: true })
          },
        },
        fixture.memoryProvenanceCoordinator
      )

      const streamResponse = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/agent/stream',
        payload: { aiChatId: chat.id },
      })
      assert.equal(streamResponse.statusCode, 200)
      const provenanceToken = String(streamResponse.headers['x-request-id'])

      const { userMessage, assistantMessage } = fixture.aiChatManager.addMessagePair(
        chat.id,
        { content: 'current question' },
        { content: 'current answer' }
      )
      assert.equal(userMessage.parentId, summaryMessageId)

      const linked = await fixture.app.inject({
        method: 'POST',
        url: '/_web/ai/memories/link-sources',
        payload: {
          provenanceToken,
          aiChatId: chat.id,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          memoryIds: [memoryId],
        },
      })
      assert.equal(linked.statusCode, 200)
      assert.equal(fixture.service.get(memoryId)?.sourceMessageId, assistantMessage.id)
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
