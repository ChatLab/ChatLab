/**
 * CLI Agent stream runner — provides runAgentStream implementation
 * for the shared HTTP route context.
 */

import type {
  DatabaseManager,
  AIChatManager,
  AgentStreamChunk,
  LLMConfigStore,
  SemanticIndexRuntime,
} from '@openchatlab/node-runtime'
import {
  CHART_CAPABILITY_CORE_TOOLS,
  SkillManager,
  buildPiModel,
  buildSkillMenuWithBuiltinChart,
  createLlmRuntimeStores,
  createActivateSkillTool,
  createDataSnapshotFromOverview,
  getAllowedBuiltinToolsForChartAutoSkill,
  getChartCapabilitySkill,
  getSkillConfigWithBuiltinChart,
  resolveChartRuntimeForRequest,
} from '@openchatlab/node-runtime'
import { getChatOverview, normalizeBuiltinToolNames } from '@openchatlab/core'
import type { ChartAutoMode } from '@openchatlab/shared-types'
import type { DataSnapshot } from '@openchatlab/node-runtime'
import type { AgentStreamRequest } from '@openchatlab/http-routes'
import { AGENT_TOOL_REGISTRY, SEMANTIC_SEARCH_TOOL_NAME } from '@openchatlab/tools'
import { buildSemanticSearchGuidance } from '@openchatlab/node-runtime'
import { adaptToolsForAgent } from './tool-adapter'
import { loadAssistantConfig } from './assistant-loader'
import { runServerAgent } from './agent'

function getAiDir(dbManager: DatabaseManager): string {
  const pathProvider = (dbManager as any)['pathProvider']
  if (!pathProvider) {
    throw Object.assign(new Error('PathProvider not available'), { statusCode: 500 })
  }
  return pathProvider.getAiDataDir()
}

const RAW_SQL_TOOL_NAMES = new Set(['execute_sql'])

export function getAvailableToolDefs(isChartCapability: boolean, allowedToolSet: Set<string> | null) {
  if (isChartCapability) {
    const chartCoreTools = new Set<string>(CHART_CAPABILITY_CORE_TOOLS)
    return AGENT_TOOL_REGISTRY.filter(
      (tool) =>
        chartCoreTools.has(tool.name) ||
        (tool.category === 'analysis' && allowedToolSet?.has(tool.name) && !RAW_SQL_TOOL_NAMES.has(tool.name))
    )
  }

  return allowedToolSet
    ? AGENT_TOOL_REGISTRY.filter((tool) => tool.category !== 'analysis' || allowedToolSet.has(tool.name))
    : AGENT_TOOL_REGISTRY
}

// 区分“未配置白名单”和“配置为空白名单”：前者无限制，后者禁用 analysis 工具。
export function getAllowedToolSet(
  isChartCapability: boolean,
  allowedBuiltinTools?: readonly string[]
): Set<string> | null {
  if (isChartCapability) {
    return new Set(normalizeBuiltinToolNames(allowedBuiltinTools ?? []))
  }
  return allowedBuiltinTools === undefined ? null : new Set(normalizeBuiltinToolNames(allowedBuiltinTools))
}

export function createCliRunAgentStream(
  dbManager: DatabaseManager,
  aiChatManager: AIChatManager,
  options: {
    llmConfigStore?: LLMConfigStore
    semanticIndexService?: SemanticIndexRuntime
  } = {}
): (params: AgentStreamRequest, onEvent: (chunk: AgentStreamChunk) => void, abortSignal: AbortSignal) => Promise<void> {
  const aiDataDir = getAiDir(dbManager)
  const llmConfigStore = options.llmConfigStore ?? createLlmRuntimeStores(aiDataDir).llmConfigStore
  const semanticIndexService = options.semanticIndexService

  return async (params, onEvent, abortSignal) => {
    const {
      userMessage,
      aiChatId,
      historyLeafMessageId,
      sessionId,
      chatType,
      locale,
      assistantId,
      skillId,
      enableAutoSkill,
      chartAutoMode,
      compressionConfig,
      ownerInfo,
      mentionedMembers,
      thinkingLevel,
    } = params

    let assistantSystemPrompt: string | undefined
    let assistantAllowedTools: string[] | undefined
    if (assistantId) {
      const assistantConfig = loadAssistantConfig(aiDataDir, assistantId)
      if (assistantConfig?.systemPrompt) {
        assistantSystemPrompt = assistantConfig.systemPrompt
      }
      assistantAllowedTools = assistantConfig?.allowedBuiltinTools
    }

    const llmConfig = llmConfigStore.getDefaultAssistantConfig()
    const maxToolResultPercent = compressionConfig?.maxToolResultPercent ?? 50
    const contextWindow = llmConfig ? (buildPiModel(llmConfig).contextWindow ?? 128000) : 128000
    const maxToolResultTokens = Math.floor(contextWindow * (maxToolResultPercent / 100))

    const db = (dbManager as any).open?.(sessionId)
    const resolvedChartAutoMode: ChartAutoMode = chartAutoMode ?? 'suggest'
    const chartRuntime = resolveChartRuntimeForRequest({
      skillId,
      userMessage,
      locale,
      assistantAllowedTools,
      enableAutoDetection: enableAutoSkill === true,
      chartAutoMode: resolvedChartAutoMode,
    })
    const isChartCapability = chartRuntime.isChartCapability
    const autoSkillAllowedTools =
      !skillId && enableAutoSkill && resolvedChartAutoMode !== 'explicit'
        ? getAllowedBuiltinToolsForChartAutoSkill(assistantAllowedTools)
        : assistantAllowedTools
    const allowedToolSet = getAllowedToolSet(
      isChartCapability,
      isChartCapability ? chartRuntime.allowedBuiltinTools : autoSkillAllowedTools
    )
    const availableToolDefs = getAvailableToolDefs(isChartCapability, allowedToolSet)

    // 语义检索按需暴露：仅当前会话可检索时保留工具，否则从工具集中过滤掉以减少 schema token 与无效调用。
    const canSemanticSearch = !!db && !!semanticIndexService && (await semanticIndexService.canSearch(sessionId))
    const filteredToolDefs = canSemanticSearch
      ? availableToolDefs
      : availableToolDefs.filter((tool) => tool.name !== SEMANTIC_SEARCH_TOOL_NAME)

    const agentTools = db
      ? adaptToolsForAgent(
          filteredToolDefs,
          () => ({
            db,
            sessionId,
            locale,
            semanticIndexService,
            preprocessConfig: params.preprocessConfig,
            ownerPlatformId: ownerInfo?.platformId,
            timeFilter: params.timeFilter,
            maxMessagesLimit: params.maxMessagesLimit,
          }),
          { maxToolResultTokens }
        )
      : []

    // 工具可用时向 system prompt 加简短引导，提示何时调用语义检索。
    if (canSemanticSearch) {
      assistantSystemPrompt = [assistantSystemPrompt, buildSemanticSearchGuidance(locale)].filter(Boolean).join('\n\n')
    }

    const skillMgr = new SkillManager(aiDataDir)
    skillMgr.init()
    const toolNames = agentTools.map((t: { name: string }) => t.name)

    let resolvedSkillDef: { name: string; prompt: string } | undefined
    let resolvedSkillMenu: string | undefined
    if (isChartCapability) {
      const def = chartRuntime.skillDef ?? getChartCapabilitySkill(locale ?? 'zh-CN')
      resolvedSkillDef = { name: def.name, prompt: def.prompt }
    } else if (skillId) {
      const def = skillMgr.getSkillConfig(skillId)
      if (def) resolvedSkillDef = { name: def.name, prompt: def.prompt }
    } else if (enableAutoSkill) {
      const baseMenu = skillMgr.getSkillMenu(chatType ?? 'group', toolNames)
      const menu =
        resolvedChartAutoMode === 'aggressive' ? buildSkillMenuWithBuiltinChart(baseMenu, locale, toolNames) : baseMenu
      if (menu) resolvedSkillMenu = menu
    }

    if (resolvedSkillMenu) {
      const activateSkillTool = createActivateSkillTool({
        chatType: chatType ?? 'group',
        allowedTools: toolNames,
        coreToolNames: new Set<string>(CHART_CAPABILITY_CORE_TOOLS),
        locale,
        getSkillConfig: (id) =>
          resolvedChartAutoMode === 'aggressive'
            ? getSkillConfigWithBuiltinChart(id, locale, (skillConfigId) => skillMgr.getSkillConfig(skillConfigId))
            : skillMgr.getSkillConfig(id),
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
        dataSnapshot = createDataSnapshotFromOverview(getChatOverview(db, 10))
      } catch {
        // non-fatal
      }
    }

    await runServerAgent({
      userMessage,
      aiChatId,
      historyLeafMessageId,
      chatType,
      locale,
      assistantSystemPrompt,
      skillMenu: resolvedSkillMenu,
      skillDef: resolvedSkillDef,
      compressionConfig: resolvedCompression,
      tools: agentTools,
      llmConfig,
      aiChatManager,
      onEvent,
      abortSignal,
      ownerInfo,
      mentionedMembers,
      dataSnapshot,
      thinkingLevel,
      chartAutoMode: resolvedChartAutoMode,
    })
  }
}
