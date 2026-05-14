/**
 * AI Web API — /_web/ai/ routes
 *
 * 提供助手、技能、LLM 配置和工具目录的只读 HTTP 接口，
 * 供 CLI serve Web 前端使用（对齐 Electron preload 的 window.*Api）。
 *
 * - 助手/技能数据来自 ~/.chatlab/ai/{assistants,skills}/*.md
 * - LLM 配置来自 ~/.chatlab/ai/llm-config.json
 * - 工具目录来自 @openchatlab/core 静态数据
 */

import * as fs from 'fs'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import type { DatabaseManager, AIConversationManager } from '@openchatlab/node-runtime'
import { parseAssistantFile, parseSkillFile, SkillManager, createActivateSkillTool } from '@openchatlab/node-runtime'
import { BUILTIN_TOOL_CATALOG, BUILTIN_PROVIDERS, BUILTIN_MODELS, getBuiltinModelsByProvider } from '@openchatlab/core'
import type { AssistantSummary, SkillSummary } from '@openchatlab/node-runtime'
import { TOOL_REGISTRY } from '@openchatlab/tools'
import { adaptToolsForAgent } from '../../ai/tool-adapter'
import { loadAssistantConfig } from '../../ai/assistant-loader'
import { runServerAgent, type AgentStreamEvent } from '../../ai/agent'

function getAiDir(dbManager: DatabaseManager): string {
  const pathProvider = (dbManager as any)['pathProvider']
  if (!pathProvider) {
    throw Object.assign(new Error('PathProvider not available'), { statusCode: 500 })
  }
  return pathProvider.getAiDataDir()
}

function scanMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f))
}

export function registerAiRoutes(
  server: FastifyInstance,
  dbManager: DatabaseManager,
  convManager?: AIConversationManager
): void {
  // ==================== Assistants ====================

  server.get('/_web/ai/assistants', async () => {
    const dir = path.join(getAiDir(dbManager), 'assistants')
    const files = scanMdFiles(dir)
    const results: AssistantSummary[] = []
    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const parsed = parseAssistantFile(content, filePath)
        if (parsed) {
          results.push({
            id: parsed.id,
            name: parsed.name,
            systemPrompt: parsed.systemPrompt,
            presetQuestions: parsed.presetQuestions,
            builtinId: parsed.builtinId,
            applicableChatTypes: parsed.applicableChatTypes,
            supportedLocales: parsed.supportedLocales,
          })
        }
      } catch {
        // skip unparseable files
      }
    }
    return results
  })

  server.get<{ Params: { id: string } }>('/_web/ai/assistants/:id', async (request, reply) => {
    const { id } = request.params
    const dir = path.join(getAiDir(dbManager), 'assistants')
    const filePath = path.join(dir, `${id}.md`)

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Not found' })
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = parseAssistantFile(content, filePath)
    if (!parsed) {
      return reply.code(404).send({ error: 'Parse failed' })
    }
    return parsed
  })

  // ==================== Skills ====================

  server.get('/_web/ai/skills', async () => {
    const dir = path.join(getAiDir(dbManager), 'skills')
    const files = scanMdFiles(dir)
    const results: SkillSummary[] = []
    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const parsed = parseSkillFile(content, filePath)
        if (parsed) {
          results.push({
            id: parsed.id,
            name: parsed.name,
            description: parsed.description,
            tags: parsed.tags,
            chatScope: parsed.chatScope,
            tools: parsed.tools,
            builtinId: parsed.builtinId,
          })
        }
      } catch {
        // skip unparseable files
      }
    }
    return results
  })

  server.get<{ Params: { id: string } }>('/_web/ai/skills/:id', async (request, reply) => {
    const { id } = request.params
    const dir = path.join(getAiDir(dbManager), 'skills')
    const filePath = path.join(dir, `${id}.md`)

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Not found' })
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = parseSkillFile(content, filePath)
    if (!parsed) {
      return reply.code(404).send({ error: 'Parse failed' })
    }
    return parsed
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
      const configs = (data.configs || []).map((c: Record<string, unknown>) => {
        const { apiKey: _k, ...rest } = c
        return { ...rest, apiKey: '' }
      })
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

  server.get<{ Params: { id: string } }>('/_web/ai/conversations/:id/token-usage', async (request) => {
    return convManager.getConversationTokenUsage(request.params.id)
  })

  // ==================== Agent SSE Stream ====================

  const activeAgentAborts = new Map<string, AbortController>()

  server.post<{
    Body: {
      userMessage: string
      conversationId: string
      sessionId: string
      chatType?: 'group' | 'private'
      locale?: string
      assistantId?: string
    }
  }>('/_web/ai/agent/stream', async (request, reply) => {
    const { userMessage, conversationId, sessionId, chatType, locale, assistantId } = request.body

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

    const db = (dbManager as any).open?.(sessionId)
    const agentTools = db
      ? adaptToolsForAgent(TOOL_REGISTRY, () => ({
          db,
          sessionId,
          locale,
        }))
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

    const onEvent = (event: AgentStreamEvent) => {
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
      await runServerAgent({
        userMessage,
        conversationId,
        chatType,
        locale,
        assistantSystemPrompt,
        skillMenu,
        tools: agentTools,
        aiDataDir,
        convManager,
        onEvent,
        abortSignal: abortController.signal,
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
}
