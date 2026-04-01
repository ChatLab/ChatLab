import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import { executeSemanticPipeline, isEmbeddingEnabled } from '../../rag'
import { getDbPath } from '../../../database/core'
import { parseExtendedTimeParams } from '../utils/time-params'
import { formatTimeRange, isChineseLocale } from '../utils/format'
import { timeParamPropertiesNoHour } from '../utils/schemas'

const schema = Type.Object({
  query: Type.String({ description: 'ai.tools.semantic_search_messages.params.query' }),
  top_k: Type.Optional(Type.Number({ description: 'ai.tools.semantic_search_messages.params.top_k' })),
  candidate_limit: Type.Optional(
    Type.Number({ description: 'ai.tools.semantic_search_messages.params.candidate_limit' })
  ),
  ...timeParamPropertiesNoHour,
})

/** 使用 Embedding 向量相似度搜索历史对话，理解语义而非关键词匹配。⚠️ 使用场景（优先使用 search_messages 关键词搜索，以下场景再考虑本工具）：1. 找"类似的话"或"类似的表达"：如"有没有说过类似'我想你了'这样的话" 2. 关键词搜索结果不足：当 search_messages 返回结果太少或不相关时，可用本工具补充 3. 模糊的情感/关系分析：如"对方对我的态度是怎样的"、"我们之间的氛围"。❌ 不适合的场景（请用 search_messages）：有明确关键词的搜索（如"旅游"、"生日"、"加班"）、查找特定人物的发言、查找特定时间段的消息 */
export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'semantic_search_messages',
    label: 'semantic_search_messages',
    description: 'ai.tools.semantic_search_messages.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, timeFilter: contextTimeFilter, locale } = context

      let data: Record<string, unknown>
      if (!isEmbeddingEnabled()) {
        data = {
          error: isChineseLocale(locale)
            ? '语义搜索未启用。请在设置中添加并启用 Embedding 配置。'
            : 'Semantic search is not enabled. Please add and enable an Embedding config in settings.',
        }
      } else {
        const effectiveTimeFilter = parseExtendedTimeParams(params, contextTimeFilter)
        const dbPath = getDbPath(sessionId)

        const result = await executeSemanticPipeline({
          userMessage: params.query,
          dbPath,
          timeFilter: effectiveTimeFilter,
          candidateLimit: params.candidate_limit,
          topK: params.top_k,
        })

        if (!result.success) {
          data = {
            error: result.error || (isChineseLocale(locale) ? '语义搜索失败' : 'Semantic search failed'),
          }
        } else if (result.results.length === 0) {
          data = {
            message: isChineseLocale(locale) ? '未找到相关的历史对话' : 'No relevant conversations found',
            rewrittenQuery: result.rewrittenQuery,
          }
        } else {
          data = {
            total: result.results.length,
            rewrittenQuery: result.rewrittenQuery,
            timeRange: formatTimeRange(effectiveTimeFilter, locale),
            results: result.results.map((r, i) => ({
              rank: i + 1,
              score: `${(r.score * 100).toFixed(1)}%`,
              sessionId: r.metadata?.sessionId,
              timeRange: r.metadata
                ? formatTimeRange({ startTs: r.metadata.startTs, endTs: r.metadata.endTs }, locale)
                : undefined,
              participants: r.metadata?.participants,
              content: r.content.length > 500 ? r.content.slice(0, 500) + '...' : r.content,
            })),
          }
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
