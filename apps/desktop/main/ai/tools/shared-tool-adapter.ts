/**
 * 共享工具适配器
 *
 * 将 @openchatlab/tools 的 ToolDefinition 转换为 Electron 的 ToolRegistryEntry。
 * Electron 端使用 WorkerDataProvider 替代 Server 端的 CoreDataProvider。
 */

import {
  executeToolForAgent,
  toAgentToolParameters,
  type ToolDefinition,
  type ToolExecutionContext,
  type RawMessage,
} from '@openchatlab/tools'
import type { AgentTool, PreprocessableMessage, PreprocessConfig } from '@openchatlab/node-runtime'
import { batchSegmentWithFrequency, preprocessMessages } from '@openchatlab/node-runtime'
import type { ToolContext, ToolRegistryEntry } from './types'
import { WorkerDataProvider } from './worker-data-provider'
import { t as i18nT } from '../../i18n'

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
    desensitizeMessages: (messages: RawMessage[]): RawMessage[] =>
      preprocessMessages(
        messages as PreprocessableMessage[],
        ctx.preprocessConfig as PreprocessConfig | undefined
      ) as RawMessage[],
  }
}

export function adaptSharedTool(tool: ToolDefinition): ToolRegistryEntry {
  return {
    name: tool.name,
    category: tool.category ?? 'core',
    truncationStrategy: tool.truncationStrategy,
    factory(context: ToolContext): AgentTool<any> {
      return {
        name: tool.name,
        label: tool.name,
        // 保留英文原始描述作为 fallback：translateTool 会在 i18n key 命中时覆盖为译文，
        // 缺 key 时回退到此英文描述，避免把裸 i18n key 当作工具描述传给 LLM。
        description: tool.description,
        parameters: toAgentToolParameters(tool.inputSchema) as any,
        async execute(_toolCallId: string, params: unknown) {
          return executeToolForAgent(tool, params, buildExecutionContext(context))
        },
      }
    },
  }
}
