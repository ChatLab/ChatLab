import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { retrieveChatEvidenceTool } from './retrieve-chat-evidence'
import type {
  ChatEvidencePayload,
  RawMessage,
  SearchMessagesResult,
  SemanticSearchToolResult,
  SemanticSearchToolService,
  ToolDataProvider,
  ToolExecutionContext,
} from '../types'

function semanticResult(over: Partial<SemanticSearchToolResult> = {}): SemanticSearchToolResult {
  return {
    available: true,
    text: 'U1: 到了乐山大佛',
    returned: 1,
    hitCount: 1,
    partial: false,
    coverage: 1,
    truncated: false,
    timeRange: { earliest: '2024-05-01T00:00:00.000Z', latest: '2024-05-01T01:00:00.000Z' },
    sources: [
      {
        startMessageId: 100,
        endMessageId: 110,
        score: 0.9,
        chunkIds: ['c1'],
        snippet: '到了乐山大佛，住了一晚',
        startTime: '2024-05-01T00:00:00.000Z',
        endTime: '2024-05-01T01:00:00.000Z',
      },
    ],
    ...over,
  }
}

function makeService(over: Partial<SemanticSearchToolService> = {}): SemanticSearchToolService {
  return {
    canSearch: () => true,
    searchForTool: async () => semanticResult(),
    ...over,
  }
}

/** 秒级 RawMessage，模拟聊天库返回 */
function rawMsg(id: number, tsSeconds: number, content: string, senderName = '甲'): RawMessage {
  return { id, senderName, content, timestamp: tsSeconds }
}

function makeDataProvider(messages: RawMessage[], capture?: { args?: unknown[] }): ToolDataProvider {
  return {
    searchMessages: async (keywords, options): Promise<SearchMessagesResult> => {
      if (capture) capture.args = [keywords, options]
      return { messages, total: messages.length }
    },
  } as unknown as ToolDataProvider
}

function makeContext(extra: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return { sessionId: 's1', locale: 'zh-CN', ...extra }
}

function getPayload(data: unknown): ChatEvidencePayload {
  const evidence = (data as { evidence?: ChatEvidencePayload })?.evidence
  assert.ok(evidence, 'data.evidence should exist')
  return evidence
}

describe('retrieveChatEvidenceTool schema', () => {
  it('requires query and exposes evidence params', () => {
    const props = retrieveChatEvidenceTool.inputSchema.properties
    const keys = Object.keys(props).sort()
    assert.deepEqual(retrieveChatEvidenceTool.inputSchema.required, ['query'])
    for (const k of ['query', 'criteria', 'keywords', 'mode', 'max_results', 'start_time', 'end_time']) {
      assert.ok(keys.includes(k), `schema should include ${k}`)
    }
  })

  it('is registered as a core tool', () => {
    assert.equal(retrieveChatEvidenceTool.name, 'retrieve_chat_evidence')
  })
})

describe('retrieveChatEvidenceTool mode resolution', () => {
  it('auto resolves to hybrid and calls both semantic + keyword when available with keywords', async () => {
    let semanticCalled = false
    const capture: { args?: unknown[] } = {}
    const service = makeService({
      searchForTool: async () => {
        semanticCalled = true
        return semanticResult()
      },
    })
    const dp = makeDataProvider([rawMsg(200, 1714521600, '我们去乐山玩了')], capture)
    const res = await retrieveChatEvidenceTool.handler(
      { query: '去过乐山几次', criteria: '实际出行', keywords: ['乐山'] },
      makeContext({ semanticIndexService: service, dataProvider: dp })
    )
    assert.equal(semanticCalled, true)
    assert.ok(capture.args, 'keyword search should be called')
    const payload = getPayload(res.data)
    assert.equal(payload.mode, 'hybrid')
  })

  it('semantic mode does not call keyword search', async () => {
    const capture: { args?: unknown[] } = {}
    const dp = makeDataProvider([rawMsg(1, 1714521600, 'x')], capture)
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', mode: 'semantic', keywords: ['乐山'] },
      makeContext({ semanticIndexService: makeService(), dataProvider: dp })
    )
    assert.equal(capture.args, undefined)
    assert.equal(getPayload(res.data).mode, 'semantic')
  })

  it('keyword mode without keywords returns warning + empty', async () => {
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', mode: 'keyword' },
      makeContext({ dataProvider: makeDataProvider([]) })
    )
    const payload = getPayload(res.data)
    assert.equal(payload.mode, 'keyword')
    assert.ok(payload.warnings?.includes('keywords_required_for_keyword_mode'))
    assert.deepEqual(payload.groups, [])
  })

  it('auto resolves to semantic when index available but no keywords', async () => {
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q' },
      makeContext({ semanticIndexService: makeService(), dataProvider: makeDataProvider([]) })
    )
    const payload = getPayload(res.data)
    assert.equal(payload.mode, 'semantic')
    assert.ok(payload.warnings?.includes('keywords_missing_for_hybrid'))
  })

  it('auto resolves to keyword + semantic_unavailable when index missing', async () => {
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', keywords: ['乐山'] },
      makeContext({ dataProvider: makeDataProvider([rawMsg(1, 1714521600, '乐山')]) })
    )
    const payload = getPayload(res.data)
    assert.equal(payload.mode, 'keyword')
    assert.ok(payload.warnings?.includes('semantic_unavailable'))
  })
})

describe('retrieveChatEvidenceTool warnings', () => {
  it('warns when criteria is missing', async () => {
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', keywords: ['乐山'] },
      makeContext({ semanticIndexService: makeService(), dataProvider: makeDataProvider([]) })
    )
    assert.ok(getPayload(res.data).warnings?.includes('criteria_missing'))
  })

  it('warns keyword_unavailable when dataProvider missing but continues with semantic', async () => {
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', criteria: 'c', mode: 'hybrid', keywords: ['乐山'] },
      makeContext({ semanticIndexService: makeService() })
    )
    const payload = getPayload(res.data)
    assert.ok(payload.warnings?.includes('keyword_unavailable'))
    assert.ok(payload.groups.length > 0, 'semantic results should still produce groups')
  })

  it('warns semantic_unavailable but keyword continues', async () => {
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', criteria: 'c', mode: 'hybrid', keywords: ['乐山'] },
      makeContext({ dataProvider: makeDataProvider([rawMsg(1, 1714521600, '到了乐山')]) })
    )
    const payload = getPayload(res.data)
    assert.ok(payload.warnings?.includes('semantic_unavailable'))
    assert.ok(payload.groups.length > 0)
  })

  it('warns semantic_partial when semantic result is partial', async () => {
    const service = makeService({ searchForTool: async () => semanticResult({ partial: true }) })
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', criteria: 'c', mode: 'semantic' },
      makeContext({ semanticIndexService: service })
    )
    assert.ok(getPayload(res.data).warnings?.includes('semantic_partial'))
  })
})

describe('retrieveChatEvidenceTool candidates & grouping', () => {
  it('converts keyword RawMessage seconds timestamp to milliseconds', async () => {
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', criteria: 'c', mode: 'keyword', keywords: ['乐山'] },
      makeContext({ dataProvider: makeDataProvider([rawMsg(1, 1714521600, '到了乐山')]) })
    )
    const payload = getPayload(res.data)
    const source = payload.groups[0].sources[0]
    assert.equal(source.timestamp, 1714521600 * 1000)
  })

  it('strips per-line time prefixes from semantic snippets (display shows one group time)', async () => {
    const service = makeService({
      searchForTool: async () =>
        semanticResult({
          sources: [
            {
              startMessageId: 100,
              endMessageId: 110,
              score: 0.9,
              chunkIds: ['c1'],
              // 预处理管道渲染格式：每行「时间 发送者: 内容」
              snippet: '2024/5/1 08:00:00 甲: 到了乐山\n2024/5/1 09:00:00 乙: 住了一晚',
              startTime: '2024-05-01T00:00:00.000Z',
              endTime: '2024-05-01T01:00:00.000Z',
            },
          ],
        }),
    })
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', criteria: 'c', mode: 'semantic' },
      makeContext({ semanticIndexService: service })
    )
    const snippet = getPayload(res.data).groups[0].sources[0].snippet
    assert.equal(snippet.includes('2024/5/1'), false)
    assert.equal(snippet.includes('08:00:00'), false)
    assert.ok(snippet.includes('甲: 到了乐山'))
    assert.ok(snippet.includes('乙: 住了一晚'))
  })

  it('desensitizes keyword snippets and never persists raw secret content', async () => {
    const desensitize = (messages: RawMessage[]): RawMessage[] =>
      messages.map((m) => ({ ...m, content: (m.content ?? '').replace('13800000000', '***') }))
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', criteria: 'c', mode: 'keyword', keywords: ['乐山'] },
      makeContext({
        dataProvider: makeDataProvider([rawMsg(1, 1714521600, '到了乐山 13800000000')]),
        desensitizeMessages: desensitize,
      })
    )
    const payload = getPayload(res.data)
    const blob = JSON.stringify(payload)
    assert.equal(blob.includes('13800000000'), false)
    assert.ok(blob.includes('***'))
  })

  it('dedupes keyword hit that falls inside a semantic range', async () => {
    // semantic range [100,110]; keyword hit id=105 within → should not double-count
    const dp = makeDataProvider([rawMsg(105, 1714521600, '到了乐山大佛')])
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', criteria: 'c', mode: 'hybrid', keywords: ['乐山'] },
      makeContext({ semanticIndexService: makeService(), dataProvider: dp })
    )
    const payload = getPayload(res.data)
    const allSources = payload.groups.flatMap((g) => g.sources)
    const ids = allSources.map((s) => s.messageId)
    // only the semantic source (anchor 100) should remain, keyword 105 deduped into range
    assert.ok(!ids.includes(105), 'keyword hit inside semantic range should be deduped')
  })

  it('splits candidates into separate groups when time gap exceeds threshold', async () => {
    const base = 1714521600
    const messages = [
      rawMsg(1, base, '到了乐山'),
      rawMsg(2, base + 30 * 60, '在乐山吃饭'), // +30min same group
      rawMsg(3, base + 5 * 24 * 60 * 60, '又去乐山'), // +5 days new group
    ]
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', criteria: 'c', mode: 'keyword', keywords: ['乐山'] },
      makeContext({ dataProvider: makeDataProvider(messages) })
    )
    const payload = getPayload(res.data)
    assert.equal(payload.groups.length, 2)
  })
})

describe('retrieveChatEvidenceTool output safety', () => {
  it('never returns rawMessages and produces non-empty content', async () => {
    const res = await retrieveChatEvidenceTool.handler(
      { query: 'q', criteria: 'c', mode: 'keyword', keywords: ['乐山'] },
      makeContext({ dataProvider: makeDataProvider([rawMsg(1, 1714521600, '到了乐山')]) })
    )
    assert.equal(res.rawMessages, undefined)
    assert.ok(typeof res.content === 'string' && res.content.length > 0)
  })

  it('applies time filter fallback on keyword path (seconds compare)', async () => {
    const base = 1714521600 // 2024-05-01
    const messages = [rawMsg(1, base, '到了乐山'), rawMsg(2, base + 365 * 24 * 60 * 60, '一年后又去乐山')]
    const res = await retrieveChatEvidenceTool.handler(
      {
        query: 'q',
        criteria: 'c',
        mode: 'keyword',
        keywords: ['乐山'],
        start_time: '2024-04-01',
        end_time: '2024-06-01',
      },
      makeContext({ dataProvider: makeDataProvider(messages) })
    )
    const payload = getPayload(res.data)
    const ids = payload.groups.flatMap((g) => g.sources).map((s) => s.messageId)
    assert.deepEqual(ids, [1], 'out-of-range message should be filtered out')
  })
})
