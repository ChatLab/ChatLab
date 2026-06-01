/**
 * CLI Agent stream runner — provides runAgentStream implementation
 * for the shared HTTP route context.
 */

import type { DatabaseManager, AIConversationManager, AgentStreamChunk } from '@openchatlab/node-runtime'
import { SkillManager, createActivateSkillTool } from '@openchatlab/node-runtime'
import { getChatOverview } from '@openchatlab/core'
import type { DataSnapshot } from '@openchatlab/node-runtime'
import type { AgentStreamRequest } from '@openchatlab/http-routes'
import { AGENT_TOOL_REGISTRY } from '@openchatlab/tools'
import { adaptToolsForAgent } from './tool-adapter'
import { getDefaultAssistantConfig, buildPiModel } from './llm-config'
import { loadAssistantConfig } from './assistant-loader'
import { runServerAgent } from './agent'

function getAiDir(dbManager: DatabaseManager): string {
  const pathProvider = (dbManager as any)['pathProvider']
  if (!pathProvider) {
    throw Object.assign(new Error('PathProvider not available'), { statusCode: 500 })
  }
  return pathProvider.getAiDataDir()
}

export function createCliRunAgentStream(
  dbManager: DatabaseManager,
  convManager: AIConversationManager
): (params: AgentStreamRequest, onEvent: (chunk: AgentStreamChunk) => void, abortSignal: AbortSignal) => Promise<void> {
  return async (params, onEvent, abortSignal) => {
    const {
      userMessage,
      conversationId,
      historyLeafMessageId,
      sessionId,
      chatType,
      locale,
      assistantId,
      compressionConfig,
      ownerInfo,
      mentionedMembers,
      thinkingLevel,
    } = params

    const aiDataDir = getAiDir(dbManager)

    let assistantSystemPrompt: string | undefined
    if (assistantId) {
      const assistantConfig = loadAssistantConfig(aiDataDir, assistantId)
      if (assistantConfig?.systemPrompt) {
        assistantSystemPrompt = assistantConfig.systemPrompt
      }
    }

    const llmConfig = getDefaultAssistantConfig(aiDataDir)
    const maxToolResultPercent = compressionConfig?.maxToolResultPercent ?? 50
    const contextWindow = llmConfig ? (buildPiModel(llmConfig).contextWindow ?? 128000) : 128000
    const maxToolResultTokens = Math.floor(contextWindow * (maxToolResultPercent / 100))

    const db = (dbManager as any).open?.(sessionId)
    const agentTools = db
      ? adaptToolsForAgent(AGENT_TOOL_REGISTRY, () => ({ db, sessionId, locale }), { maxToolResultTokens })
      : []

    const skillManager = new SkillManager(aiDataDir)
    skillManager.init()
    const toolNames = agentTools.map((t: { name: string }) => t.name)
    const skillMenu = skillManager.getSkillMenu(chatType ?? 'group', toolNames)

    if (skillMenu) {
      const activateSkillTool = createActivateSkillTool({
        chatType: chatType ?? 'group',
        allowedTools: toolNames,
        locale,
        getSkillConfig: (id) => skillManager.getSkillConfig(id),
      })
      agentTools.push(activateSkillTool as any)
    }

    const resolvedCompression = compressionConfig?.enabled
      ? {
          enabled: true as const,
          tokenThresholdPercent: compressionConfig.tokenThresholdPercent ?? 75,
          bufferSizePercent: compressionConfig.bufferSizePercent ?? 20,
          maxToolResultPercent: compressionConfig.maxToolResultPercent,
        }
      : undefined

    let dataSnapshot: DataSnapshot | undefined
    if (db) {
      try {
        const overview = getChatOverview(db, 5)
        if (overview) {
          dataSnapshot = {
            name: overview.name,
            platform: overview.platform,
            type: overview.type,
            totalMessages: overview.totalMessages,
            totalMembers: overview.totalMembers,
            firstMessageTs: overview.firstMessageTs,
            lastMessageTs: overview.lastMessageTs,
            capturedAt: Math.floor(Date.now() / 1000),
          }
        }
      } catch {
        // non-fatal
      }
    }

    await runServerAgent({
      userMessage,
      conversationId,
      historyLeafMessageId,
      chatType,
      locale,
      assistantSystemPrompt,
      skillMenu,
      compressionConfig: resolvedCompression,
      tools: agentTools,
      aiDataDir,
      convManager,
      onEvent,
      abortSignal,
      ownerInfo,
      mentionedMembers,
      dataSnapshot,
      thinkingLevel,
    })
  }
}
