import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AIMemoryEntry,
  AIMemoryScope,
  AIEntityRef,
  CrossChatEntityResolution,
  CrossChatGlobalActivitySummaryRequest,
  CrossChatGlobalActivitySummaryResult,
} from '@openchatlab/shared-types'
import { createCrossChatAgentToolAdapters } from './agent-adapter'
import type { AIMemoryToolService, CrossChatAnalysisToolService } from './types'

function globalActivitySummary(): CrossChatGlobalActivitySummaryResult {
  return {
    mode: 'year',
    dataState: 'fresh',
    summary: {
      range: { mode: 'year', year: 2026, startTs: 1, endTs: 2 },
      availableDataYears: [2026],
      latestDataYear: 2026,
      metrics: {
        sentMessageCount: 100,
        activeDayCount: 10,
        directContactCount: 5,
        averageMessagesPerDay: 10,
        averageDirectContactsPerDay: 1,
      },
      monthlyActivity: [],
      monthlyDirectContacts: [],
      dailyActivity: [],
      messageTypes: [],
      textLength: null,
      coverage: {
        totalSessions: 2,
        analyzedSessions: 2,
        missingOwnerSessions: 0,
        unresolvedOwnerSessions: 0,
        failedSessions: 0,
      },
      cache: { status: 'fresh', computedAt: 3 },
      task: {
        id: null,
        status: 'idle',
        startedAt: null,
        finishedAt: null,
        processedSessions: 0,
        totalSessions: 0,
      },
    },
  }
}

test('the shared Desktop and CLI Web adapter exposes and executes all thirteen cross-chat tools', async () => {
  const requests: CrossChatGlobalActivitySummaryRequest[] = []
  const analysisService = {
    getGlobalActivitySummary(request: CrossChatGlobalActivitySummaryRequest) {
      requests.push(request)
      return globalActivitySummary()
    },
  } as unknown as CrossChatAnalysisToolService
  const tools = createCrossChatAgentToolAdapters({
    locale: 'zh-CN',
    analysisService,
    memoryService: {} as Parameters<typeof createCrossChatAgentToolAdapters>[0]['memoryService'],
    aiChatId: 'global-chat-test',
    maxToolResultTokens: 16_000,
    preprocessMessagesBySession: async (_sessionId, messages) => messages,
    preprocessSummariesBySession: async (_sessionId, summaries) => summaries,
    preprocessModelLabel: (value) => value,
  })

  assert.equal(tools.length, 13)
  const summaryTool = tools.find((tool) => tool.name === 'get_global_activity_summary')
  assert.ok(summaryTool)
  assert.deepEqual(Object.keys(summaryTool.parameters.properties), ['mode', 'year'])

  const result = await summaryTool.execute('summary-call', { mode: 'year', year: 2026 }, new AbortController().signal)

  assert.deepEqual(requests, [{ mode: 'year', year: 2026 }])
  assert.equal((result.details as CrossChatGlobalActivitySummaryResult).dataState, 'fresh')
  assert.equal(JSON.parse(result.content[0]?.text ?? '{}').metrics.sentMessageCount, 100)
})

test('cross-chat tool adapters share entities resolved during the current Agent run', async () => {
  const analysisService = {
    resolveEntities: async (refs: AIEntityRef[]): Promise<CrossChatEntityResolution> => ({
      contacts: refs
        .filter((ref): ref is Extract<AIEntityRef, { type: 'contact' }> => ref.type === 'contact')
        .map((ref) => ({
          ref,
          status: 'resolved' as const,
          cacheStatus: 'fresh' as const,
          sessions: [],
          unresolvedSessionIds: [],
          failedSessionIds: [],
        })),
      sessions: [],
      unresolved: [],
      coverage: {
        requestedEntities: refs.length,
        resolvedEntities: refs.length,
        candidateSessions: 0,
        resolvedSessions: 0,
        failedSessions: 0,
      },
    }),
  } as unknown as CrossChatAnalysisToolService
  const memory: AIMemoryEntry = {
    id: 'memory-contact-2',
    scopeType: 'contact',
    scopeId: 'contact-2',
    content: 'Newly resolved contact memory',
    sourceType: 'user',
    sourceAIChatId: null,
    sourceMessageId: null,
    createdAt: 1,
    updatedAt: 1,
  }
  const memoryService = {
    list: (scope?: AIMemoryScope) =>
      scope?.scopeType === memory.scopeType && scope.scopeId === memory.scopeId ? [memory] : [],
  } as unknown as AIMemoryToolService
  const tools = createCrossChatAgentToolAdapters({
    locale: 'zh-CN',
    entityRefs: [{ type: 'contact', contactKey: 'contact-1', displayName: 'Previous selection' }],
    analysisService,
    memoryService,
    aiChatId: 'global-chat-test',
    maxToolResultTokens: 16_000,
    preprocessMessagesBySession: async (_sessionId, messages) => messages,
    preprocessSummariesBySession: async (_sessionId, summaries) => summaries,
    preprocessModelLabel: (value) => value,
  })
  const resolveTool = tools.find((tool) => tool.name === 'resolve_chat_entities')
  const memoryReadTool = tools.find((tool) => tool.name === 'memory_read')
  assert.ok(resolveTool)
  assert.ok(memoryReadTool)

  const signal = new AbortController().signal
  const beforeResolve = await memoryReadTool.execute(
    'memory-before-resolve',
    { scope_type: 'contact', scope_id: 'contact-2' },
    signal
  )
  assert.equal(beforeResolve.isError, true)

  await resolveTool.execute(
    'resolve-contact-2',
    {
      entities: [{ type: 'contact', contactKey: 'contact-2', displayName: 'New contact' }],
    },
    signal
  )
  const afterResolve = await memoryReadTool.execute(
    'memory-after-resolve',
    { scope_type: 'contact', scope_id: 'contact-2' },
    signal
  )

  assert.equal(afterResolve.isError, undefined)
  assert.deepEqual((afterResolve.details as { entries: AIMemoryEntry[] }).entries, [memory])
})
