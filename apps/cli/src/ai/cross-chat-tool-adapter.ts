import type {
  AgentTool,
  AIMemoryService,
  CrossChatAnalysisService,
  PreprocessConfig,
  SessionRuntimeAdapter,
} from '@openchatlab/node-runtime'
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
  preprocessConfig?: Record<string, unknown>
  maxToolResultTokens: number
  memoryService: AIMemoryService
  aiChatId: string
  allowProactiveMemory: boolean
}): AgentTool<any, any>[] {
  const context: Omit<CrossChatToolExecutionContext, 'abortSignal' | 'reportProgress'> = {
    locale: options.locale,
    analysisService: options.analysisService,
    memoryService: options.memoryService,
    aiChatId: options.aiChatId,
    allowProactiveMemory: options.allowProactiveMemory,
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
