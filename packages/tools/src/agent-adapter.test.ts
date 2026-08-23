import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  CrossChatGlobalActivitySummaryRequest,
  CrossChatGlobalActivitySummaryResult,
} from '@openchatlab/shared-types'
import { createCrossChatAgentToolAdapters } from './agent-adapter'
import type { CrossChatAnalysisToolService } from './types'

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

test('the shared Desktop and CLI Web adapter exposes and executes all ten cross-chat tools', async () => {
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
    maxToolResultTokens: 16_000,
    preprocessMessagesBySession: async (_sessionId, messages) => messages,
    preprocessSummariesBySession: async (_sessionId, summaries) => summaries,
    preprocessModelLabel: (value) => value,
  })

  assert.equal(tools.length, 10)
  const summaryTool = tools.find((tool) => tool.name === 'get_global_activity_summary')
  assert.ok(summaryTool)
  assert.deepEqual(Object.keys(summaryTool.parameters.properties), ['mode', 'year'])

  const result = await summaryTool.execute('summary-call', { mode: 'year', year: 2026 }, new AbortController().signal)

  assert.deepEqual(requests, [{ mode: 'year', year: 2026 }])
  assert.equal((result.details as CrossChatGlobalActivitySummaryResult).dataState, 'fresh')
  assert.equal(JSON.parse(result.content[0]?.text ?? '{}').metrics.sentMessageCount, 100)
})
