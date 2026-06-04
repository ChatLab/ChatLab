import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { CHAT_DB_SCHEMA, getChartCapabilitySkill, type ChartPayload } from '@openchatlab/core'
import {
  CoreDataProvider,
  renderChartTool,
  schemaTool,
  type ToolDataProvider,
  type ToolDefinition,
  type ToolExecutionContext,
} from '@openchatlab/tools'
import { buildPiModel } from '../../packages/node-runtime/src/ai/llm-builder'
import { runAgentCore, type AgentCoreEvent } from '../../packages/node-runtime/src/ai/agent'
import { openBetterSqliteDatabase } from '../../packages/node-runtime/src/better-sqlite3-adapter'

const shouldRunRealLlmE2E = process.env.CHATLAB_RUN_REAL_LLM_CHART_E2E === '1'

function resolveNativeBinding(): string | undefined {
  if (process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING) return process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING
  const repoNativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')
  return existsSync(repoNativeBinding) ? repoNativeBinding : undefined
}

function unixTs(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000)
}

function createTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'chatlab-real-llm-chart-e2e-'))
}

function seedChatDb(db: ReturnType<typeof openBetterSqliteDatabase>): void {
  db.exec(CHAT_DB_SCHEMA)
  db.prepare(
    `INSERT INTO meta (name, platform, type, imported_at, group_id, owner_id)
     VALUES ('Chart E2E Group', 'wechat', 'group', ?, 'g1', 'u_alice')`
  ).run(unixTs('2026-06-03T00:00:00Z'))

  const insertMember = db.prepare(
    `INSERT INTO member (platform_id, account_name, group_nickname)
     VALUES (?, ?, ?)`
  )
  insertMember.run('u_alice', 'Alice Account', 'Alice')
  insertMember.run('u_bob', 'Bob Account', 'Bob')
  insertMember.run('u_cara', 'Cara Account', 'Cara')

  const memberRows = db.prepare('SELECT id, group_nickname FROM member').all() as Array<{
    id: number
    group_nickname: string
  }>
  const memberId = new Map(memberRows.map((row) => [row.group_nickname, row.id]))
  const insertMessage = db.prepare(
    `INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, platform_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const add = (name: 'Alice' | 'Bob' | 'Cara', ts: string, type: number, content: string) => {
    const id = memberId.get(name)
    assert.ok(id, `missing member id for ${name}`)
    insertMessage.run(id, `${name} Account`, name, unixTs(ts), type, content, `${name}-${ts}`)
  }

  add('Alice', '2026-06-01T09:00:00Z', 0, 'morning hello')
  add('Alice', '2026-06-01T10:00:00Z', 0, 'standup note')
  add('Alice', '2026-06-02T09:00:00Z', 1, '[图片]')
  add('Alice', '2026-06-02T10:00:00Z', 0, 'follow up')
  add('Bob', '2026-06-01T09:00:00Z', 0, 'first reply')
  add('Bob', '2026-06-02T10:00:00Z', 0, 'second reply')
  add('Bob', '2026-06-02T11:00:00Z', 0, 'third reply')
  add('Cara', '2026-06-01T09:00:00Z', 0, 'other member')
  add('Cara', '2026-06-03T12:00:00Z', 0, 'outside selected members')
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

function adaptTool(tool: ToolDefinition, dataProvider: ToolDataProvider): AgentTool<any, unknown> {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: convertJsonSchemaToParameters(tool.inputSchema) as any,
    async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> {
      const context: ToolExecutionContext = {
        sessionId: 'real-llm-chart-flow',
        locale: 'en-US',
        dataProvider,
      }
      const result = await tool.handler((params ?? {}) as Record<string, unknown>, context)
      return {
        content: [{ type: 'text', text: result.content }],
        details: {
          ...(typeof result.data === 'object' && result.data !== null && !Array.isArray(result.data)
            ? result.data
            : {}),
          ...(result.chart ? { chart: result.chart } : {}),
        },
      }
    },
  }
}

function getChartPayloads(events: AgentCoreEvent[]): ChartPayload[] {
  return events
    .filter((event) => event.type === 'tool_end' && event.toolName === 'render_chart')
    .map((event) => (event.toolResult as { details?: { chart?: ChartPayload } }).details?.chart)
    .filter((chart): chart is ChartPayload => !!chart)
}

describe('real external LLM chart flow', () => {
  it(
    'asks a real model to generate two chart payloads from real chat data',
    { skip: !shouldRunRealLlmE2E },
    async () => {
      const apiKey = process.env.CHATLAB_REAL_LLM_API_KEY || process.env.OPENAI_API_KEY
      assert.ok(apiKey, 'Set CHATLAB_REAL_LLM_API_KEY or OPENAI_API_KEY to run the real LLM chart E2E test')

      const provider = process.env.CHATLAB_REAL_LLM_PROVIDER || 'openai'
      const model = process.env.CHATLAB_REAL_LLM_MODEL || 'gpt-4.1-mini'
      const baseUrl = process.env.CHATLAB_REAL_LLM_BASE_URL || undefined
      const piModel = buildPiModel({ provider, model, baseUrl })
      const dir = createTempDir()
      const dbPath = path.join(dir, 'chat.db')
      const nativeBinding = resolveNativeBinding()
      const db = openBetterSqliteDatabase(dbPath, { nativeBinding })

      try {
        seedChatDb(db)
        const dataProvider = new CoreDataProvider(db)
        const tools = [adaptTool(schemaTool, dataProvider), adaptTool(renderChartTool, dataProvider)]
        const events: AgentCoreEvent[] = []
        const chartPrompt = getChartCapabilitySkill('en-US').prompt

        const result = await runAgentCore({
          piModel,
          apiKey,
          systemPrompt: `${chartPrompt}

Test-specific requirements:
- Use get_schema if you need table names or columns.
- Produce exactly two render_chart calls.
- Do not make exploratory, retry, or debugging render_chart calls beyond those two charts.
- The pie chart must include only Alice and Bob and must exclude Cara.
- The heatmap must include only Alice and Bob and use hour on x, member name on y, and message count as value.
- Use the data from June 1-2, 2026 inclusive.
- The database stores Unix seconds in message.ts. Use this exact UTC range:
  - start: 1780272000
  - end: 1780444799
- Member display names in chat messages are stored as Alice, Bob, and Cara in message.sender_group_nickname.`,
          tools,
          history: [],
          userMessage:
            'Create exactly two charts from this chat data: first a pie chart comparing Alice and Bob message share, then a heatmap showing Alice and Bob message density by hour. Briefly explain both.',
          maxToolRounds: 4,
          steerMessage: 'Explain the generated charts briefly. Do not call more tools.',
          thinkingLevel: 'off',
          onEvent: (event) => events.push(event),
        })

        assert.equal(result.error, undefined)
        const charts = getChartPayloads(events)
        assert.equal(charts.length, 2, `expected exactly two chart payloads, got ${charts.length}`)

        const chartsByType = new Map(charts.map((chart) => [chart.spec.type, chart]))
        const pie = chartsByType.get('pie')
        const heatmap = chartsByType.get('heatmap')
        assert.ok(pie, 'expected a pie chart payload')
        assert.ok(heatmap, 'expected a heatmap chart payload')
        assert.deepEqual(new Set(pie.data.labels), new Set(['Alice', 'Bob']))
        assert.equal(
          pie.data.values.reduce((sum, value) => sum + value, 0),
          7
        )
        assert.ok(!heatmap.data.yLabels.includes('Cara'), 'heatmap should exclude Cara')
        assert.ok(heatmap.data.yLabels.includes('Alice'), 'heatmap should include Alice')
        assert.ok(heatmap.data.yLabels.includes('Bob'), 'heatmap should include Bob')
        const heatmapHours = new Set(heatmap.data.xLabels.map((label) => Number(label)))
        assert.ok(heatmapHours.has(9), 'heatmap should include hour 9')
        assert.ok(heatmap.data.data.length > 0, 'heatmap should include density cells')

        const finalContent = events
          .filter((event) => event.type === 'content')
          .map((event) => event.content)
          .join('')
        assert.match(finalContent, /Alice|Bob|pie|heatmap/i)
      } finally {
        db.close()
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      }
    }
  )
})
