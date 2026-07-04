import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { getSegmentMessagesTool } from './get-segment-messages'
import { getSegmentSummariesTool } from './get-segment-summaries'
import { getMessageContextTool } from './get-message-context'
import { getConversationBetweenTool } from './get-conversation-between'
import { recentMessagesTool } from './recent-messages'
import { searchMessagesTool } from './search-messages'
import { deepSearchMessagesTool } from './deep-search-messages'
import { schemaTool, sqlQueryTool } from './sql-query'
import { timeStatsTool } from './time-stats'
import { SQL_TOOL_DEFS, createSqlToolDefinition } from '../sql'
import type { RawMessage, ToolDataProvider, ToolExecutionContext, ToolTimeRange } from '../types'

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
    const contextFilter: ToolTimeRange = { startTs: 1710000000, endTs: 1710000100 }
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

  it('search_messages respects a user limit smaller than maxMessagesLimit', async () => {
    const searchCalls: Array<{ keywords: string[]; options?: { limit?: number } }> = []
    const context = createContext(
      {
        async searchMessages(keywords, options) {
          searchCalls.push({ keywords, options })
          return { total: 0, messages: [] }
        },
        async getSearchMessageContext() {
          return []
        },
      },
      { maxMessagesLimit: 1000 }
    )

    await searchMessagesTool.handler({ keywords: ['alpha'], limit: 12 }, context)

    assert.equal(searchCalls[0]?.options?.limit, 12)
  })

  it('search tools keep expanded context within the effective limit without dropping hits', async () => {
    const expandedMessages: RawMessage[] = [
      { id: 10, senderName: 'Alice', content: 'before', timestamp: 1710000001 },
      { id: 11, senderName: 'Bob', content: 'alpha hit', timestamp: 1710000002 },
      { id: 12, senderName: 'Alice', content: 'after', timestamp: 1710000003 },
    ]

    for (const tool of [searchMessagesTool, deepSearchMessagesTool]) {
      const context = createContext({
        async searchMessages() {
          return {
            total: 1,
            messages: [{ id: 11, senderName: 'Bob', content: 'alpha hit', timestamp: 1710000002 }],
          }
        },
        async deepSearchMessages() {
          return {
            total: 1,
            messages: [{ id: 11, senderName: 'Bob', content: 'alpha hit', timestamp: 1710000002 }],
          }
        },
        async getSearchMessageContext() {
          return expandedMessages
        },
      })

      const result = await tool.handler({ keywords: ['alpha'], limit: 1 }, context)
      const data = result.data as { returned: number }

      assert.equal(data.returned, 1, tool.name)
      assert.deepEqual(
        result.rawMessages?.map((message) => message.id),
        [11],
        tool.name
      )
    }
  })

  it('get_recent_messages respects a user limit smaller than maxMessagesLimit', async () => {
    const calls: Array<{ limit?: number }> = []
    const context = createContext(
      {
        async getRecentMessages(options) {
          calls.push(options ?? {})
          return { total: 0, messages: [] }
        },
      },
      { maxMessagesLimit: 1000 }
    )

    await recentMessagesTool.handler({ limit: 12 }, context)

    assert.equal(calls[0]?.limit, 12)
  })

  it('get_conversation_between respects a user limit smaller than maxMessagesLimit', async () => {
    const calls: Array<{ limit?: number }> = []
    const context = createContext(
      {
        async getConversationBetween(_memberId1, _memberId2, _timeFilter, limit) {
          calls.push({ limit })
          return { total: 0, messages: [], member1Name: '', member2Name: '' }
        },
      },
      { maxMessagesLimit: 1000 }
    )

    await getConversationBetweenTool.handler({ member_id_1: 1, member_id_2: 2, limit: 20 }, context)

    assert.equal(calls[0]?.limit, 20)
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

  it('get_segment_messages respects a user limit smaller than maxMessagesLimit', async () => {
    const calls: Array<{ segmentId: number; limit?: number }> = []
    const context = createContext(
      {
        async getSegmentMessages(segmentId, limit) {
          calls.push({ segmentId, limit })
          return null
        },
      },
      { maxMessagesLimit: 1000 }
    )

    await getSegmentMessagesTool.handler({ segment_id: 42, limit: 12 }, context)

    assert.deepEqual(calls, [{ segmentId: 42, limit: 12 }])
  })

  it('get_message_context clamps context_size to maxMessagesLimit', async () => {
    const calls: Array<{ ids: number[]; contextSize: number }> = []
    const context = createContext(
      {
        async getMessageContext(ids, contextSize) {
          calls.push({ ids, contextSize })
          return [
            { id: 10, senderName: 'Alice', content: 'hit one', timestamp: 1710000001 },
            { id: 20, senderName: 'Bob', content: 'hit two', timestamp: 1710000002 },
            { id: 30, senderName: 'Cara', content: 'hit three', timestamp: 1710000003 },
          ]
        },
      },
      { maxMessagesLimit: 12 }
    )

    const result = await getMessageContextTool.handler({ message_ids: [10, 20, 30], context_size: 20 }, context)

    assert.deepEqual(calls, [{ ids: [10, 20, 30], contextSize: 1 }])
    assert.equal((result.data as { contextSize: number }).contextSize, 1)
  })

  it('get_message_context clamps negative context_size before applying maxMessagesLimit', async () => {
    const calls: Array<{ ids: number[]; contextSize: number }> = []
    const context = createContext(
      {
        async getMessageContext(ids, contextSize) {
          calls.push({ ids, contextSize })
          return [{ id: 10, senderName: 'Alice', content: 'hit', timestamp: 1710000001 }]
        },
      },
      { maxMessagesLimit: 12 }
    )

    const result = await getMessageContextTool.handler({ message_ids: [10], context_size: -1 }, context)

    assert.deepEqual(calls, [{ ids: [10], contextSize: 0 }])
    assert.equal((result.data as { contextSize: number }).contextSize, 0)
  })

  it('get_segment_summaries filters empty and non-matching summaries after over-fetching', async () => {
    const calls: Array<{ limit?: number; timeFilter?: ToolTimeRange }> = []
    const contextFilter: ToolTimeRange = { startTs: 1704067200, endTs: 1704153600 }
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

  it('get_time_stats accepts explicit time range parameters', async () => {
    const calls: Array<{ type: string; timeFilter?: ToolTimeRange }> = []
    const context = createContext({
      async getTimeStats(type, options) {
        calls.push({ type, timeFilter: options?.timeFilter })
        return []
      },
    })

    await timeStatsTool.handler(
      {
        type: 'daily',
        start_time: '2024-03-10 00:00',
        end_time: '2024-03-11 00:00',
      },
      context
    )

    assert.equal(calls[0]?.type, 'daily')
    assert.equal(calls[0]?.timeFilter?.startTs, Math.floor(new Date('2024-03-10T00:00').getTime() / 1000))
    assert.equal(calls[0]?.timeFilter?.endTs, Math.floor(new Date('2024-03-11T00:00').getTime() / 1000))
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

  it('execute_sql passes max_rows and clamps provider output', async () => {
    const calls: Array<{ sql: string; maxRows?: number }> = []
    const context = createContext(
      {
        async executeSql(sql, options) {
          calls.push({ sql, maxRows: options?.maxRows })
          return {
            columns: ['id'],
            rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
            rowCount: 3,
            truncated: false,
          }
        },
      },
      { maxMessagesLimit: 2 }
    )

    const result = await sqlQueryTool.handler({ sql: 'SELECT id FROM message', max_rows: 10 }, context)
    const data = result.data as { rows: Array<{ id: number }>; rowCount: number; truncated: boolean }

    assert.deepEqual(calls, [{ sql: 'SELECT id FROM message', maxRows: 2 }])
    assert.deepEqual(data.rows, [{ id: 1 }, { id: 2 }])
    assert.equal(data.rowCount, 2)
    assert.equal(data.truncated, true)
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
