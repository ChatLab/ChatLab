/**
 * 工具适配层
 *
 * 将 @openchatlab/tools 的 ToolDefinition 适配为 @earendil-works/pi-agent-core 的 AgentTool 格式。
 * 消息类工具返回 rawMessages 时自动执行预处理管道（清洗、去噪、脱敏、截断、格式化）。
 */

import type { ToolDefinition, ToolExecutionContext } from '@openchatlab/tools'
import { CoreDataProvider } from '@openchatlab/tools'
import type { DatabaseAdapter } from '@openchatlab/core'
import {
  applyPreprocessingPipeline,
  batchSegmentWithFrequency,
  type AgentTool,
  type AgentToolResult,
  type PreprocessableMessage,
  type TruncationStrategy,
  createChartSchemaGateState,
  wrapWithChartSchemaGate,
} from '@openchatlab/node-runtime'
import { getServerAiLogger } from './logger'

const DEFAULT_MAX_TOOL_RESULT_TOKENS = 8000

const TOOL_TRUNCATION_STRATEGY: Record<string, TruncationStrategy> = {
  search_messages: 'keep_first',
  deep_search_messages: 'keep_first',
  get_recent_messages: 'keep_last',
  get_message_context: 'keep_last',
  get_segment_messages: 'keep_last',
  get_conversation_between: 'keep_last',
}

export interface ServerToolContext {
  db: DatabaseAdapter
  sessionId: string
  locale?: string
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

export interface AdaptToolsOptions {
  maxToolResultTokens?: number
}

export function adaptToolsForAgent(
  tools: ToolDefinition[],
  getContext: () => ServerToolContext,
  options?: AdaptToolsOptions
): AgentTool<any, any>[] {
  const tokenBudget = options?.maxToolResultTokens ?? DEFAULT_MAX_TOOL_RESULT_TOKENS
  const chartSchemaGateState = createChartSchemaGateState()

  return tools.map((tool) =>
    wrapWithChartSchemaGate(
      {
        name: tool.name,
        label: tool.name,
        description: tool.description,
        parameters: convertJsonSchemaToParameters(tool.inputSchema) as any,
        async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> {
          const toolParams = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
          const ctx = getContext()
          const execCtx: ToolExecutionContext = {
            db: ctx.db,
            dataProvider: new CoreDataProvider(ctx.db),
            sessionId: ctx.sessionId,
            locale: ctx.locale,
            segmentText: (texts, locale, options) => batchSegmentWithFrequency(texts, locale as any, options as any),
          }
          try {
            const result = await tool.handler(toolParams, execCtx)
            const chartDetails =
              result.chart || result.charts
                ? {
                    ...(result.chart ? { chart: result.chart } : {}),
                    ...(result.charts ? { charts: result.charts } : {}),
                  }
                : {}

            if (result.rawMessages && result.rawMessages.length > 0) {
              const pipelineResult = applyPreprocessingPipeline({
                rawMessages: result.rawMessages as PreprocessableMessage[],
                locale: ctx.locale,
                maxToolResultTokens: tokenBudget,
                truncationStrategy: TOOL_TRUNCATION_STRATEGY[tool.name] ?? 'keep_last',
                extraDetails: (result.data ?? {}) as Record<string, unknown>,
                logger: getServerAiLogger() ?? undefined,
              })
              return {
                content: [{ type: 'text', text: pipelineResult.text }],
                details: Object.keys(chartDetails).length > 0 ? chartDetails : null,
              }
            }

            const baseDetails =
              typeof result.data === 'object' && result.data !== null
                ? (result.data as Record<string, unknown>)
                : result.data === undefined
                  ? null
                  : { value: result.data }

            return {
              content: [{ type: 'text', text: result.content }],
              details: Object.keys(chartDetails).length > 0 ? { ...(baseDetails ?? {}), ...chartDetails } : baseDetails,
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            return { content: [{ type: 'text', text: `Error: ${msg}` }], details: null }
          }
        },
      },
      chartSchemaGateState
    )
  )
}
