import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIChatManager } from '../../chats'
import type { AIEntityRef, ContentBlock } from '../../chats'
import { checkAndCompress } from '../compressor'
import type { CompressionConfig, CompressionLlmAdapter } from '../types'

const sqliteNativeBinding = process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'chatlab-compression-'))
}

function createManager(dir: string): AIChatManager {
  return sqliteNativeBinding ? new AIChatManager(dir, { nativeBinding: sqliteNativeBinding }) : new AIChatManager(dir)
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch {
    // Windows can hold SQLite WAL handles briefly after close; temp cleanup is best-effort.
  }
}

function spreadMessageTimestamps(manager: AIChatManager, chatId: string): void {
  const messages = manager.getMessages(chatId)
  const baseTimestamp = Math.floor(Date.now() / 1000) - messages.length
  messages.forEach((message, index) => {
    manager.executeAiSQL(`UPDATE ai_message SET timestamp = ${baseTimestamp + index} WHERE id = '${message.id}'`)
  })
}

function addMessageAt(
  manager: AIChatManager,
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
  timestamp: number
): void {
  const message = manager.addMessage(chatId, role, content)
  manager.executeAiSQL(`UPDATE ai_message SET timestamp = ${timestamp} WHERE id = '${message.id}'`)
}

const CONFIG: CompressionConfig = {
  tokenThresholdPercent: 75,
  bufferSizePercent: 20,
}

function createAdapter(captured: { prompt: string | null }): CompressionLlmAdapter {
  return {
    contextWindow: 1000,
    compress: async (prompt: string) => {
      captured.prompt = prompt
      return 'COMPRESSED SUMMARY'
    },
  }
}

/** A tool result large enough that replaying it dominates the context window. */
function bigToolResult(marker: string): string {
  return `${marker} ` + Array.from({ length: 700 }, (_, i) => `record${i} value${i * 3}`).join(' ')
}

function toolBlock(name: string, result: string | undefined): ContentBlock {
  return {
    type: 'tool',
    tool: {
      name,
      displayName: name,
      status: 'done',
      params: { query: 'stats' },
      ...(result !== undefined ? { toolCallId: `call_${name}`, result } : {}),
    },
  }
}

/**
 * Seeds a conversation whose plain message text is tiny, but whose persisted
 * tool results (replayed into the LLM context each turn) are large.
 */
function seedToolHeavyChat(manager: AIChatManager, withToolResults: boolean): string {
  const chat = manager.createAIChat('session-1', 'Compression', 'general_cn')
  const result1 = withToolResults ? bigToolResult('TOOL_DATA_ALPHA') : undefined
  const result2 = withToolResults ? bigToolResult('TOOL_DATA_BETA') : undefined

  manager.addMessage(chat.id, 'user', 'show me stats')
  manager.addMessage(chat.id, 'assistant', 'here are the stats', undefined, undefined, [toolBlock('query_a', result1)])
  manager.addMessage(chat.id, 'user', 'and more details')
  manager.addMessage(chat.id, 'assistant', 'more stats', undefined, undefined, [toolBlock('query_b', result2)])
  manager.addMessage(chat.id, 'user', 'thanks')
  manager.addMessage(chat.id, 'assistant', 'you are welcome')
  spreadMessageTimestamps(manager, chat.id)
  return chat.id
}

describe('checkAndCompress tool result token accounting', () => {
  it('keeps equal-timestamp messages on the buffer side of the compression boundary', async () => {
    const dir = createTempDir()
    const manager = createManager(dir)
    try {
      const baseTimestamp = 2_000_000_000
      const chat = manager.createAIChat('session-1', 'Compression boundary', 'general_cn')
      for (let index = 0; index < 4; index++) {
        addMessageAt(
          manager,
          chat.id,
          index % 2 === 0 ? 'user' : 'assistant',
          `old-${index} ${'old '.repeat(150)}`,
          baseTimestamp + index
        )
      }
      addMessageAt(manager, chat.id, 'user', `BOUNDARY_USER ${'user '.repeat(180)}`, baseTimestamp + 10)
      addMessageAt(manager, chat.id, 'assistant', `BOUNDARY_ASSISTANT ${'assistant '.repeat(60)}`, baseTimestamp + 10)

      const adapter: CompressionLlmAdapter = {
        contextWindow: 1000,
        compress: async (prompt: string) =>
          prompt.includes('BOUNDARY_USER') ? 'SUMMARY_CONTAINS_BOUNDARY_USER' : 'SUMMARY_SAFE',
      }

      const result = await checkAndCompress(chat.id, CONFIG, 'system', adapter, manager)

      assert.equal(result.compressed, true)
      assert.deepEqual(
        manager.getHistoryForAgent(chat.id).map((message) => message.content.split(' ')[0]),
        ['SUMMARY_SAFE', 'BOUNDARY_USER', 'BOUNDARY_ASSISTANT']
      )

      const largeChat = manager.createAIChat('session-1', 'Large compression boundary', 'general_cn')
      for (let index = 0; index < 4; index++) {
        addMessageAt(
          manager,
          largeChat.id,
          index % 2 === 0 ? 'user' : 'assistant',
          `old-${index} ${'old '.repeat(180)}`,
          baseTimestamp + index
        )
      }
      addMessageAt(manager, largeChat.id, 'assistant', `LATEST_ASSISTANT ${'latest '.repeat(260)}`, baseTimestamp + 10)
      const largeResult = await checkAndCompress(
        largeChat.id,
        CONFIG,
        'system',
        createAdapter({ prompt: null }),
        manager
      )
      addMessageAt(manager, largeChat.id, 'user', 'NEXT_USER', baseTimestamp + 10)

      assert.equal(largeResult.compressed, true)
      assert.deepEqual(
        manager.getHistoryForAgent(largeChat.id).map((message) => message.content.split(' ')[0]),
        ['COMPRESSED', 'LATEST_ASSISTANT', 'NEXT_USER']
      )
    } finally {
      manager.close()
      cleanup(dir)
    }
  })

  it('counts replayed tool results toward the compression threshold', async () => {
    const dir = createTempDir()
    const manager = createManager(dir)
    try {
      const chatId = seedToolHeavyChat(manager, true)
      const captured: { prompt: string | null } = { prompt: null }

      const result = await checkAndCompress(chatId, CONFIG, 'system', createAdapter(captured), manager)

      assert.equal(result.compressed, true)
      assert.equal(result.reason, 'success')
      assert.ok(result.tokensBefore! > result.tokensAfter!)
      assert.ok(manager.getLatestSummary(chatId), 'summary message should be persisted')

      // Tool results must be part of the compression input so the summary
      // can preserve their key data points.
      assert.ok(captured.prompt!.includes('TOOL_DATA_ALPHA'))
      assert.ok(captured.prompt!.includes('TOOL_DATA_BETA'))
      assert.ok(captured.prompt!.includes('[Tool result: query_a]'))
    } finally {
      manager.close()
      cleanup(dir)
    }
  })

  it('does not count tool blocks without a persisted result (not replayed)', async () => {
    const dir = createTempDir()
    const manager = createManager(dir)
    try {
      const chatId = seedToolHeavyChat(manager, false)
      const captured: { prompt: string | null } = { prompt: null }

      const result = await checkAndCompress(chatId, CONFIG, 'system', createAdapter(captured), manager)

      assert.equal(result.compressed, false)
      assert.equal(result.reason, 'skipped_below_threshold')
      assert.equal(captured.prompt, null)
      assert.equal(manager.getLatestSummary(chatId), null)
    } finally {
      manager.close()
      cleanup(dir)
    }
  })

  it('counts tool results on the progressive path (after an existing summary)', async () => {
    const dir = createTempDir()
    const manager = createManager(dir)
    try {
      const chat = manager.createAIChat('session-1', 'Compression', 'general_cn')
      manager.addSummaryMessage(chat.id, 'old summary of earlier topics', {
        bufferBoundaryTimestamp: Math.floor(Date.now() / 1000) - 100,
        compressedMessageCount: 10,
      })
      manager.addMessage(chat.id, 'user', 'show me stats')
      manager.addMessage(chat.id, 'assistant', 'here are the stats', undefined, undefined, [
        toolBlock('query_a', bigToolResult('TOOL_DATA_GAMMA')),
      ])
      manager.addMessage(chat.id, 'user', 'and more details')
      manager.addMessage(chat.id, 'assistant', 'more stats', undefined, undefined, [
        toolBlock('query_b', bigToolResult('TOOL_DATA_DELTA')),
      ])
      manager.addMessage(chat.id, 'user', 'thanks')
      manager.addMessage(chat.id, 'assistant', 'you are welcome')
      spreadMessageTimestamps(manager, chat.id)

      const captured: { prompt: string | null } = { prompt: null }
      const result = await checkAndCompress(chat.id, CONFIG, 'system', createAdapter(captured), manager)

      assert.equal(result.compressed, true)
      assert.equal(result.reason, 'success')
      assert.ok(captured.prompt!.includes('[PREVIOUS SUMMARY'))
      assert.ok(captured.prompt!.includes('old summary of earlier topics'))
      assert.ok(captured.prompt!.includes('TOOL_DATA_GAMMA'))
    } finally {
      manager.close()
      cleanup(dir)
    }
  })

  it('retains stable entity references outside the generated summary text', async () => {
    const dir = createTempDir()
    const manager = createManager(dir)
    const refs: AIEntityRef[] = [
      { type: 'contact', contactKey: 'qq:10001', displayName: 'Alice' },
      { type: 'session', sessionId: 'group-1', displayName: 'Project Group', sessionType: 'group' },
    ]
    try {
      const chat = manager.createGlobalAIChat('Global', 'general_cn')
      manager.addMessage(chat.id, 'user', 'compare Alice', undefined, undefined, undefined, undefined, [refs[0]!])
      manager.addMessage(chat.id, 'assistant', 'first result', undefined, undefined, [
        toolBlock('query_a', bigToolResult('ENTITY_DATA_ALPHA')),
      ])
      manager.addMessage(chat.id, 'user', 'include the project group', undefined, undefined, undefined, undefined, [
        refs[1]!,
      ])
      manager.addMessage(chat.id, 'assistant', 'second result', undefined, undefined, [
        toolBlock('query_b', bigToolResult('ENTITY_DATA_BETA')),
      ])
      manager.addMessage(chat.id, 'user', 'continue')
      manager.addMessage(chat.id, 'assistant', 'done')
      spreadMessageTimestamps(manager, chat.id)

      const captured: { prompt: string | null } = { prompt: null }
      const result = await checkAndCompress(chat.id, CONFIG, 'system', createAdapter(captured), manager)

      assert.equal(result.compressed, true)
      assert.deepEqual(manager.getLatestSummary(chat.id)?.entityRefs, refs)
      assert.deepEqual(manager.getHistoryForAgent(chat.id)[0]?.entityRefs, refs)
      assert.ok(captured.prompt!.includes('<chatlab_entity_refs>'))
    } finally {
      manager.close()
      cleanup(dir)
    }
  })

  it('does not persist a summary when cancellation happens during compression', async () => {
    const dir = createTempDir()
    const manager = createManager(dir)
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    try {
      const chatId = seedToolHeavyChat(manager, true)
      const adapter: CompressionLlmAdapter = {
        contextWindow: 1000,
        compress: async (_prompt, _maxTokens, signal) => {
          receivedSignal = signal
          controller.abort()
          return 'SUMMARY THAT MUST NOT BE PERSISTED'
        },
      }

      const result = await checkAndCompress(chatId, CONFIG, 'system', adapter, manager, undefined, {
        signal: controller.signal,
      })

      assert.equal(receivedSignal, controller.signal)
      assert.equal(result.compressed, false)
      assert.equal(result.error, 'Compression aborted')
      assert.equal(manager.getLatestSummary(chatId), null)
    } finally {
      manager.close()
      cleanup(dir)
    }
  })
})
