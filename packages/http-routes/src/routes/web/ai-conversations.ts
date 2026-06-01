import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import { countMessagesTokens } from '@openchatlab/node-runtime'

export function registerAiConversationRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const cm = ctx.conversationManager
  if (!cm) return

  // ==================== Conversation CRUD ====================

  server.post<{
    Body: { sessionId: string; title?: string; assistantId: string }
  }>('/_web/ai/conversations', async (request) => {
    const { sessionId, title, assistantId } = request.body
    return cm.createConversation(sessionId, title, assistantId)
  })

  server.get<{
    Querystring: { sessionId: string }
  }>('/_web/ai/conversations', async (request) => {
    const { sessionId } = request.query
    if (!sessionId) return []
    return cm.getConversations(sessionId)
  })

  server.get<{ Params: { id: string } }>('/_web/ai/conversations/:id', async (request, reply) => {
    const conv = cm.getConversation(request.params.id)
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' })
    return conv
  })

  server.put<{
    Params: { id: string }
    Body: { title: string }
  }>('/_web/ai/conversations/:id/title', async (request) => {
    return cm.updateConversationTitle(request.params.id, request.body.title)
  })

  server.delete<{ Params: { id: string } }>('/_web/ai/conversations/:id', async (request) => {
    return cm.deleteConversation(request.params.id)
  })

  // ==================== Message CRUD ====================

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
    return cm.addMessage(
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
    return cm.getMessages(request.params.id)
  })

  server.post<{
    Params: { id: string; messageId: string }
  }>('/_web/ai/conversations/:id/messages/:messageId/delete-from', async (request, reply) => {
    const { id, messageId } = request.params
    if (!id || typeof id !== 'string' || !messageId || typeof messageId !== 'string') {
      return reply.code(400).send({ error: 'conversation id and messageId are required' })
    }
    cm.deleteMessagesFrom(id, messageId)
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
    return cm.forkConversation(request.params.id, upToMessageId, title)
  })

  server.put<{
    Params: { messageId: string }
    Body: { content: string }
  }>('/_web/ai/messages/:messageId/content', async (request, reply) => {
    const { content } = request.body
    if (!content || typeof content !== 'string') {
      return reply.code(400).send({ error: 'content is required' })
    }
    cm.updateMessageContent(request.params.messageId, content)
    return { success: true }
  })

  server.post<{
    Params: { id: string; messageId: string }
  }>('/_web/ai/conversations/:id/messages/:messageId/delete-relink', async (request, reply) => {
    const { id, messageId } = request.params
    if (!id || !messageId) {
      return reply.code(400).send({ error: 'conversation id and messageId are required' })
    }
    cm.deleteAndRelinkMessage(id, messageId)
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
    return cm.insertMessageAfter(request.params.id, afterMessageId, role, content, contentBlocks as any, tokenUsage)
  })

  server.get<{ Params: { id: string } }>('/_web/ai/conversations/:id/token-usage', async (request) => {
    return cm.getConversationTokenUsage(request.params.id)
  })

  // ==================== Debug ====================

  server.get('/_web/ai/debug/schema', async () => {
    return cm.getAiSchema()
  })

  server.post<{
    Body: { sql: string }
  }>('/_web/ai/debug/execute-sql', async (request, reply) => {
    const { sql } = request.body
    if (!sql || typeof sql !== 'string') {
      return reply.code(400).send({ error: 'sql is required' })
    }
    try {
      return cm.executeAiSQL(sql)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return reply.code(400).send({ error: msg })
    }
  })

  server.post('/_web/ai/debug/clear-debug-context', async () => {
    const cleared = cm.clearAllDebugContext()
    return { success: true, cleared }
  })

  server.get<{
    Params: { id: string }
  }>('/_web/ai/conversations/:id/estimate-tokens', async (request) => {
    const history = cm.getHistoryForAgent(request.params.id)
    const tokens = countMessagesTokens(history.map((m) => ({ role: m.role, content: m.content })))
    return { success: true, tokens, messageCount: history.length }
  })
}
