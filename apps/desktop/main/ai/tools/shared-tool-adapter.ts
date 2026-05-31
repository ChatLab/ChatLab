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

interface ChartContentBlock {
  type: 'chart'
  chartType: string
  title: string
  data: Record<string, unknown>
}

interface AdaptOptions {
  category: ToolCategory
  truncationStrategy?: 'keep_first' | 'keep_last'
}

function buildExecutionContext(ctx: ToolContext): ToolExecutionContext {
  return {
    dataProvider: new WorkerDataProvider(ctx.sessionId),
    sessionId: ctx.sessionId,
    locale: ctx.locale,
    timeFilter: ctx.timeFilter,
    searchContextBefore: ctx.searchContextBefore,
    searchContextAfter: ctx.searchContextAfter,
    maxMessagesLimit: ctx.maxMessagesLimit,
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
        description: `ai.tools.${tool.name}.desc`,
        parameters: schema as any,
        async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> {
          const toolParams = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
          const execCtx = buildExecutionContext(context)
          try {
            const result = await tool.handler(toolParams, execCtx)

            const baseData = (typeof result.data === 'object' && result.data !== null ? result.data : {}) as Record<
              string,
              unknown
            >
            const details: Record<string, unknown> = { ...baseData }
            if (result.rawMessages && result.rawMessages.length > 0) {
              details.rawMessages = result.rawMessages
            }
            if (result.chartHint) {
              details.chartHint = result.chartHint
            }

            const content: Array<{ type: 'text'; text: string } | ChartContentBlock> = [
              { type: 'text', text: result.content },
            ]
            if (result.chartHint) {
              content.push({
                type: 'chart',
                chartType: result.chartHint.type,
                title: result.chartHint.title,
                data: result.chartHint.data,
              })
            }

            return {
              content: content as AgentToolResult<unknown>['content'],
              details: Object.keys(details).length > 0 ? details : null,
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
