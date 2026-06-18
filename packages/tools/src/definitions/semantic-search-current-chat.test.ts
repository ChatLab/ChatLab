import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { semanticSearchCurrentChatTool } from './semantic-search-current-chat'
import type { SemanticSearchToolResult, SemanticSearchToolService, ToolExecutionContext } from '../types'
import { SEMANTIC_SEARCH_MAX_RESULTS_HARD_CAP } from '../types'

function makeResult(over: Partial<SemanticSearchToolResult> = {}): SemanticSearchToolResult {
  return {
    available: true,
    text: 'U1: hello\nU2: world',
    returned: 1,
    hitCount: 3,
    partial: false,
    coverage: 1,
    truncated: false,
    timeRange: { earliest: '2024-01-01T00:00:00.000Z', latest: '2024-01-02T00:00:00.000Z' },
    sources: [
      {
        startMessageId: 10,
        endMessageId: 12,
        score: 0.8,
        chunkIds: ['c1'],
        snippet: 'U1: hello',
        startTime: '2024-01-01T00:00:00.000Z',
        endTime: '2024-01-01T00:01:00.000Z',
      },
    ],
    ...over,
  }
}

function makeContext(
  service: SemanticSearchToolService | undefined,
  extra: Partial<ToolExecutionContext> = {}
): ToolExecutionContext {
  return { sessionId: 's1', locale: 'zh-CN', semanticIndexService: service, ...extra }
}

describe('semanticSearchCurrentChatTool', () => {
  it('is restricted to query + max_results only', () => {
    const props = semanticSearchCurrentChatTool.inputSchema.properties
    assert.deepEqual(Object.keys(props).sort(), ['max_results', 'query'])
    assert.deepEqual(semanticSearchCurrentChatTool.inputSchema.required, ['query'])
  })

  it('returns an unavailable message when service is not injected', async () => {
    const result = await semanticSearchCurrentChatTool.handler({ query: 'x' }, makeContext(undefined))
    assert.match(result.content, /not available/i)
    assert.equal(result.rawMessages, undefined)
  })

  it('returns a hint for empty query without calling the service', async () => {
    let called = false
    const service: SemanticSearchToolService = {
      canSearch: () => true,
      searchForTool: async () => {
        called = true
        return makeResult()
      },
    }
    const result = await semanticSearchCurrentChatTool.handler({ query: '   ' }, makeContext(service))
    assert.equal(called, false)
    assert.match(result.content, /query/i)
  })

  it('clamps max_results to the hard cap and forwards safe options', async () => {
    let receivedMax: number | undefined
    let receivedOpts: Record<string, unknown> | undefined
    const service: SemanticSearchToolService = {
      canSearch: () => true,
      searchForTool: async (_s, _q, opts) => {
        receivedMax = opts?.maxResults
        receivedOpts = opts as Record<string, unknown>
        return makeResult()
      },
    }
    await semanticSearchCurrentChatTool.handler(
      { query: 'hello', max_results: 999 },
      makeContext(service, {
        preprocessConfig: { desensitize: true },
        ownerPlatformId: 'owner',
        maxToolResultTokens: 2000,
      })
    )
    assert.equal(receivedMax, SEMANTIC_SEARCH_MAX_RESULTS_HARD_CAP)
    assert.deepEqual(receivedOpts?.preprocessConfig, { desensitize: true })
    assert.equal(receivedOpts?.ownerPlatformId, 'owner')
    assert.equal(receivedOpts?.maxResultTokens, 2000)
  })

  it('passes undefined maxResults when LLM does not specify (service uses configured default)', async () => {
    let receivedMax: number | undefined = 1
    const service: SemanticSearchToolService = {
      canSearch: () => true,
      searchForTool: async (_s, _q, opts) => {
        receivedMax = opts?.maxResults
        return makeResult()
      },
    }
    await semanticSearchCurrentChatTool.handler({ query: 'hello' }, makeContext(service))
    assert.equal(receivedMax, undefined)
  })

  it('returns safe text + metadata, never rawMessages', async () => {
    const service: SemanticSearchToolService = {
      canSearch: () => true,
      searchForTool: async () => makeResult(),
    }
    const result = await semanticSearchCurrentChatTool.handler({ query: 'hello' }, makeContext(service))
    assert.match(result.content, /U1: hello/)
    assert.equal(result.rawMessages, undefined)
    const data = result.data as Record<string, unknown>
    assert.equal(data.returned, 1)
    assert.equal(data.hitCount, 3)
    assert.ok(data.sources)
    assert.equal(JSON.stringify(data).includes('rawMessages'), false)
  })

  it('reports no-results without throwing', async () => {
    const service: SemanticSearchToolService = {
      canSearch: () => true,
      searchForTool: async () => makeResult({ returned: 0, sources: [], text: '', hitCount: 0 }),
    }
    const result = await semanticSearchCurrentChatTool.handler({ query: 'hello' }, makeContext(service))
    assert.match(result.content, /no relevant/i)
  })

  it('appends a truncation notice when truncated', async () => {
    const service: SemanticSearchToolService = {
      canSearch: () => true,
      searchForTool: async () => makeResult({ truncated: true }),
    }
    const result = await semanticSearchCurrentChatTool.handler({ query: 'hello' }, makeContext(service))
    assert.match(result.content, /result limit/i)
  })
})
