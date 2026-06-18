/**
 * 当前对话语义检索工具
 *
 * 由 LLM 按需调用：当问题需要当前聊天历史中的具体事实/人物/地点/事件/过往提及时调用。
 * 仅检索当前会话，结果由 SemanticIndexService 经 applyPreprocessingPipeline 脱敏后返回，
 * 工具层不接触原始消息，details 不夹带 rawMessages。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { SEMANTIC_SEARCH_MAX_RESULTS_HARD_CAP } from '../types'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description:
        '语义检索查询，应改写成适合检索当前聊天历史的自然语言描述（围绕需要确认的事实/人物/地点/事件/过往提及）。',
    },
    max_results: {
      type: 'number',
      description: `期望返回的相关片段数，可选。不填使用用户配置的默认值；可按问题复杂度提高，硬上限 ${SEMANTIC_SEARCH_MAX_RESULTS_HARD_CAP}。`,
      minimum: 1,
      maximum: SEMANTIC_SEARCH_MAX_RESULTS_HARD_CAP,
    },
  },
  required: ['query'],
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const service = context.semanticIndexService
  if (!service) {
    return { content: 'Semantic search is not available for this conversation.' }
  }

  const query = typeof params.query === 'string' ? params.query.trim() : ''
  if (!query) {
    return { content: 'Please provide a non-empty query describing what to look up in this conversation history.' }
  }

  const maxResults =
    typeof params.max_results === 'number' && Number.isFinite(params.max_results)
      ? Math.max(1, Math.min(SEMANTIC_SEARCH_MAX_RESULTS_HARD_CAP, Math.floor(params.max_results)))
      : undefined

  const result = await service.searchForTool(context.sessionId, query, {
    maxResults,
    preprocessConfig: context.preprocessConfig,
    ownerPlatformId: context.ownerPlatformId,
    locale: context.locale,
    maxResultTokens: context.maxToolResultTokens,
  })

  if (!result.available) {
    return { content: `No semantic index available for this conversation (${result.reason ?? 'unavailable'}).` }
  }

  const data = {
    query,
    returned: result.returned,
    hitCount: result.hitCount,
    partial: result.partial,
    coverage: result.coverage,
    truncated: result.truncated,
    timeRange: result.timeRange,
    sources: result.sources,
  }

  if (result.returned === 0) {
    return { content: 'No relevant excerpts found in this conversation history.', data }
  }

  let content = result.text
  if (result.partial) {
    content = `Note: index is incomplete, evidence may be partial.\n\n${content}`
  }
  if (result.truncated) {
    content = `${content}\n\nReached the result limit; there may be more matching history. Use a narrower query to continue searching.`
  }

  return { content, data }
}

export const semanticSearchCurrentChatTool: ToolDefinition = {
  name: 'semantic_search_current_chat',
  description:
    'Semantically search the CURRENT conversation history for relevant excerpts. Use when the question needs concrete facts, people, places, events, or past mentions from this chat. Do NOT use for greetings, writing, or explaining general concepts.',
  inputSchema,
  handler,
  category: 'core',
  truncationStrategy: 'keep_first',
}
