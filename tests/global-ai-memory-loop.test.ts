import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { AIMemoryService, buildGlobalMemoryPrompt } from '../packages/node-runtime/src/ai/memory'
import type { CrossChatSearchRequest, CrossChatSearchResult } from '@openchatlab/shared-types'
import { ChatType } from '@openchatlab/shared-types'
import {
  memoryReadTool,
  memoryWriteTool,
  searchMessagesGloballyTool,
  type CrossChatAnalysisToolService,
  type CrossChatToolExecutionContext,
} from '../packages/tools/src'

const sqliteNativeBinding = process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING

it('recalls a durable preference in a new global AI conversation before querying chat data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-global-memory-loop-'))
  const memoryService = new AIMemoryService(dir, { nativeBinding: sqliteNativeBinding })
  let capturedSearch: CrossChatSearchRequest | null = null
  const analysisService = {
    searchMessages: async (request: CrossChatSearchRequest): Promise<CrossChatSearchResult> => {
      capturedSearch = request
      return {
        messages: [
          {
            sessionId: 'private-1',
            sessionName: 'Alice',
            sessionType: ChatType.PRIVATE,
            platform: 'test',
            lastMessageTs: 100,
            messageId: 1,
            senderId: 1,
            senderName: 'Me',
            senderPlatformId: 'owner',
            content: '我最近在看房',
            timestamp: 100,
            messageType: 0,
          },
        ],
        totalMatches: 1,
        appliedFilters: { startTs: null, endTs: null, recentDays: request.recentDays ?? null, sender: 'owner' },
        coverage: {
          candidateSessions: 1,
          scannedSessions: 1,
          matchedSessions: 1,
          failedSessions: 0,
          truncated: false,
          truncatedReasons: [],
        },
      }
    },
  } as unknown as CrossChatAnalysisToolService

  const createContext = (aiChatId: string): CrossChatToolExecutionContext => ({
    locale: 'zh-CN',
    analysisService,
    memoryService,
    aiChatId,
    preprocessMessagesBySession: (_sessionId, messages) => messages,
    preprocessSummariesBySession: (_sessionId, summaries) => summaries,
    preprocessModelLabel: (value) => value,
  })

  try {
    await memoryWriteTool.handler(
      {
        scope_type: 'global',
        content: '用户所说的“最近”默认指最近 90 天',
        source_type: 'user',
      },
      createContext('global-chat-write')
    )

    const prompt = buildGlobalMemoryPrompt(memoryService.list({ scopeType: 'global', scopeId: null }), 'zh-CN')
    assert.match(prompt, /最近 90 天/)

    const secondConversation = createContext('global-chat-read')
    const recalled = await memoryReadTool.handler({ scope_type: 'global' }, secondConversation)
    const rememberedDays = Number(recalled.content.match(/最近 (\d+) 天/)?.[1])
    assert.equal(rememberedDays, 90)

    await searchMessagesGloballyTool.handler(
      { keywords: ['买房'], recent_days: rememberedDays, sender: 'owner' },
      secondConversation
    )
    assert.equal(capturedSearch?.recentDays, 90)
    assert.equal(capturedSearch?.sender, 'owner')
  } finally {
    memoryService.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
