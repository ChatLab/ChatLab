/**
 * AI Web API — CLI-specific routes
 *
 * Routes that remain CLI-specific (agent streaming, tool catalog, chat stream).
 * CRUD routes for assistants, skills, LLM config, conversations, and summaries
 * are now handled by @openchatlab/http-routes shared package.
 */

import type { FastifyInstance } from 'fastify'
import type { DatabaseManager, AIConversationManager } from '@openchatlab/node-runtime'
import { SkillManager, createActivateSkillTool } from '@openchatlab/node-runtime'
import { getChatOverview } from '@openchatlab/core'
import type { DataSnapshot, OwnerInfo, MentionedMember } from '@openchatlab/node-runtime'
import { runSimpleLlmStream } from '@openchatlab/node-runtime'
import { AGENT_TOOL_REGISTRY } from '@openchatlab/tools'
import { adaptToolsForAgent } from '../../ai/tool-adapter'
import { getDefaultAssistantConfig, buildPiModel } from '../../ai/llm-config'
import { loadAssistantConfig } from '../../ai/assistant-loader'
import { runServerAgent, type AgentStreamChunk } from '../../ai/agent'

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

  if (!convManager) return

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
      thinkingLevel?: string
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
      thinkingLevel,
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
        thinkingLevel,
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
