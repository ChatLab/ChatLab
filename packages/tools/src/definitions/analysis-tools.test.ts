import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { getSegmentMessagesTool } from './get-segment-messages'
import { getSegmentSummariesTool } from './get-segment-summaries'
import { searchMessagesTool } from './search-messages'
import { searchSegmentsTool } from './search-segments'
import { schemaTool, sqlQueryTool } from './sql-query'
import { SQL_TOOL_DEFS, createSqlToolDefinition } from '../sql'
import type { RawMessage, ToolDataProvider, ToolExecutionContext, TimeFilter } from '../types'

function createContext(
  dataProvider: Partial<ToolDataProvider>,
  overrides: Partial<ToolExecutionContext> = {}
): ToolExecutionContext {
  return {
    sessionId: 'session-1',
    locale: 'en-US',
    dataProvider: dataProvider as ToolDataProvider,
    ...overrides,
  }
}

function createSqlTool(name: string) {
  const def = SQL_TOOL_DEFS.find((tool) => tool.name === name)
  assert.ok(def, `Expected SQL tool definition for ${name}`)
  return { def, tool: createSqlToolDefinition(def) }
}

describe('high-risk analysis tool definitions', () => {
  it('search_messages passes filters to the provider and returns expanded context messages', async () => {
    const contextFilter: TimeFilter = { startTs: 1710000000, endTs: 1710000100 }
    const searchCalls: Array<{ keywords: string[]; options: unknown }> = []
    const contextCalls: Array<{ ids: number[]; before: number; after: number }> = []
    const expandedMessages: RawMessage[] = [
      { id: 10, senderName: 'Alice', content: 'before', timestamp: 1710000001 },
      { id: 11, senderName: 'Bob', content: 'alpha hit', timestamp: 1710000002 },
      { id: 12, senderName: 'Alice', content: 'after', timestamp: 1710000003 },
    ]
    const context = createContext(
      {
        async searchMessages(keywords, options) {
          searchCalls.push({ keywords, options })
          return {
            total: 1,
            messages: [{ id: 11, senderName: 'Bob', content: 'alpha hit', timestamp: 1710000002 }],
          }
        },
        async getSearchMessageContext(ids, before, after) {
          contextCalls.push({ ids, before, after })
          return expandedMessages
        },
      },
      {
        timeFilter: contextFilter,
        maxMessagesLimit: 4,
        searchContextBefore: 1,
        searchContextAfter: 1,
      }
    )

    const result = await searchMessagesTool.handler({ keywords: ['alpha'], sender_id: 7, limit: 100 }, context)

    assert.deepEqual(searchCalls, [
      {
        keywords: ['alpha'],
        options: { timeFilter: contextFilter, limit: 4, senderId: 7 },
      },
    ])
    assert.deepEqual(contextCalls, [{ ids: [11], before: 1, after: 1 }])
    assert.deepEqual(result.rawMessages, expandedMessages)
    assert.deepEqual((result.data as { total: number; returned: number }).total, 1)
    assert.deepEqual((result.data as { total: number; returned: number }).returned, 3)
  })

  it('search_segments prefers explicit time parameters over context filters', async () => {
    const calls: Array<{ keywords?: string[]; timeFilter?: TimeFilter; limit?: number; previewCount?: number }> = []
    const context = createContext(
      {
        async searchSegments(keywords, timeFilter, limit, previewCount) {
          calls.push({ keywords, timeFilter, limit, previewCount })
          return [
            {
              id: 42,
              startTs: 1704067200,
              endTs: 1704067260,
              messageCount: 2,
              isComplete: true,
              previewMessages: [{ id: 1, senderName: 'Alice', content: 'hello', timestamp: 1704067201 }],
            },
          ]
        },
      },
      { timeFilter: { startTs: 1, endTs: 2 } }
    )

    const result = await searchSegmentsTool.handler(
      {
        keywords: ['hello'],
        start_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-01T00:01:00Z',
        limit: 3,
      },
      context
    )
    const data = result.data as {
      total: number
      segments: Array<{ segmentId: number; preview: string[] }>
    }

    assert.deepEqual(calls, [
      {
        keywords: ['hello'],
        timeFilter: { startTs: 1704067200, endTs: 1704067260 },
        limit: 3,
        previewCount: 5,
      },
    ])
    assert.equal(data.total, 1)
    assert.equal(data.segments[0]?.segmentId, 42)
    assert.match(data.segments[0]?.preview[0] ?? '', /Alice: hello/)
  })

  it('get_segment_messages applies maxMessagesLimit before returning raw messages', async () => {
    const calls: Array<{ segmentId: number; limit?: number }> = []
    const context = createContext(
      {
        async getSegmentMessages(segmentId, limit) {
          calls.push({ segmentId, limit })
          return {
            segmentId,
            startTs: 1704067200,
            endTs: 1704067260,
            messageCount: 3,
            returnedCount: 2,
            participants: ['Alice', 'Bob'],
            messages: [
              { id: 1, senderName: 'Alice', content: 'first', timestamp: 1704067201 },
              { id: 2, senderName: 'Bob', content: 'second', timestamp: 1704067202 },
            ],
          }
        },
      },
      { maxMessagesLimit: 2 }
    )

    const result = await getSegmentMessagesTool.handler({ segment_id: 42, limit: 100 }, context)
    const data = result.data as { segmentId: number; returnedCount: number; participants: string[] }

    assert.deepEqual(calls, [{ segmentId: 42, limit: 2 }])
    assert.equal(data.segmentId, 42)
    assert.equal(data.returnedCount, 2)
    assert.deepEqual(data.participants, ['Alice', 'Bob'])
    assert.deepEqual(result.rawMessages, [
      { id: 1, senderName: 'Alice', content: 'first', timestamp: 1704067201 },
      { id: 2, senderName: 'Bob', content: 'second', timestamp: 1704067202 },
    ])
  })

  it('get_segment_summaries filters empty and non-matching summaries after over-fetching', async () => {
    const calls: Array<{ limit?: number; timeFilter?: TimeFilter }> = []
    const contextFilter: TimeFilter = { startTs: 1704067200, endTs: 1704153600 }
    const context = createContext(
      {
        async getSegmentSummaries(options) {
          calls.push(options ?? {})
          return [
            {
              id: 1,
              startTs: 1704067200,
              endTs: 1704067260,
              messageCount: 2,
              participants: ['Alice'],
              summary: 'Launch plan discussion',
            },
            {
              id: 2,
              startTs: 1704067300,
              endTs: 1704067360,
              messageCount: 1,
              participants: ['Bob'],
              summary: null,
            },
            {
              id: 3,
              startTs: 1704067400,
              endTs: 1704067460,
              messageCount: 1,
              participants: ['Cara'],
              summary: 'Unrelated topic',
            },
          ]
        },
      },
      { timeFilter: contextFilter }
    )

    const result = await getSegmentSummariesTool.handler({ keywords: ['launch'], limit: 1 }, context)
    const data = result.data as {
      total: number
      returned: number
      segments: Array<{ segmentId: number; summary: string | null }>
    }

    assert.deepEqual(calls, [{ limit: 2, timeFilter: contextFilter }])
    assert.equal(data.total, 1)
    assert.equal(data.returned, 1)
    assert.deepEqual(
      data.segments.map((s) => s.segmentId),
      [1]
    )
    assert.equal(data.segments[0]?.summary, 'Launch plan discussion')
  })

  it('execute_sql surfaces provider read-only errors without returning bogus data', async () => {
    const context = createContext({
      async executeSql(sql) {
        assert.equal(sql, 'DELETE FROM message')
        throw new Error('Only SELECT statements are allowed')
      },
    })

    const result = await sqlQueryTool.handler({ sql: 'DELETE FROM message' }, context)

    assert.equal(result.data, undefined)
    assert.deepEqual(JSON.parse(result.content), { error: 'Only SELECT statements are allowed' })
  })

  it('get_schema returns table definitions from the provider', async () => {
    const schema = [{ name: 'message', sql: 'CREATE TABLE message (id INTEGER)' }]
    const context = createContext({
      async getSchema() {
        return schema
      },
    })

    const result = await schemaTool.handler({}, context)

    assert.deepEqual(result.data, schema)
    assert.deepEqual(JSON.parse(result.content), { tables: schema })
  })

  it('mutual_interaction_pairs uses adjacent-message windows instead of a message self-join', async () => {
    const { def } = createSqlTool('mutual_interaction_pairs')

    assert.doesNotMatch(def.execution.query, /JOIN message b ON b\.sender_id != a\.sender_id/)
    assert.match(def.execution.query, /LAG\(sender_id\) OVER/)
    assert.match(def.execution.query, /ordered_messages/)
  })

  it('mutual_interaction_pairs formats adjacent interaction rows from the provider', async () => {
    const { tool } = createSqlTool('mutual_interaction_pairs')
    const calls: Array<{ query: string; params: Record<string, unknown> }> = []
    const context = createContext({
      async executeParameterizedSql<T = Record<string, unknown>>(query: string, params: Record<string, unknown>) {
        calls.push({ query, params })
        return [{ member_a: 'Alice', member_b: 'Bob', interaction_count: 2 }] as T[]
      },
    })

    const result = await tool.handler({ days: 30, limit: 5 }, context)

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.params.days, 30)
    assert.equal(calls[0]?.params.limit, 5)
    assert.match(result.content, /Alice/)
    assert.match(result.content, /Bob/)
    assert.deepEqual((result.data as { rows: unknown[]; rowCount: number }).rowCount, 1)
  })

  it('reply_interaction_ranking still ranks explicit reply relationships', async () => {
    const { def, tool } = createSqlTool('reply_interaction_ranking')
    const context = createContext({
      async executeParameterizedSql<T = Record<string, unknown>>(query: string, params: Record<string, unknown>) {
        assert.equal(query, def.execution.query)
        assert.deepEqual(params, { days: 14, limit: 3 })
        return [{ replier_name: 'Bob', original_name: 'Alice', reply_count: 4 }] as T[]
      },
    })

    assert.match(def.execution.query, /reply_to_message_id/)
    assert.match(def.execution.query, /ORDER BY reply_count DESC/)

    const result = await tool.handler({ days: 14, limit: 3 }, context)

    assert.match(result.content, /Bob/)
    assert.match(result.content, /Alice/)
    assert.match(result.content, /4/)
  })
})
