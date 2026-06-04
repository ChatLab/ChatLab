import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type ToolCall,
  type Usage,
} from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import {
  renderChartTool,
  type ToolDataProvider,
  type ToolDefinition,
  type ToolExecutionContext,
} from '@openchatlab/tools'
import type { ChartPayload } from '@openchatlab/core'
import { runAgentCore, type AgentCoreEvent } from '../../packages/node-runtime/src/ai/agent'

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function assistantMessage(
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason']
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'chatlab-test',
    model: 'fake-chart-model',
    usage: emptyUsage(),
    stopReason,
    timestamp: Date.now(),
  }
}

function createToolCallsStream(toolCalls: ToolCall[]) {
  const stream = createAssistantMessageEventStream()
  const partialStart = assistantMessage([], 'toolUse')
  const finalMessage = assistantMessage(toolCalls, 'toolUse')
  stream.push({ type: 'start', partial: partialStart })
  toolCalls.forEach((toolCall, contentIndex) => {
    stream.push({ type: 'toolcall_start', contentIndex, partial: finalMessage })
    stream.push({
      type: 'toolcall_delta',
      contentIndex,
      delta: JSON.stringify(toolCall.arguments),
      partial: finalMessage,
    })
    stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: finalMessage })
  })
  stream.push({ type: 'done', reason: 'toolUse', message: finalMessage })
  return stream
}

function createToolCallStream(toolCall: ToolCall) {
  return createToolCallsStream([toolCall])
}

function createTextStream(text: string) {
  const stream = createAssistantMessageEventStream()
  const partialStart = assistantMessage([], 'stop')
  const finalMessage = assistantMessage([{ type: 'text', text }], 'stop')
  stream.push({ type: 'start', partial: partialStart })
  stream.push({ type: 'text_start', contentIndex: 0, partial: partialStart })
  stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: finalMessage })
  stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: finalMessage })
  stream.push({ type: 'done', reason: 'stop', message: finalMessage })
  return stream
}

function hasToolResult(messages: Message[]): boolean {
  return messages.some((message) => message.role === 'toolResult' && message.toolName === 'render_chart')
}

function countToolResults(messages: Message[]): number {
  return messages.filter((message) => message.role === 'toolResult' && message.toolName === 'render_chart').length
}

function convertJsonSchemaToParameters(schema: ToolDefinition['inputSchema']) {
  const properties: Record<string, unknown> = {}
  for (const [key, prop] of Object.entries(schema.properties)) {
    properties[key] = { ...prop }
  }
  return {
    type: 'object' as const,
    properties,
    required: schema.required || [],
  }
}

function adaptRenderChartTool(dataProvider: ToolDataProvider): AgentTool<any, unknown> {
  return {
    name: renderChartTool.name,
    label: renderChartTool.name,
    description: renderChartTool.description,
    parameters: convertJsonSchemaToParameters(renderChartTool.inputSchema) as any,
    async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> {
      const context: ToolExecutionContext = {
        sessionId: 'offline-agent-chart-flow',
        locale: 'en-US',
        dataProvider,
      }
      const result = await renderChartTool.handler((params ?? {}) as Record<string, unknown>, context)
      return {
        content: [{ type: 'text', text: result.content }],
        details: {
          ...(typeof result.data === 'object' && result.data !== null ? result.data : {}),
          ...(result.chart ? { chart: result.chart } : {}),
        },
      }
    },
  }
}

describe('offline Agent chart flow', () => {
  it('turns a natural-language chart request into a render_chart tool result and final answer', async () => {
    const requestedSql: string[] = []
    const dataProvider: ToolDataProvider = {
      async executeParameterizedSql(sql, params) {
        requestedSql.push(sql)
        assert.match(sql, /JOIN member/i)
        assert.match(sql, /@memberA/)
        assert.deepEqual(params, { memberA: 'Alice', memberB: 'Bob', startTs: 1780272000, endTs: 1780444800 })
        return [
          { day: '2026-06-01', member_name: 'Alice', message_count: 2 },
          { day: '2026-06-01', member_name: 'Bob', message_count: 1 },
          { day: '2026-06-02', member_name: 'Alice', message_count: 2 },
          { day: '2026-06-02', member_name: 'Bob', message_count: 2 },
        ]
      },
      async getSchema() {
        return []
      },
    } as Partial<ToolDataProvider> as ToolDataProvider
    const tools = [adaptRenderChartTool(dataProvider)]
    const streamFn = (_model: Model<any>, context: Context) => {
      const userMessages = context.messages.filter((message) => message.role === 'user')
      const latestUser = userMessages[userMessages.length - 1]
      const userText = Array.isArray(latestUser?.content)
        ? latestUser.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n')
        : latestUser?.content || ''
      assert.match(userText, /Alice/)
      assert.match(userText, /Bob/)
      assert.match(userText, /line/i)

      if (!hasToolResult(context.messages)) {
        return createToolCallStream({
          type: 'toolCall',
          id: 'call_chart_1',
          name: 'render_chart',
          arguments: {
            sql: `
              SELECT date(msg.ts, 'unixepoch') AS day,
                     COALESCE(m.group_nickname, m.account_name, m.platform_id) AS member_name,
                     COUNT(*) AS message_count
              FROM message msg
              JOIN member m ON m.id = msg.sender_id
              WHERE COALESCE(m.group_nickname, m.account_name, m.platform_id) IN (@memberA, @memberB)
                AND msg.ts >= @startTs AND msg.ts < @endTs
              GROUP BY day, m.id
              ORDER BY day ASC, member_name ASC
            `,
            params: { memberA: 'Alice', memberB: 'Bob', startTs: 1780272000, endTs: 1780444800 },
            chartSpec: {
              version: 1,
              type: 'line',
              title: 'Alice vs Bob daily message trend',
              encoding: { x: 'day', y: 'message_count', series: 'member_name' },
              filters: { members: [{ name: 'Alice' }, { name: 'Bob' }] },
              unit: 'messages',
            },
          },
        })
      }

      return createTextStream('Alice stayed ahead on both days, while Bob caught up on June 2.')
    }
    const events: AgentCoreEvent[] = []

    const result = await runAgentCore({
      piModel: {
        id: 'fake-chart-model',
        provider: 'chatlab-test',
        api: 'openai-completions',
      } as Model<any>,
      apiKey: 'test-key',
      systemPrompt: 'Use render_chart for chart requests.',
      tools,
      history: [],
      userMessage: 'Please draw a line chart comparing Alice and Bob message counts by day.',
      maxToolRounds: 3,
      steerMessage: 'Please explain the chart briefly.',
      streamFn,
      onEvent: (event) => events.push(event),
    })

    assert.equal(result.error, undefined)
    assert.deepEqual(result.toolsUsed, ['render_chart'])
    assert.equal(result.toolRounds, 1)
    assert.equal(requestedSql.length, 1)

    const toolEnd = events.find((event) => event.type === 'tool_end' && event.toolName === 'render_chart')
    assert.ok(toolEnd && 'toolResult' in toolEnd, 'expected render_chart tool_end event')
    const chart = (toolEnd.toolResult as { details?: { chart?: ChartPayload } }).details?.chart
    assert.ok(chart, 'expected chart payload in render_chart tool result details')
    assert.equal(chart.spec.type, 'line')
    assert.deepEqual(chart.data, {
      labels: ['2026-06-01', '2026-06-02'],
      values: [2, 2],
      series: [
        { name: 'Alice', values: [2, 2] },
        { name: 'Bob', values: [1, 2] },
      ],
    })

    const content = events
      .filter((event) => event.type === 'content')
      .map((event) => event.content)
      .join('')
    assert.match(content, /Bob caught up/)
  })

  it('runs multiple render_chart calls when the user asks for two charts', async () => {
    const requestedSql: string[] = []
    const dataProvider: ToolDataProvider = {
      async executeParameterizedSql(sql, params) {
        requestedSql.push(sql)
        if (sql.includes('selected_member_share_source')) {
          assert.deepEqual(params, { memberA: 'Alice', memberB: 'Bob' })
          return [
            { member_name: 'Alice', message_count: 4 },
            { member_name: 'Bob', message_count: 3 },
          ]
        }
        if (sql.includes('member_hour_density_source')) {
          assert.deepEqual(params, { memberA: 'Alice', memberB: 'Bob' })
          return [
            { hour: '09', member_name: 'Alice', message_count: 2 },
            { hour: '10', member_name: 'Alice', message_count: 2 },
            { hour: '09', member_name: 'Bob', message_count: 1 },
            { hour: '10', member_name: 'Bob', message_count: 2 },
          ]
        }
        throw new Error(`unexpected SQL: ${sql}`)
      },
      async getSchema() {
        return []
      },
    } as Partial<ToolDataProvider> as ToolDataProvider
    const tools = [adaptRenderChartTool(dataProvider)]
    const streamFn = (_model: Model<any>, context: Context) => {
      const userMessages = context.messages.filter((message) => message.role === 'user')
      const latestUser = userMessages[userMessages.length - 1]
      const userText = Array.isArray(latestUser?.content)
        ? latestUser.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n')
        : latestUser?.content || ''
      assert.match(userText, /two charts/i)
      assert.match(userText, /pie/i)
      assert.match(userText, /heatmap/i)

      if (countToolResults(context.messages) < 2) {
        return createToolCallsStream([
          {
            type: 'toolCall',
            id: 'call_chart_pie',
            name: 'render_chart',
            arguments: {
              sql: `
                WITH selected_member_share_source AS (
                  SELECT @memberA AS member_name, 4 AS message_count
                  UNION ALL
                  SELECT @memberB AS member_name, 3 AS message_count
                )
                SELECT member_name, message_count
                FROM selected_member_share_source
              `,
              params: { memberA: 'Alice', memberB: 'Bob' },
              chartSpec: {
                version: 1,
                type: 'pie',
                title: 'Selected members message share',
                encoding: { label: 'member_name', value: 'message_count' },
              },
            },
          },
          {
            type: 'toolCall',
            id: 'call_chart_heatmap',
            name: 'render_chart',
            arguments: {
              sql: `
                WITH member_hour_density_source AS (
                  SELECT '09' AS hour, @memberA AS member_name, 2 AS message_count
                  UNION ALL
                  SELECT '10' AS hour, @memberA AS member_name, 2 AS message_count
                  UNION ALL
                  SELECT '09' AS hour, @memberB AS member_name, 1 AS message_count
                  UNION ALL
                  SELECT '10' AS hour, @memberB AS member_name, 2 AS message_count
                )
                SELECT hour, member_name, message_count
                FROM member_hour_density_source
              `,
              params: { memberA: 'Alice', memberB: 'Bob' },
              chartSpec: {
                version: 1,
                type: 'heatmap',
                title: 'Selected members hour density',
                encoding: { x: 'hour', y: 'member_name', value: 'message_count' },
              },
            },
          },
        ])
      }

      return createTextStream('Here are the requested pie chart and heatmap.')
    }
    const events: AgentCoreEvent[] = []

    const result = await runAgentCore({
      piModel: {
        id: 'fake-chart-model',
        provider: 'chatlab-test',
        api: 'openai-completions',
      } as Model<any>,
      apiKey: 'test-key',
      systemPrompt: 'Use render_chart for chart requests.',
      tools,
      history: [],
      userMessage: 'Please generate two charts: a pie chart for Alice and Bob, plus a heatmap by hour.',
      maxToolRounds: 3,
      steerMessage: 'Please explain both charts briefly.',
      streamFn,
      onEvent: (event) => events.push(event),
    })

    assert.equal(result.error, undefined)
    assert.deepEqual(result.toolsUsed, ['render_chart', 'render_chart'])
    assert.equal(result.toolRounds, 1)
    assert.equal(requestedSql.length, 2)

    const chartPayloads = events
      .filter((event) => event.type === 'tool_end' && event.toolName === 'render_chart')
      .map((event) => (event.toolResult as { details?: { chart?: ChartPayload } }).details?.chart)
      .filter((chart): chart is ChartPayload => !!chart)

    assert.equal(chartPayloads.length, 2)
    const chartsByType = new Map(chartPayloads.map((chart) => [chart.spec.type, chart]))
    assert.deepEqual([...chartsByType.keys()].sort(), ['heatmap', 'pie'])
    assert.deepEqual(chartsByType.get('pie')?.data, { labels: ['Alice', 'Bob'], values: [4, 3] })
    assert.deepEqual(chartsByType.get('heatmap')?.data, {
      xLabels: ['09', '10'],
      yLabels: ['Alice', 'Bob'],
      data: [
        [0, 0, 2],
        [1, 0, 2],
        [0, 1, 1],
        [1, 1, 2],
      ],
    })

    const content = events
      .filter((event) => event.type === 'content')
      .map((event) => event.content)
      .join('')
    assert.match(content, /pie chart and heatmap/)
  })
})
