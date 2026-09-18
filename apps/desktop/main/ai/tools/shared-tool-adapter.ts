/**
 * 共享工具适配器
 *
 * 将 @openchatlab/tools 的 ToolDefinition 转换为 Electron 的 ToolRegistryEntry。
 * Electron 端使用 WorkerDataProvider 替代 Server 端的 CoreDataProvider。
 */

import {
  executeToolForAgent,
  getLocalizedToolMetadata,
  toAgentToolParameters,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolProgress,
  type RawMessage,
} from '@openchatlab/tools'
import type { AgentTool, PreprocessableMessage, PreprocessConfig } from '@openchatlab/node-runtime'
import { batchSegmentWithFrequency, preprocessMessages } from '@openchatlab/node-runtime'
import type { ToolContext, ToolRegistryEntry } from './types'
import { WorkerDataProvider } from './worker-data-provider'
import { t as i18nT } from '../../i18n'

function buildExecutionContext(
  ctx: ToolContext,
  signal?: AbortSignal,
  reportProgress?: (progress: ToolProgress) => void
): ToolExecutionContext {
  const abortSignal = signal ?? ctx.abortSignal
  return {
    dataProvider: new WorkerDataProvider(ctx.sessionId, abortSignal),
    sessionId: ctx.sessionId,
    locale: ctx.locale,
    timeFilter: ctx.timeFilter,
    abortSignal,
    reportProgress,
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
      // Tool and parameter descriptions follow the chat locale: Chinese locales keep the definition text,
      // every other locale gets the English metadata table.
      const localized = getLocalizedToolMetadata(tool, context.locale)
      return {
        name: tool.name,
        label: tool.name,
        description: localized.description,
        parameters: toAgentToolParameters(localized.inputSchema) as any,
        executionMode: tool.executionMode,
        async execute(_toolCallId: string, params: unknown, signal, onUpdate) {
          return executeToolForAgent(
            tool,
            params,
            buildExecutionContext(context, signal, (progress) => onUpdate?.({ content: [], details: { progress } }))
          )
        },
      }
    },
  }
}
