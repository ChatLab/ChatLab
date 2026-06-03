/**
 * CLI Agent stream runner — provides runAgentStream implementation
 * for the shared HTTP route context.
 */

import type { DatabaseManager, AIConversationManager, AgentStreamChunk } from '@openchatlab/node-runtime'
import { SkillManager, createActivateSkillTool } from '@openchatlab/node-runtime'
import {
  CHART_CAPABILITY_SKILL_ID,
  getChartCapabilityAllowedBuiltinTools,
  getChartCapabilitySkill,
  getChatOverview,
} from '@openchatlab/core'
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
      skillId,
      enableAutoSkill,
      compressionConfig,
      ownerInfo,
      mentionedMembers,
      thinkingLevel,
    } = params

    const aiDataDir = getAiDir(dbManager)

    let assistantSystemPrompt: string | undefined
    let assistantAllowedTools: string[] | undefined
    if (assistantId) {
      const assistantConfig = loadAssistantConfig(aiDataDir, assistantId)
      if (assistantConfig?.systemPrompt) {
        assistantSystemPrompt = assistantConfig.systemPrompt
      }
      assistantAllowedTools = assistantConfig?.allowedBuiltinTools
    }

    const llmConfig = getDefaultAssistantConfig(aiDataDir)
    const maxToolResultPercent = compressionConfig?.maxToolResultPercent ?? 50
    const contextWindow = llmConfig ? (buildPiModel(llmConfig).contextWindow ?? 128000) : 128000
    const maxToolResultTokens = Math.floor(contextWindow * (maxToolResultPercent / 100))

    const db = (dbManager as any).open?.(sessionId)
    const isChartCapability = skillId === CHART_CAPABILITY_SKILL_ID
    const allowedToolSet = isChartCapability
      ? new Set(getChartCapabilityAllowedBuiltinTools(assistantAllowedTools))
      : assistantAllowedTools && assistantAllowedTools.length > 0
        ? new Set(assistantAllowedTools)
        : null
    const availableToolDefs = allowedToolSet
      ? AGENT_TOOL_REGISTRY.filter((tool) => tool.category !== 'analysis' || allowedToolSet.has(tool.name))
      : AGENT_TOOL_REGISTRY

    const agentTools = db
      ? adaptToolsForAgent(availableToolDefs, () => ({ db, sessionId, locale }), { maxToolResultTokens })
      : []

    const skillMgr = new SkillManager(aiDataDir)
    skillMgr.init()
    const toolNames = agentTools.map((t: { name: string }) => t.name)

    let resolvedSkillDef: { name: string; prompt: string } | undefined
    let resolvedSkillMenu: string | undefined
    if (isChartCapability) {
      const def = getChartCapabilitySkill(locale ?? 'zh-CN')
      resolvedSkillDef = { name: def.name, prompt: def.prompt }
    } else if (skillId) {
      const def = skillMgr.getSkillConfig(skillId)
      if (def) resolvedSkillDef = { name: def.name, prompt: def.prompt }
    } else if (enableAutoSkill) {
      const menu = skillMgr.getSkillMenu(chatType ?? 'group', toolNames)
      if (menu) resolvedSkillMenu = menu
    }

    if (resolvedSkillMenu) {
      const activateSkillTool = createActivateSkillTool({
        chatType: chatType ?? 'group',
        allowedTools: toolNames,
        locale,
        getSkillConfig: (id) => skillMgr.getSkillConfig(id),
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
      skillMenu: resolvedSkillMenu,
      skillDef: resolvedSkillDef,
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
