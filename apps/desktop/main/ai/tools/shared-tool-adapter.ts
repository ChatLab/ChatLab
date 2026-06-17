/**
 * 共享工具适配器
 *
 * 将 @openchatlab/tools 的 ToolDefinition 转换为 Electron 的 ToolRegistryEntry。
 * Electron 端使用 WorkerDataProvider 替代 Server 端的 CoreDataProvider。
 */

import type { ToolDefinition, ToolExecutionContext } from '@openchatlab/tools'
import type { AgentTool, AgentToolResult } from '@openchatlab/node-runtime'
import { batchSegmentWithFrequency } from '@openchatlab/node-runtime'
import type { ToolContext, ToolRegistryEntry, ToolCategory } from './types'
import { WorkerDataProvider } from './worker-data-provider'
import { t as i18nT } from '../../i18n'

interface AdaptOptions {
  category: ToolCategory
  truncationStrategy?: 'keep_first' | 'keep_last'
}

function buildExecutionContext(ctx: ToolContext): ToolExecutionContext {
  return {
    dataProvider: new WorkerDataProvider(ctx.sessionId, ctx.abortSignal),
    sessionId: ctx.sessionId,
    locale: ctx.locale,
    timeFilter: ctx.timeFilter,
    abortSignal: ctx.abortSignal,
    searchContextBefore: ctx.searchContextBefore,
    searchContextAfter: ctx.searchContextAfter,
    maxMessagesLimit: ctx.maxMessagesLimit,
    maxToolResultTokens: ctx.maxToolResultTokens,
    semanticIndexService: ctx.semanticIndexService,
    preprocessConfig: ctx.preprocessConfig as Record<string, unknown> | undefined,
    ownerPlatformId: ctx.ownerInfo?.platformId,
    segmentText: (texts, locale, options) => batchSegmentWithFrequency(texts, locale as any, options as any),
    translateTemplate: (key: string) => {
      const translated = i18nT(key)
      return translated !== key ? translated : undefined
    },
  }
}

export function adaptSharedTool(tool: ToolDefinition, options: AdaptOptions): ToolRegistryEntry {
  return {
    name: tool.name,
    category: options.category,
    truncationStrategy: options.truncationStrategy ?? tool.truncationStrategy,
    factory(context: ToolContext): AgentTool<any> {
      const schema = {
        type: 'object' as const,
        properties: { ...tool.inputSchema.properties },
        required: tool.inputSchema.required ?? [],
      }

      return {
        name: tool.name,
        label: tool.name,
        // 保留英文原始描述作为 fallback：translateTool 会在 i18n key 命中时覆盖为译文，
        // 缺 key 时回退到此英文描述，避免把裸 i18n key 当作工具描述传给 LLM。
        description: tool.description,
        parameters: schema as any,
        async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> {
          const toolParams = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
          const execCtx = buildExecutionContext(context)
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
              const baseData = (typeof result.data === 'object' && result.data !== null ? result.data : {}) as Record<
                string,
                unknown
              >
              return {
                content: [{ type: 'text', text: result.content }],
                details: { ...baseData, ...chartDetails, rawMessages: result.rawMessages },
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
      }
    },
  }
}
