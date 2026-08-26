import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { AIChatManager } from '../chats'
import { AIMemoryService } from '../memory'
import { linkAIMemorySources, listAIMemoriesWithSourceStatus, resolveAIMemorySourceStatus } from '../memory-provenance'

const sqliteNativeBinding = process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-ai-memory-provenance-'))
  const memoryService = new AIMemoryService(dir, { nativeBinding: sqliteNativeBinding, now: () => 1234 })
  const aiChatManager = new AIChatManager(dir, { nativeBinding: sqliteNativeBinding })
  return {
    dir,
    memoryService,
    aiChatManager,
    close() {
      memoryService.close()
      aiChatManager.close()
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      } catch {
        // Windows can hold SQLite WAL handles briefly after close; temp cleanup is best-effort.
      }
    },
  }
}

describe('AI memory provenance', () => {
  it('links user and AI memories to the matching persisted messages without changing update time', () => {
    const fixture = createFixture()
    try {
      const chat = fixture.aiChatManager.createGlobalAIChat('source', 'general_cn')
      const userMessage = fixture.aiChatManager.addMessage(chat.id, 'user', '请记住我喜欢先看结论')
      const assistantMessage = fixture.aiChatManager.addMessage(chat.id, 'assistant', '已经记住')
      const userMemory = fixture.memoryService.create({
        scopeType: 'global',
        scopeId: null,
        content: '回答时先给结论',
        sourceType: 'user',
        sourceAIChatId: chat.id,
      })
      const aiMemory = fixture.memoryService.create({
        scopeType: 'self',
        scopeId: null,
        content: '用户可能在准备搬家',
        sourceType: 'ai',
        sourceAIChatId: chat.id,
      })

      const result = linkAIMemorySources(fixture.memoryService, fixture.aiChatManager, {
        provenanceToken: 'test-turn',
        aiChatId: chat.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        memoryIds: [userMemory.id, aiMemory.id, userMemory.id],
      })

      assert.deepEqual(result, { linkedMemoryIds: [userMemory.id, aiMemory.id], skippedMemoryIds: [] })
      assert.equal(fixture.memoryService.get(userMemory.id)?.sourceMessageId, userMessage.id)
      assert.equal(fixture.memoryService.get(aiMemory.id)?.sourceMessageId, assistantMessage.id)
      assert.equal(fixture.memoryService.get(userMemory.id)?.updatedAt, 1234)
      assert.equal(fixture.memoryService.get(aiMemory.id)?.updatedAt, 1234)

      assert.deepEqual(
        linkAIMemorySources(fixture.memoryService, fixture.aiChatManager, {
          provenanceToken: 'test-turn',
          aiChatId: chat.id,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          memoryIds: [userMemory.id, aiMemory.id],
        }),
        { linkedMemoryIds: [userMemory.id, aiMemory.id], skippedMemoryIds: [] }
      )
    } finally {
      fixture.close()
    }
  })

  it('rejects cross-conversation memories and invalid source message roles before writing anything', () => {
    const fixture = createFixture()
    try {
      const chatA = fixture.aiChatManager.createGlobalAIChat('a', 'general_cn')
      const chatB = fixture.aiChatManager.createGlobalAIChat('b', 'general_cn')
      const userA = fixture.aiChatManager.addMessage(chatA.id, 'user', 'a user')
      const assistantA = fixture.aiChatManager.addMessage(chatA.id, 'assistant', 'a assistant')
      const memoryA = fixture.memoryService.create({
        scopeType: 'global',
        scopeId: null,
        content: 'memory a',
        sourceType: 'user',
        sourceAIChatId: chatA.id,
      })
      const memoryB = fixture.memoryService.create({
        scopeType: 'global',
        scopeId: null,
        content: 'memory b',
        sourceType: 'user',
        sourceAIChatId: chatB.id,
      })

      assert.throws(
        () =>
          linkAIMemorySources(fixture.memoryService, fixture.aiChatManager, {
            provenanceToken: 'test-turn',
            aiChatId: chatA.id,
            userMessageId: userA.id,
            assistantMessageId: assistantA.id,
            memoryIds: [memoryA.id, memoryB.id],
          }),
        /does not belong/i
      )
      assert.equal(fixture.memoryService.get(memoryA.id)?.sourceMessageId, null)
      assert.equal(fixture.memoryService.get(memoryB.id)?.sourceMessageId, null)

      assert.throws(
        () =>
          linkAIMemorySources(fixture.memoryService, fixture.aiChatManager, {
            provenanceToken: 'test-turn',
            aiChatId: chatA.id,
            userMessageId: assistantA.id,
            assistantMessageId: userA.id,
            memoryIds: [memoryA.id],
          }),
        /source message/i
      )
      assert.equal(fixture.memoryService.get(memoryA.id)?.sourceMessageId, null)
    } finally {
      fixture.close()
    }
  })

  it('treats a memory deleted before backfill as an idempotent no-op', () => {
    const fixture = createFixture()
    try {
      const chat = fixture.aiChatManager.createGlobalAIChat('source', 'general_cn')
      const userMessage = fixture.aiChatManager.addMessage(chat.id, 'user', 'remember')
      const assistantMessage = fixture.aiChatManager.addMessage(chat.id, 'assistant', 'done')

      assert.deepEqual(
        linkAIMemorySources(fixture.memoryService, fixture.aiChatManager, {
          provenanceToken: 'test-turn',
          aiChatId: chat.id,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          memoryIds: ['already-deleted'],
        }),
        { linkedMemoryIds: [], skippedMemoryIds: ['already-deleted'] }
      )
    } finally {
      fixture.close()
    }
  })

  it('rejects non-parent messages and batch conflicts without partially linking memories', () => {
    const fixture = createFixture()
    try {
      const chat = fixture.aiChatManager.createGlobalAIChat('source', 'general_cn')
      const firstUser = fixture.aiChatManager.addMessage(chat.id, 'user', 'first')
      const firstAssistant = fixture.aiChatManager.addMessage(chat.id, 'assistant', 'first answer')
      const conflictingMemory = fixture.memoryService.create({
        scopeType: 'global',
        scopeId: null,
        content: 'already linked',
        sourceType: 'user',
        sourceAIChatId: chat.id,
        sourceMessageId: firstUser.id,
      })
      const secondUser = fixture.aiChatManager.addMessage(chat.id, 'user', 'second')
      const secondAssistant = fixture.aiChatManager.addMessage(chat.id, 'assistant', 'second answer')
      const unlinkedMemory = fixture.memoryService.create({
        scopeType: 'global',
        scopeId: null,
        content: 'must remain unlinked',
        sourceType: 'user',
        sourceAIChatId: chat.id,
      })

      assert.throws(
        () =>
          linkAIMemorySources(fixture.memoryService, fixture.aiChatManager, {
            provenanceToken: 'test-turn',
            aiChatId: chat.id,
            userMessageId: firstUser.id,
            assistantMessageId: secondAssistant.id,
            memoryIds: [unlinkedMemory.id],
          }),
        /directly reply/i
      )

      assert.throws(
        () =>
          linkAIMemorySources(fixture.memoryService, fixture.aiChatManager, {
            provenanceToken: 'test-turn',
            aiChatId: chat.id,
            userMessageId: secondUser.id,
            assistantMessageId: secondAssistant.id,
            memoryIds: [unlinkedMemory.id, conflictingMemory.id],
          }),
        /already linked/i
      )
      assert.equal(fixture.memoryService.get(unlinkedMemory.id)?.sourceMessageId, null)
      assert.equal(fixture.memoryService.get(conflictingMemory.id)?.sourceMessageId, firstUser.id)
      assert.equal(firstAssistant.parentId, firstUser.id)
    } finally {
      fixture.close()
    }
  })

  it('reports conversation, message, and unavailable source states without deleting the memory', () => {
    const fixture = createFixture()
    try {
      const chat = fixture.aiChatManager.createGlobalAIChat('source', 'general_cn')
      const message = fixture.aiChatManager.addMessage(chat.id, 'user', 'remember')
      const none = fixture.memoryService.create({
        scopeType: 'global',
        scopeId: null,
        content: 'manual',
        sourceType: 'user',
      })
      const conversation = fixture.memoryService.create({
        scopeType: 'global',
        scopeId: null,
        content: 'conversation only',
        sourceType: 'user',
        sourceAIChatId: chat.id,
      })
      const linked = fixture.memoryService.create({
        scopeType: 'global',
        scopeId: null,
        content: 'linked',
        sourceType: 'user',
        sourceAIChatId: chat.id,
        sourceMessageId: message.id,
      })

      assert.equal(resolveAIMemorySourceStatus(none, fixture.aiChatManager), 'none')
      assert.equal(resolveAIMemorySourceStatus(conversation, fixture.aiChatManager), 'conversation')
      assert.equal(resolveAIMemorySourceStatus(linked, fixture.aiChatManager), 'message')

      fixture.aiChatManager.deleteMessage(message.id)
      assert.equal(resolveAIMemorySourceStatus(linked, fixture.aiChatManager), 'unavailable')
      fixture.aiChatManager.deleteAIChat(chat.id)
      assert.equal(resolveAIMemorySourceStatus(conversation, fixture.aiChatManager), 'unavailable')
      assert.equal(fixture.memoryService.list().length, 3)
      assert.deepEqual(
        Object.fromEntries(
          listAIMemoriesWithSourceStatus(fixture.memoryService, fixture.aiChatManager).map((entry) => [
            entry.content,
            entry.sourceStatus,
          ])
        ),
        { manual: 'none', 'conversation only': 'unavailable', linked: 'unavailable' }
      )
    } finally {
      fixture.close()
    }
  })
})
