/**
 * Electron Agent stream runner — provides runAgentStream implementation
 * for the shared HTTP route context.
 *
 * Mirrors the logic from ipc/ai.ts `agent:runStream` handler,
 * but outputs events via callback instead of IPC.
 */

import type { AgentStreamChunk as SharedAgentStreamChunk, SemanticIndexRuntime } from '@openchatlab/node-runtime'
import type { AgentStreamRequest } from '@openchatlab/http-routes'
import { getDefaultGeneralAssistantId, type ChartAutoMode } from '@openchatlab/shared-types'
import {
  buildSkillMenuWithBuiltinChart,
  CHART_CAPABILITY_ANALYSIS_TOOLS,
  checkAndCompress,
  createCompressionLlmAdapter,
  createDataSnapshotFromOverview,
  formatAIError,
  getAllowedBuiltinToolsForChartAutoSkill,
  getChartCapabilitySkill,
  initTokenizer,
  resolveChartRuntimeForRequest,
  buildSemanticSearchGuidance,
} from '@openchatlab/node-runtime'
import type { CompressionConfig, CompressionLlmAdapter, AgentRuntimeStatus } from '@openchatlab/node-runtime'
import { Agent, type AgentStreamChunk, type SkillContext } from './agent'
import type { ToolContext } from './tools/types'
import { getDefaultAssistantConfig, buildPiModel, findModelDefinition } from './llm'
import type { AIServiceConfig } from './llm/types'
import * as assistantManager from './assistant'
import type { AssistantConfig } from '@openchatlab/node-runtime'
import * as skillManager from './skills'
import { aiLogger } from './logger'
import { serializeError } from './serialize-error'
import { getManager as getAIChatManager } from './chats'
import { t } from '../i18n'
import * as workerManager from '../worker/workerManager'
import { getProviderInfo, type LLMProvider } from './llm'

const DEFAULT_CONTEXT_WINDOW = 128000

function resolveProviderName(provider?: LLMProvider): string {
  if (provider === 'openai-compatible') return t('llm.genericProviderName')
  return provider ? getProviderInfo(provider)?.name || provider : t('llm.genericProviderName')
}

function buildCompressionAdapter(activeAIConfig: AIServiceConfig, onCompressing?: () => void): CompressionLlmAdapter {
  const modelDef = findModelDefinition(activeAIConfig.provider, activeAIConfig.model || '')
  return createCompressionLlmAdapter({
    piModel: buildPiModel(activeAIConfig),
    apiKey: activeAIConfig.apiKey,
    contextWindow: modelDef?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    onCompressing,
    onError: (error) => aiLogger.warn('Compression', 'LLM compression attempt failed', { error: String(error) }),
  })
}

const compressionLogger = {
  info: (cat: string, msg: string, extra?: Record<string, unknown>) => aiLogger.info(cat, msg, extra),
  warn: (cat: string, msg: string, extra?: Record<string, unknown>) => aiLogger.warn(cat, msg, extra),
  error: (cat: string, msg: string, extra?: Record<string, unknown>) => aiLogger.error(cat, msg, extra),
}

export function createElectronRunAgentStream(
  semanticIndexService?: SemanticIndexRuntime
): (
  params: AgentStreamRequest,
  onEvent: (chunk: SharedAgentStreamChunk) => void,
  abortSignal: AbortSignal
) => Promise<void> {
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

    // 确保 tokenizer rank 表已加载（compression + agent 路径均依赖）
    await initTokenizer()

    const requestId = `internal_${Date.now()}`

    aiLogger.info('AgentStream', `Agent stream request: ${requestId}`, {
      userMessage: userMessage.slice(0, 100),
      sessionId,
      aiChatId,
      chatType: chatType ?? 'group',
      assistantId: assistantId ?? '(none)',
      skillId: skillId ?? '(none)',
      enableAutoSkill: enableAutoSkill ?? false,
    })

    const activeAIConfig = getDefaultAssistantConfig()
    if (!activeAIConfig) {
      onEvent({ type: 'error', error: { name: 'ConfigError', message: t('llm.notConfigured') } })
      return
    }
    const piModel = buildPiModel(activeAIConfig)

    if (compressionConfig?.enabled && aiChatId && historyLeafMessageId === undefined) {
      try {
        const tempAssistantConfig = assistantId
          ? (assistantManager.getAssistantConfig(assistantId) ?? undefined)
          : undefined
        const systemPromptForCompression = tempAssistantConfig?.systemPrompt || ''

        const compressionResult = await checkAndCompress(
          aiChatId,
          compressionConfig as CompressionConfig,
          systemPromptForCompression,
          buildCompressionAdapter(activeAIConfig, () => {
            onEvent({
              type: 'status',
              status: {
                phase: 'compressing',
                round: 0,
                toolsUsed: 0,
                contextTokens: 0,
                totalUsage: {
                  promptTokens: 0,
                  completionTokens: 0,
                  totalTokens: 0,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                },
                updatedAt: Date.now(),
              } satisfies AgentRuntimeStatus,
            })
          }),
          getAIChatManager(),
          compressionLogger
        )

        if (compressionResult.compressed && compressionResult.summaryContent) {
          onEvent({
            type: 'compression_done',
            compressionResult: {
              summaryContent: compressionResult.summaryContent,
              tokensBefore: compressionResult.tokensBefore ?? 0,
              tokensAfter: compressionResult.tokensAfter ?? 0,
              timestamp: Date.now(),
            },
          })
        }
      } catch (error) {
        aiLogger.error('AgentStream', `Compression failed: ${requestId}`, { error: String(error) })
      }
    }

    const defaultAssistantId = getDefaultGeneralAssistantId(locale)
    let resolvedAssistantId = assistantId || defaultAssistantId
    let assistantConfig: AssistantConfig | undefined =
      assistantManager.getAssistantConfig(resolvedAssistantId) ?? undefined
    if (!assistantConfig && resolvedAssistantId !== defaultAssistantId) {
      resolvedAssistantId = defaultAssistantId
      assistantConfig = assistantManager.getAssistantConfig(defaultAssistantId) ?? undefined
    }

    let skillCtx: SkillContext | undefined
    const resolvedChartAutoMode: ChartAutoMode = chartAutoMode ?? 'suggest'
    const chartRuntime = resolveChartRuntimeForRequest({
      skillId,
      userMessage,
      locale,
      assistantAllowedTools: assistantConfig?.allowedBuiltinTools,
      enableAutoDetection: enableAutoSkill === true,
      chartAutoMode: resolvedChartAutoMode,
    })
    if (chartRuntime.isChartCapability) {
      const chartSkill = chartRuntime.skillDef ?? getChartCapabilitySkill(locale ?? 'zh-CN')
      skillCtx = { skillDef: { ...chartSkill, chatScope: 'all' } as SkillContext['skillDef'] }
      assistantConfig = {
        ...(assistantConfig ?? {
          id: resolvedAssistantId,
          name: resolvedAssistantId,
          systemPrompt: '',
          presetQuestions: [],
        }),
        allowedBuiltinTools: chartRuntime.allowedBuiltinTools,
      }
    } else if (skillId) {
      const skillDef = skillManager.getSkillConfig(skillId) ?? undefined
      if (skillDef) {
        skillCtx = { skillDef }
      }
    } else if (enableAutoSkill) {
      const effectiveChatType = chatType ?? 'group'
      const autoSkillAllowedTools =
        resolvedChartAutoMode === 'explicit'
          ? (assistantConfig?.allowedBuiltinTools ?? [...CHART_CAPABILITY_ANALYSIS_TOOLS])
          : (getAllowedBuiltinToolsForChartAutoSkill(assistantConfig?.allowedBuiltinTools) ?? [
              ...CHART_CAPABILITY_ANALYSIS_TOOLS,
            ])
      assistantConfig = {
        ...(assistantConfig ?? {
          id: resolvedAssistantId,
          name: resolvedAssistantId,
          systemPrompt: '',
          presetQuestions: [],
        }),
        allowedBuiltinTools: autoSkillAllowedTools,
      }
      const allowedTools = autoSkillAllowedTools
      const baseMenu = skillManager.getSkillMenu(effectiveChatType, allowedTools)
      const menu =
        resolvedChartAutoMode === 'aggressive'
          ? buildSkillMenuWithBuiltinChart(baseMenu, locale, allowedTools)
          : baseMenu
      if (menu) {
        skillCtx = { skillMenu: menu }
      }
    }

    // 语义检索按需暴露：工具可用时向 system prompt 加简短引导（实际检索由 LLM 调用工具触发）。
    const canSemanticSearch = !!semanticIndexService && (await semanticIndexService.canSearch(sessionId))
    if (canSemanticSearch) {
      const baseSystemPrompt = assistantConfig?.systemPrompt ?? ''
      assistantConfig = {
        ...(assistantConfig ?? {
          id: resolvedAssistantId,
          name: resolvedAssistantId,
          systemPrompt: '',
          presetQuestions: [],
        }),
        systemPrompt: [baseSystemPrompt, buildSemanticSearchGuidance(locale)].filter(Boolean).join('\n\n'),
      }
    }

    const maxToolResultPercent = compressionConfig?.maxToolResultPercent ?? 50
    const modelDef = findModelDefinition(activeAIConfig.provider, activeAIConfig.model || '')
    const resolvedContextWindow = modelDef?.contextWindow || DEFAULT_CONTEXT_WINDOW
    const maxToolResultTokens = Math.floor(resolvedContextWindow * (maxToolResultPercent / 100))

    let dataSnapshot: ToolContext['dataSnapshot'] | undefined
    try {
      dataSnapshot = createDataSnapshotFromOverview(await workerManager.getChatOverview(sessionId, 10))
    } catch (error) {
      aiLogger.warn('AgentStream', `Failed to load data snapshot: ${requestId}`, { error: String(error) })
    }

    const context: ToolContext = {
      sessionId,
      aiChatId,
      historyLeafMessageId: historyLeafMessageId ?? undefined,
      timeFilter: params.timeFilter,
      maxMessagesLimit: params.maxMessagesLimit,
      ownerInfo,
      mentionedMembers: mentionedMembers as ToolContext['mentionedMembers'],
      preprocessConfig: params.preprocessConfig as ToolContext['preprocessConfig'],
      semanticIndexService,
      maxToolResultTokens,
      dataSnapshot,
      abortSignal,
    }

    const agent = new Agent(
      context,
      piModel,
      activeAIConfig.apiKey,
      {
        abortSignal,
        thinkingLevel: thinkingLevel as import('@openchatlab/core').ThinkingLevel | undefined,
        chartAutoMode: resolvedChartAutoMode,
      },
      chatType ?? 'group',
      locale ?? 'zh-CN',
      assistantConfig,
      skillCtx
    )

    try {
      await agent.executeStream(userMessage, (chunk: AgentStreamChunk) => {
        if (abortSignal.aborted) return
        onEvent(chunk as SharedAgentStreamChunk)
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      const serializedError = serializeError(error, activeAIConfig.provider)
      serializedError.friendlyMessage = formatAIError(error, {
        providerName: resolveProviderName(activeAIConfig.provider),
        rawErrorLabel: t('llm.rawErrorLabel'),
      })
      if (!serializedError.url && activeAIConfig.baseUrl) serializedError.url = activeAIConfig.baseUrl
      aiLogger.error('AgentStream', `Agent execution error: ${requestId}`, serializedError)
      onEvent({ type: 'error', error: serializedError, isFinished: true })
    }
  }
}
