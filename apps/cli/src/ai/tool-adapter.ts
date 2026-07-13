/**
 * 工具适配层
 *
 * 将 @openchatlab/tools 的 ToolDefinition 适配为 @earendil-works/pi-agent-core 的 AgentTool 格式。
 * 消息类工具返回 rawMessages 时自动执行预处理管道（清洗、去噪、脱敏、截断、格式化）。
 */

import type {
  ToolDefinition,
  ToolExecutionContext,
  SemanticSearchToolService,
  RawMessage,
  ToolTimeRange,
} from '@openchatlab/tools'
import { CoreDataProvider, executeToolForAgent, toAgentToolParameters } from '@openchatlab/tools'
import type { DatabaseAdapter } from '@openchatlab/core'
import {
  applyPreprocessingPipeline,
  batchSegmentWithFrequency,
  preprocessMessages,
  type AgentTool,
  type PreprocessableMessage,
  type PreprocessConfig,
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
  /** 语义检索窄接口（仅当前会话可检索时由 runner 注入） */
  semanticIndexService?: SemanticSearchToolService
  /** 预处理配置（脱敏/匿名化/清洗） */
  preprocessConfig?: Record<string, unknown>
  /** 当前用户平台 id（昵称匿名化 owner 识别） */
  ownerPlatformId?: string
  /** 会话时间范围筛选（来自请求参数，供证据类工具继承） */
  timeFilter?: ToolTimeRange
  /** 关键词搜索消息条数上限 */
  maxMessagesLimit?: number
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
        parameters: toAgentToolParameters(tool.inputSchema) as any,
        async execute(_toolCallId: string, params: unknown) {
          const ctx = getContext()
          const execCtx: ToolExecutionContext = {
            db: ctx.db,
            dataProvider: new CoreDataProvider(ctx.db),
            sessionId: ctx.sessionId,
            locale: ctx.locale,
            semanticIndexService: ctx.semanticIndexService,
            preprocessConfig: ctx.preprocessConfig,
            ownerPlatformId: ctx.ownerPlatformId,
            timeFilter: ctx.timeFilter,
            maxMessagesLimit: ctx.maxMessagesLimit,
            maxToolResultTokens: tokenBudget,
            segmentText: (texts, locale, options) => batchSegmentWithFrequency(texts, locale as any, options as any),
            desensitizeMessages: (messages: RawMessage[]): RawMessage[] =>
              preprocessMessages(
                messages as PreprocessableMessage[],
                ctx.preprocessConfig as PreprocessConfig | undefined
              ) as RawMessage[],
          }
          const result = await executeToolForAgent(tool, params, execCtx)
          const details = result.details as Record<string, unknown> | null
          if (!Array.isArray(details?.rawMessages)) return result

          const { rawMessages, chart, charts, ...extraDetails } = details
          const preprocessCfg = ctx.preprocessConfig as PreprocessConfig | undefined
          const pipelineResult = applyPreprocessingPipeline({
            rawMessages: rawMessages as PreprocessableMessage[],
            preprocessConfig: preprocessCfg,
            anonymizeNames: preprocessCfg?.anonymizeNames ?? false,
            ownerPlatformId: ctx.ownerPlatformId,
            locale: ctx.locale,
            maxToolResultTokens: tokenBudget,
            truncationStrategy: TOOL_TRUNCATION_STRATEGY[tool.name] ?? 'keep_last',
            extraDetails,
            logger: getServerAiLogger() ?? undefined,
          })
          const chartDetails = { ...(chart ? { chart } : {}), ...(charts ? { charts } : {}) }
          return {
            content: [{ type: 'text', text: pipelineResult.text }],
            details: Object.keys(chartDetails).length > 0 ? chartDetails : null,
          }
        },
      },
      chartSchemaGateState
    )
  )
}
