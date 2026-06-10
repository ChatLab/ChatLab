import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIChatManager } from '../../chats'
import type { ContentBlock } from '../../chats'
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

const CONFIG: CompressionConfig = {
  enabled: true,
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
  return chat.id
}

describe('checkAndCompress tool result token accounting', () => {
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
})
