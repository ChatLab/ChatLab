import type {
  AgentTool,
  AIMemoryService,
  CrossChatAnalysisService,
  PreprocessConfig,
  SessionRuntimeAdapter,
} from '@openchatlab/node-runtime'
import type { AIEntityRef } from '@openchatlab/shared-types'
import {
  countTokens,
  preprocessCrossChatLabel,
  preprocessCrossChatMessages,
  preprocessCrossChatSummaries,
} from '@openchatlab/node-runtime'
import { createCrossChatAgentToolAdapters, type CrossChatToolExecutionContext } from '@openchatlab/tools'

export function createCliCrossChatTools(options: {
  analysisService: CrossChatAnalysisService
  sessionAdapter: SessionRuntimeAdapter
  locale?: string
  entityRefs?: AIEntityRef[]
  preprocessConfig?: Record<string, unknown>
  maxToolResultTokens: number
  memoryService: AIMemoryService
  aiChatId: string
  reportMemoryChange?: (memoryId: string) => void
}): AgentTool<any, any>[] {
  const context: Omit<CrossChatToolExecutionContext, 'abortSignal' | 'reportProgress'> = {
    locale: options.locale,
    entityRefs: options.entityRefs,
    analysisService: options.analysisService,
    memoryService: options.memoryService,
    aiChatId: options.aiChatId,
    reportMemoryChange: options.reportMemoryChange,
    maxToolResultTokens: options.maxToolResultTokens,
    countTokens,
    preprocessMessagesBySession: (sessionId, messages) =>
      preprocessCrossChatMessages(
        options.sessionAdapter,
        sessionId,
        messages,
        options.preprocessConfig as PreprocessConfig | undefined
      ),
    preprocessSummariesBySession: (sessionId, summaries) =>
      preprocessCrossChatSummaries(
        options.sessionAdapter,
        sessionId,
        summaries,
        options.preprocessConfig as PreprocessConfig | undefined
      ),
    preprocessModelLabel: (value, pseudonym) =>
      preprocessCrossChatLabel(value, pseudonym, options.preprocessConfig as PreprocessConfig | undefined),
  }

  return createCrossChatAgentToolAdapters(context) as AgentTool<any, any>[]
}
