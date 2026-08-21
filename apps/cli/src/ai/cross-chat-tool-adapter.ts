import type {
  AgentTool,
  CrossChatAnalysisService,
  PreprocessConfig,
  SessionRuntimeAdapter,
} from '@openchatlab/node-runtime'
import { preprocessCrossChatMessages } from '@openchatlab/node-runtime'
import {
  CROSS_CHAT_AGENT_TOOL_REGISTRY,
  executeToolForAgent,
  toAgentToolParameters,
  type CrossChatToolExecutionContext,
} from '@openchatlab/tools'

export function createCliCrossChatTools(options: {
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
    preprocessMessagesBySession: (sessionId, messages) =>
      preprocessCrossChatMessages(
        options.sessionAdapter,
        sessionId,
        messages,
        options.preprocessConfig as PreprocessConfig | undefined
      ),
  }

  return CROSS_CHAT_AGENT_TOOL_REGISTRY.map((tool) => ({
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: toAgentToolParameters(tool.inputSchema) as any,
    executionMode: tool.executionMode,
    execute: async (_toolCallId: string, params: unknown, signal, onUpdate) =>
      executeToolForAgent(tool, params, {
        ...context,
        abortSignal: signal,
        reportProgress: (progress) => onUpdate?.({ content: [], details: { progress } }),
      }),
  }))
}
