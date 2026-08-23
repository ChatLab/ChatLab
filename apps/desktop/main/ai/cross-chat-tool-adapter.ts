import type {
  AgentTool,
  CrossChatAnalysisService,
  PreprocessConfig,
  SessionRuntimeAdapter,
} from '@openchatlab/node-runtime'
import { countTokens, preprocessCrossChatMessages } from '@openchatlab/node-runtime'
import { createCrossChatAgentToolAdapters, type CrossChatToolExecutionContext } from '@openchatlab/tools'

export function createElectronCrossChatTools(options: {
  analysisService: CrossChatAnalysisService
  sessionAdapter: SessionRuntimeAdapter
  locale?: string
  preprocessConfig?: Record<string, unknown>
  maxToolResultTokens: number
}): AgentTool<any, any>[] {
  const context: Omit<CrossChatToolExecutionContext, 'abortSignal' | 'reportProgress'> = {
    locale: options.locale,
    analysisService: options.analysisService,
    maxToolResultTokens: options.maxToolResultTokens,
    countTokens,
    preprocessMessagesBySession: (sessionId, messages) =>
      preprocessCrossChatMessages(
        options.sessionAdapter,
        sessionId,
        messages,
        options.preprocessConfig as PreprocessConfig | undefined
      ),
  }

  return createCrossChatAgentToolAdapters(context) as AgentTool<any, any>[]
}
