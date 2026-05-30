/**
 * AI Web API — /_web/ai/ routes
 *
 * 提供助手、技能、LLM 配置和工具目录的只读 HTTP 接口，
 * 供 CLI Web 前端使用（对齐 Electron preload 的 window.*Api）。
 *
 * - 助手/技能数据来自 ~/.chatlab/ai/{assistants,skills}/*.md
 * - LLM 配置来自 ~/.chatlab/ai/llm-config.json
 * - 工具目录来自 @openchatlab/core 静态数据
 */

import * as fs from 'fs'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import type { DatabaseManager, AIConversationManager } from '@openchatlab/node-runtime'
import { SkillManager, createActivateSkillTool } from '@openchatlab/node-runtime'
import type { AssistantConfig } from '@openchatlab/node-runtime'
import {
  BUILTIN_TOOL_CATALOG,
  BUILTIN_PROVIDERS,
  BUILTIN_MODELS,
  getBuiltinModelsByProvider,
  getChatOverview,
} from '@openchatlab/core'
import type { DataSnapshot, OwnerInfo, MentionedMember } from '@openchatlab/node-runtime'
import { runSimpleLlmStream } from '@openchatlab/node-runtime'
import { AGENT_TOOL_REGISTRY } from '@openchatlab/tools'
import { adaptToolsForAgent } from '../../ai/tool-adapter'
import { getDefaultAssistantConfig, buildPiModel } from '../../ai/llm-config'
import { loadAssistantConfig } from '../../ai/assistant-loader'
import { getAssistantManager, getSkillManagerCore } from '../../ai/manager-factory'
import { runServerAgent, type AgentStreamChunk } from '../../ai/agent'
import {
  addLlmConfig,
  updateLlmConfig,
  deleteLlmConfig,
  setDefaultAssistantSlot,
  setFastModelSlot,
} from '../../ai/llm-config'
import {
  addCustomProvider,
  updateCustomProvider,
  deleteCustomProvider,
  addCustomModel,
  updateCustomModel,
  deleteCustomModel,
} from '../../ai/custom-store'
import { validateApiKey, fetchRemoteModels } from '../../ai/remote-api'
import { resolveApiKey } from '@openchatlab/config'
import { toLlmConfigDisplay } from './ai-config-display'

function getAiDir(dbManager: DatabaseManager): string {
  const pathProvider = (dbManager as any)['pathProvider']
  if (!pathProvider) {
    throw Object.assign(new Error('PathProvider not available'), { statusCode: 500 })
  }
  return pathProvider.getAiDataDir()
}

export function registerAiRoutes(
  server: FastifyInstance,
  dbManager: DatabaseManager,
  convManager?: AIConversationManager
): void {
  // ==================== Assistants (via shared AssistantManager) ====================

  server.get('/_web/ai/assistants', async () => {
    const mgr = getAssistantManager(getAiDir(dbManager))
    return mgr.getAllAssistants()
  })

  server.get<{ Params: { id: string } }>('/_web/ai/assistants/:id', async (request, reply) => {
    const mgr = getAssistantManager(getAiDir(dbManager))
    const config = mgr.getAssistantConfig(request.params.id)
    if (!config) return reply.code(404).send({ error: 'Not found' })
    return config
  })

  server.post<{
    Body: Omit<AssistantConfig, 'id'>
  }>('/_web/ai/assistants', async (request) => {
    const mgr = getAssistantManager(getAiDir(dbManager))
    return mgr.createAssistant(request.body)
  })

  server.put<{
    Params: { id: string }
    Body: Partial<AssistantConfig>
  }>('/_web/ai/assistants/:id', async (request, reply) => {
    const mgr = getAssistantManager(getAiDir(dbManager))
    const result = mgr.updateAssistant(request.params.id, request.body)
    if (!result.success) return reply.code(404).send(result)
    return result
  })

  server.delete<{ Params: { id: string } }>('/_web/ai/assistants/:id', async (request, reply) => {
    const mgr = getAssistantManager(getAiDir(dbManager))
    const result = mgr.deleteAssistant(request.params.id)
    if (!result.success) return reply.code(400).send(result)
    return result
  })

  server.post<{ Params: { id: string } }>('/_web/ai/assistants/:id/reset', async (request, reply) => {
    const mgr = getAssistantManager(getAiDir(dbManager))
    const result = mgr.resetAssistant(request.params.id)
    if (!result.success) return reply.code(400).send(result)
    return result
  })

  server.post<{ Body: { rawMd: string } }>('/_web/ai/assistants/import', async (request) => {
    const mgr = getAssistantManager(getAiDir(dbManager))
    return mgr.importAssistantFromMd(request.body.rawMd)
  })

  // ==================== Skills (via shared SkillManagerCore) ====================

  server.get('/_web/ai/skills', async () => {
    const mgr = getSkillManagerCore(getAiDir(dbManager))
    return mgr.getAllSkills()
  })

  server.get<{ Params: { id: string } }>('/_web/ai/skills/:id', async (request, reply) => {
    const mgr = getSkillManagerCore(getAiDir(dbManager))
    const config = mgr.getSkillConfig(request.params.id)
    if (!config) return reply.code(404).send({ error: 'Not found' })
    return config
  })

  server.post<{ Body: { rawMd: string } }>('/_web/ai/skills', async (request) => {
    const mgr = getSkillManagerCore(getAiDir(dbManager))
    return mgr.createSkill(request.body.rawMd)
  })

  server.put<{
    Params: { id: string }
    Body: { rawMd: string }
  }>('/_web/ai/skills/:id', async (request, reply) => {
    const mgr = getSkillManagerCore(getAiDir(dbManager))
    const result = mgr.updateSkill(request.params.id, request.body.rawMd)
    if (!result.success) return reply.code(404).send(result)
    return result
  })

  server.delete<{ Params: { id: string } }>('/_web/ai/skills/:id', async (request, reply) => {
    const mgr = getSkillManagerCore(getAiDir(dbManager))
    const result = mgr.deleteSkill(request.params.id)
    if (!result.success) return reply.code(400).send(result)
    return result
  })

  server.post<{ Body: { rawMd: string } }>('/_web/ai/skills/import', async (request) => {
    const mgr = getSkillManagerCore(getAiDir(dbManager))
    return mgr.importSkillFromMd(request.body.rawMd)
  })

  server.get('/_web/ai/skills/builtin-catalog', async () => {
    const mgr = getSkillManagerCore(getAiDir(dbManager))
    return mgr.getBuiltinCatalog()
  })

  // ==================== LLM Config ====================

  server.get('/_web/ai/llm/has-config', async () => {
    const configPath = path.join(getAiDir(dbManager), 'llm-config.json')
    if (!fs.existsSync(configPath)) return false

    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (!data.configs || !Array.isArray(data.configs) || data.configs.length === 0) return false
      return data.defaultAssistant != null
    } catch {
      return false
    }
  })

  server.get('/_web/ai/llm/configs', async () => {
    const configPath = path.join(getAiDir(dbManager), 'llm-config.json')
    if (!fs.existsSync(configPath)) return { configs: [], defaultAssistant: null, fastModel: null }

    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      const configs = (data.configs || []).map((c: Record<string, unknown>) => toLlmConfigDisplay(c, resolveApiKey))
      return {
        configs,
        defaultAssistant: data.defaultAssistant ?? null,
        fastModel: data.fastModel ?? null,
      }
    } catch {
      return { configs: [], defaultAssistant: null, fastModel: null }
    }
  })

  // ==================== Provider Registry & Model Catalog ====================

  server.get('/_web/ai/llm/providers', async () => {
    return BUILTIN_PROVIDERS.map((p) => {
      const models = getBuiltinModelsByProvider(p.id)
      return {
        id: p.id,
        name: p.name,
        defaultBaseUrl: p.defaultBaseUrl,
        models: models
          .filter((m) => !m.capabilities.includes('embedding') && !m.capabilities.includes('ranking'))
          .map((m) => ({ id: m.id, name: m.name, description: m.description })),
      }
    })
  })

  server.get('/_web/ai/llm/provider-registry', async () => {
    const customPath = path.join(getAiDir(dbManager), 'custom-providers.json')
    let custom: unknown[] = []
    if (fs.existsSync(customPath)) {
      try {
        custom = JSON.parse(fs.readFileSync(customPath, 'utf-8'))
        if (!Array.isArray(custom)) custom = []
      } catch {
        custom = []
      }
    }
    return [...BUILTIN_PROVIDERS, ...custom]
  })

  server.get('/_web/ai/llm/model-catalog', async () => {
    const customPath = path.join(getAiDir(dbManager), 'custom-models.json')
    let custom: unknown[] = []
    if (fs.existsSync(customPath)) {
      try {
        custom = JSON.parse(fs.readFileSync(customPath, 'utf-8'))
        if (!Array.isArray(custom)) custom = []
      } catch {
        custom = []
      }
    }
    return [...BUILTIN_MODELS, ...custom]
  })

  server.get('/_web/ai/llm/default-assistant-slot', async () => {
    const configPath = path.join(getAiDir(dbManager), 'llm-config.json')
    if (!fs.existsSync(configPath)) return null
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return data.defaultAssistant ?? null
    } catch {
      return null
    }
  })

  server.get('/_web/ai/llm/fast-model-slot', async () => {
    const configPath = path.join(getAiDir(dbManager), 'llm-config.json')
    if (!fs.existsSync(configPath)) return null
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return data.fastModel ?? null
    } catch {
      return null
    }
  })

  // ==================== LLM Config Write Operations ====================

  server.post<{
    Body: {
      name: string
      provider: string
      apiKey: string
      model?: string
      baseUrl?: string
      maxTokens?: number
      apiFormat?: string
      disableThinking?: boolean
      isReasoningModel?: boolean
      customModels?: Array<{ id: string; name: string }>
    }
  }>('/_web/ai/llm/configs', async (request) => {
    const aiDataDir = getAiDir(dbManager)
    return addLlmConfig(aiDataDir, request.body)
  })

  server.put<{
    Params: { id: string }
    Body: {
      name?: string
      provider?: string
      apiKey?: string
      model?: string
      baseUrl?: string
      maxTokens?: number
      apiFormat?: string
      disableThinking?: boolean
      isReasoningModel?: boolean
      customModels?: Array<{ id: string; name: string }>
    }
  }>('/_web/ai/llm/configs/:id', async (request) => {
    const aiDataDir = getAiDir(dbManager)
    return updateLlmConfig(aiDataDir, request.params.id, request.body)
  })

  server.delete<{ Params: { id: string } }>('/_web/ai/llm/configs/:id', async (request) => {
    const aiDataDir = getAiDir(dbManager)
    return deleteLlmConfig(aiDataDir, request.params.id)
  })

  server.put<{
    Body: { configId: string; modelId: string }
  }>('/_web/ai/llm/default-assistant-slot', async (request) => {
    const aiDataDir = getAiDir(dbManager)
    return setDefaultAssistantSlot(aiDataDir, request.body.configId, request.body.modelId)
  })

  server.put<{
    Body: { configId: string; modelId: string } | null
  }>('/_web/ai/llm/fast-model-slot', async (request) => {
    const aiDataDir = getAiDir(dbManager)
    return setFastModelSlot(aiDataDir, request.body)
  })

  // ==================== Custom Provider CRUD ====================

  server.post<{
    Body: {
      name: string
      kind: string
      defaultBaseUrl: string
      authMode?: string
      supportsCustomModels?: boolean
      modelIds?: string[]
      website?: string
      consoleUrl?: string
    }
  }>('/_web/ai/llm/custom-providers', async (request) => {
    const aiDataDir = getAiDir(dbManager)
    return addCustomProvider(aiDataDir, {
      ...request.body,
      kind: (request.body.kind || 'openai-compatible') as 'official' | 'aggregator' | 'openai-compatible',
      authMode: 'api-key',
      supportsCustomModels: request.body.supportsCustomModels ?? true,
      modelIds: request.body.modelIds ?? [],
    })
  })

  server.put<{
    Params: { id: string }
    Body: Record<string, unknown>
  }>('/_web/ai/llm/custom-providers/:id', async (request) => {
    const aiDataDir = getAiDir(dbManager)
    return updateCustomProvider(aiDataDir, request.params.id, request.body as any)
  })

  server.delete<{ Params: { id: string } }>('/_web/ai/llm/custom-providers/:id', async (request) => {
    const aiDataDir = getAiDir(dbManager)
    return deleteCustomProvider(aiDataDir, request.params.id)
  })

  // ==================== Custom Model CRUD ====================

  server.post<{
    Body: {
      id: string
      providerId: string
      name: string
      description?: string
      contextWindow?: number
      capabilities?: string[]
      recommendedFor?: string[]
      status?: string
    }
  }>('/_web/ai/llm/custom-models', async (request) => {
    const aiDataDir = getAiDir(dbManager)
    return addCustomModel(aiDataDir, {
      ...request.body,
      capabilities: (request.body.capabilities ?? ['chat']) as any,
      recommendedFor: (request.body.recommendedFor ?? ['chat']) as any,
      status: (request.body.status ?? 'stable') as any,
    })
  })

  server.put<{
    Params: { providerId: string; modelId: string }
    Body: Record<string, unknown>
  }>('/_web/ai/llm/custom-models/:providerId/:modelId', async (request) => {
    const aiDataDir = getAiDir(dbManager)
    return updateCustomModel(aiDataDir, request.params.providerId, request.params.modelId, request.body as any)
  })

  server.delete<{
    Params: { providerId: string; modelId: string }
  }>('/_web/ai/llm/custom-models/:providerId/:modelId', async (request) => {
    const aiDataDir = getAiDir(dbManager)
    return deleteCustomModel(aiDataDir, request.params.providerId, request.params.modelId)
  })

  // ==================== Remote API (Validate Key & Fetch Models) ====================

  server.post<{
    Body: { provider: string; apiKey: string; baseUrl?: string; model?: string; apiFormat?: string }
  }>('/_web/ai/llm/validate-key', async (request) => {
    const { provider, apiKey, baseUrl, model, apiFormat } = request.body
    return validateApiKey(provider, apiKey, baseUrl, model, apiFormat)
  })

  server.post<{
    Body: { provider: string; apiKey: string; baseUrl?: string; apiFormat?: string }
  }>('/_web/ai/llm/remote-models', async (request) => {
    const { provider, apiKey, baseUrl, apiFormat } = request.body
    return fetchRemoteModels(provider, apiKey, baseUrl, apiFormat)
  })

  // ==================== LLM Simple Chat Stream ====================

  server.post<{
    Body: {
      messages: Array<{ role: string; content: string }>
      options?: { temperature?: number; maxTokens?: number }
    }
  }>('/_web/ai/llm/chat-stream', async (request, reply) => {
    const { messages, options } = request.body

    const aiDataDir = getAiDir(dbManager)
    const llmConfig = getDefaultAssistantConfig(aiDataDir)
    if (!llmConfig) {
      return reply.code(400).send({ success: false, error: 'LLM service not configured' })
    }

    const piModel = buildPiModel(llmConfig)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const sendChunk = (data: unknown) => {
      reply.raw.write(`event: chunk\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      await runSimpleLlmStream({
        messages,
        apiKey: llmConfig.apiKey,
        piModel,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        onChunk: sendChunk,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      sendChunk({ content: '', isFinished: true, finishReason: 'error', error: msg })
    }

    reply.raw.end()
  })

  // ==================== Tool Catalog ====================

  server.get('/_web/ai/tools/catalog', async () => {
    return BUILTIN_TOOL_CATALOG
  })

  // ==================== AI Conversations CRUD ====================

  if (!convManager) return

  server.post<{
    Body: { sessionId: string; title?: string; assistantId: string }
  }>('/_web/ai/conversations', async (request) => {
    const { sessionId, title, assistantId } = request.body
    return convManager.createConversation(sessionId, title, assistantId)
  })

  server.get<{
    Querystring: { sessionId: string }
  }>('/_web/ai/conversations', async (request) => {
    const { sessionId } = request.query
    if (!sessionId) return []
    return convManager.getConversations(sessionId)
  })

  server.get<{ Params: { id: string } }>('/_web/ai/conversations/:id', async (request, reply) => {
    const conv = convManager.getConversation(request.params.id)
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' })
    return conv
  })

  server.put<{
    Params: { id: string }
    Body: { title: string }
  }>('/_web/ai/conversations/:id/title', async (request) => {
    return convManager.updateConversationTitle(request.params.id, request.body.title)
  })

  server.delete<{ Params: { id: string } }>('/_web/ai/conversations/:id', async (request) => {
    return convManager.deleteConversation(request.params.id)
  })

  // ==================== AI Messages CRUD ====================

  server.post<{
    Params: { id: string }
    Body: {
      role: 'user' | 'assistant' | 'summary'
      content: string
      dataKeywords?: string[]
      dataMessageCount?: number
      contentBlocks?: unknown[]
      tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }
    }
  }>('/_web/ai/conversations/:id/messages', async (request) => {
    const { role, content, dataKeywords, dataMessageCount, contentBlocks, tokenUsage } = request.body
    return convManager.addMessage(
      request.params.id,
      role,
      content,
      dataKeywords,
      dataMessageCount,
      contentBlocks as any,
      tokenUsage
    )
  })

  server.get<{ Params: { id: string } }>('/_web/ai/conversations/:id/messages', async (request) => {
    return convManager.getMessages(request.params.id)
  })

  server.post<{
    Params: { id: string; messageId: string }
  }>('/_web/ai/conversations/:id/messages/:messageId/delete-from', async (request, reply) => {
    const { id, messageId } = request.params
    if (!id || typeof id !== 'string' || !messageId || typeof messageId !== 'string') {
      return reply.code(400).send({ error: 'conversation id and messageId are required' })
    }
    convManager.deleteMessagesFrom(id, messageId)
    return { success: true }
  })

  server.post<{
    Params: { id: string }
    Body: { upToMessageId: string; title?: string }
  }>('/_web/ai/conversations/:id/fork', async (request, reply) => {
    const { upToMessageId, title } = request.body
    if (!upToMessageId || typeof upToMessageId !== 'string') {
      return reply.code(400).send({ error: 'upToMessageId is required' })
    }
    return convManager.forkConversation(request.params.id, upToMessageId, title)
  })

  server.put<{
    Params: { messageId: string }
    Body: { content: string }
  }>('/_web/ai/messages/:messageId/content', async (request, reply) => {
    const { content } = request.body
    if (!content || typeof content !== 'string') {
      return reply.code(400).send({ error: 'content is required' })
    }
    convManager.updateMessageContent(request.params.messageId, content)
    return { success: true }
  })

  server.post<{
    Params: { id: string; messageId: string }
  }>('/_web/ai/conversations/:id/messages/:messageId/delete-relink', async (request, reply) => {
    const { id, messageId } = request.params
    if (!id || !messageId) {
      return reply.code(400).send({ error: 'conversation id and messageId are required' })
    }
    convManager.deleteAndRelinkMessage(id, messageId)
    return { success: true }
  })

  server.post<{
    Params: { id: string }
    Body: {
      afterMessageId: string
      role: 'user' | 'assistant' | 'summary'
      content: string
      contentBlocks?: unknown[]
      tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }
    }
  }>('/_web/ai/conversations/:id/messages/insert-after', async (request, reply) => {
    const { afterMessageId, role, content, contentBlocks, tokenUsage } = request.body
    if (!afterMessageId || typeof afterMessageId !== 'string') {
      return reply.code(400).send({ error: 'afterMessageId is required' })
    }
    return convManager.insertMessageAfter(
      request.params.id,
      afterMessageId,
      role,
      content,
      contentBlocks as any,
      tokenUsage
    )
  })

  server.get<{ Params: { id: string } }>('/_web/ai/conversations/:id/token-usage', async (request) => {
    return convManager.getConversationTokenUsage(request.params.id)
  })

  // ==================== Agent SSE Stream ====================

  const activeAgentAborts = new Map<string, AbortController>()

  server.post<{
    Body: {
      userMessage: string
      conversationId: string
      historyLeafMessageId?: string | null
      sessionId: string
      chatType?: 'group' | 'private'
      locale?: string
      assistantId?: string
      compressionConfig?: {
        enabled: boolean
        tokenThresholdPercent?: number
        bufferSizePercent?: number
        maxToolResultPercent?: number
      }
      ownerInfo?: OwnerInfo
      mentionedMembers?: MentionedMember[]
    }
  }>('/_web/ai/agent/stream', async (request, reply) => {
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
    } = request.body

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const abortController = new AbortController()
    activeAgentAborts.set(requestId, abortController)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Request-Id': requestId,
    })

    const sendSSE = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    sendSSE('meta', { requestId })

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

    const onEvent = (event: AgentStreamChunk) => {
      sendSSE(event.type, event)
      if (event.type === 'done') {
        activeAgentAborts.delete(requestId)
        reply.raw.end()
      }
    }

    reply.raw.on('close', () => {
      if (!abortController.signal.aborted) {
        abortController.abort()
      }
      activeAgentAborts.delete(requestId)
    })

    try {
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
          // non-fatal: proceed without snapshot
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
        abortSignal: abortController.signal,
        ownerInfo,
        mentionedMembers,
        dataSnapshot,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      sendSSE('error', { type: 'error', error: { name: 'ServerError', message: msg } })
      sendSSE('done', { type: 'done', isFinished: true })
      activeAgentAborts.delete(requestId)
      reply.raw.end()
    }
  })

  server.post<{
    Body: { requestId: string }
  }>('/_web/ai/agent/abort', async (request) => {
    const { requestId } = request.body
    const controller = activeAgentAborts.get(requestId)
    if (controller) {
      controller.abort()
      activeAgentAborts.delete(requestId)
      return { success: true }
    }
    return { success: false }
  })

  // ==================== Debug SQL ====================

  server.get('/_web/ai/debug/schema', async (_request, reply) => {
    if (!convManager) {
      return reply.code(503).send({ error: 'AI conversation manager not available' })
    }
    return convManager.getAiSchema()
  })

  server.post<{
    Body: { sql: string }
  }>('/_web/ai/debug/execute-sql', async (request, reply) => {
    if (!convManager) {
      return reply.code(503).send({ error: 'AI conversation manager not available' })
    }
    const { sql } = request.body
    if (!sql || typeof sql !== 'string') {
      return reply.code(400).send({ error: 'sql is required' })
    }
    try {
      return convManager.executeAiSQL(sql)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return reply.code(400).send({ error: msg })
    }
  })

  server.post('/_web/ai/debug/clear-debug-context', async (_request, reply) => {
    if (!convManager) {
      return reply.code(503).send({ error: 'AI conversation manager not available' })
    }
    const cleared = convManager.clearAllDebugContext()
    return { success: true, cleared }
  })
}
