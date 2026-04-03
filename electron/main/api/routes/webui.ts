/**
 * ChatLab Web UI Routes
 * Handles authentication, conversation management, and AI messaging
 * Comprehensive logging for all operations
 * Updated to use database-backed user management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as worker from '../../worker/workerManager'
import { successResponse, errorResponse, ApiError, conversationNotFound, sessionNotFound, invalidFormat, serverError } from '../errors'
import { handleLogin, handleLogout, handleRegister, jwtAuthMiddleware, handleChangePassword, verifyToken } from '../auth-db'

// ==================== Types ====================

interface CreateConversationRequest {
  sessionId: string
  title?: string
  assistantId?: string
}

interface SendMessageRequest {
  content: string
}

interface GetMessagesQuery {
  limit?: string
  offset?: string
}

// ==================== In-Memory Storage ====================
// In production, persist these to a database

interface Conversation {
  id: string
  sessionId: string
  title: string | null
  assistantId: string
  createdAt: number
  updatedAt: number
}

interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

const conversations = new Map<string, Conversation>()
const messages = new Map<string, Message[]>()

// ==================== Utility Functions ====================

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Log operation with context
 */
function logOperation(
  operation: string,
  context: string,
  details?: Record<string, any>
): void {
  const timestamp = new Date().toISOString()
  console.log(`[WebUI API] [${timestamp}] ${operation} - ${context}`, details || '')
}

/**
 * Verify request authentication
 */
async function verifyRequest(request: FastifyRequest, reply: FastifyReply): Promise<{ valid: boolean; userId?: string; username?: string }> {
  const authHeader = request.headers.authorization
  if (!authHeader) {
    console.warn('[WebUI API] Missing authorization header')
    return { valid: false }
  }

  if (!authHeader.startsWith('Bearer ')) {
    console.warn('[WebUI API] Invalid authorization header format')
    return { valid: false }
  }

  const token = authHeader.slice(7)
  const verification = verifyToken(token)

  if (!verification.valid) {
    console.warn('[WebUI API] Token verification failed')
    return { valid: false }
  }

  return {
    valid: true,
    userId: verification.userId,
    username: verification.username,
  }
}

// ==================== Route Handlers ====================

/**
 * POST /api/webui/auth/login
 * User login endpoint
 */
async function handleAuthLogin(
  request: FastifyRequest<{ Body: { username: string; password: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const { username, password } = request.body

    logOperation('LOGIN_ATTEMPT', `User: ${username}`)

    if (!username || !password) {
      logOperation('LOGIN_FAILED', 'Missing credentials', { username })
      const err = invalidFormat('Username and password are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const result = await handleLogin(username, password)

    if (result.success) {
      logOperation('LOGIN_SUCCESS', `User: ${username}`, {
        userId: result.userId,
        token: result.token?.slice(0, 20) + '...',
        expiresAt: new Date(result.expiresAt || 0).toISOString(),
      })
      return successResponse({
        token: result.token,
        userId: result.userId,
        username: result.username,
        expiresAt: result.expiresAt,
      })
    } else {
      logOperation('LOGIN_FAILED', `User: ${username}`, { error: result.error })
      const err = new ApiError('LOGIN_FAILED', result.error || 'Login failed')
      return reply.code(401).send(errorResponse(err))
    }
  } catch (error) {
    console.error('[WebUI API] Login error:', error)
    const err = serverError(`Login error: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * POST /api/webui/auth/register
 * User registration endpoint
 */
async function handleAuthRegister(
  request: FastifyRequest<{ Body: { username: string; password: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const { username, password } = request.body

    logOperation('REGISTER_ATTEMPT', `User: ${username}`)

    if (!username || !password) {
      logOperation('REGISTER_FAILED', 'Missing credentials', { username })
      const err = invalidFormat('Username and password are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const result = await handleRegister(username, password)

    if (result.success) {
      logOperation('REGISTER_SUCCESS', `User: ${username}`, {
        userId: result.userId,
      })
      return successResponse({
        userId: result.userId,
        username: username,
      })
    } else {
      logOperation('REGISTER_FAILED', `User: ${username}`, { error: result.error })
      const err = new ApiError('INVALID_FORMAT', result.error || 'Registration failed')
      return reply.code(400).send(errorResponse(err))
    }
  } catch (error) {
    console.error('[WebUI API] Registration error:', error)
    const err = serverError(`Registration error: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * POST /api/webui/auth/logout
 * User logout endpoint
 */
async function handleAuthLogout(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError('UNAUTHORIZED', 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const authHeader = request.headers.authorization
    const token = authHeader!.slice(7)
    handleLogout(token)

    logOperation('LOGOUT', `User: ${verification.username}`)

    return successResponse({ success: true })
  } catch (error) {
    console.error('[WebUI API] Logout error:', error)
    const err = serverError(`Logout error: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * POST /api/webui/auth/change-password
 * Change user password
 */
async function handleChangePasswordEndpoint(
  request: FastifyRequest<{ Body: { oldPassword: string; newPassword: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError('UNAUTHORIZED', 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { oldPassword, newPassword } = request.body

    logOperation('CHANGE_PASSWORD', `User: ${verification.username}`)

    if (!oldPassword || !newPassword) {
      const err = invalidFormat('Old password and new password are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const result = handleChangePassword(verification.username!, oldPassword, newPassword)

    if (result.success) {
      logOperation('CHANGE_PASSWORD_SUCCESS', `User: ${verification.username}`)
      return successResponse({ success: true })
    } else {
      logOperation('CHANGE_PASSWORD_FAILED', `User: ${verification.username}`, { error: result.error })
      const err = new ApiError('INVALID_FORMAT', result.error || 'Password change failed')
      return reply.code(400).send(errorResponse(err))
    }
  } catch (error) {
    console.error('[WebUI API] Password change error:', error)
    const err = serverError(`Password change error: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * GET /api/webui/sessions
 * List all analysis sessions
 */
async function listSessionsHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError('UNAUTHORIZED', 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    logOperation('LIST_SESSIONS', 'Retrieving all sessions')

    const sessions = await worker.getAllSessions()

    logOperation('LIST_SESSIONS_SUCCESS', `Found ${sessions.length} sessions`, {
      sessionIds: sessions.map(s => s.id),
    })

    return successResponse(sessions)
  } catch (error) {
    console.error('[WebUI API] Error listing sessions:', error)
    const err = serverError(`Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * GET /api/webui/sessions/:sessionId
 * Get single session
 */
async function getSessionHandler(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError('UNAUTHORIZED', 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { sessionId } = request.params

    logOperation('GET_SESSION', `Session: ${sessionId}`)

    const session = await worker.getSession(sessionId)
    if (!session) {
      logOperation('GET_SESSION_NOT_FOUND', `Session: ${sessionId}`)
      const err = sessionNotFound(sessionId)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    logOperation('GET_SESSION_SUCCESS', `Session: ${sessionId}`, {
      name: session.name,
      messageCount: (session as any).messageCount,
    })

    return successResponse(session)
  } catch (error) {
    console.error('[WebUI API] Error getting session:', error)
    const err = serverError(`Failed to get session: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * POST /api/webui/conversations
 * Create new conversation
 */
async function createConversationHandler(
  request: FastifyRequest<{ Body: CreateConversationRequest }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError('UNAUTHORIZED', 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { sessionId, title, assistantId } = request.body

    logOperation('CREATE_CONVERSATION', `Session: ${sessionId}`, { title, assistantId })

    // Verify session exists
    const session = await worker.getSession(sessionId)
    if (!session) {
      logOperation('CREATE_CONVERSATION_SESSION_NOT_FOUND', `Session: ${sessionId}`)
      const err = sessionNotFound(sessionId)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const conversationId = generateId()
    const now = Date.now()
    const conversation: Conversation = {
      id: conversationId,
      sessionId,
      title: title || null,
      assistantId: assistantId || 'default',
      createdAt: now,
      updatedAt: now,
    }

    conversations.set(conversationId, conversation)
    messages.set(conversationId, [])

    logOperation('CREATE_CONVERSATION_SUCCESS', `Conversation: ${conversationId}`, {
      sessionId,
      title,
    })

    return successResponse(conversation, { conversationId })
  } catch (error) {
    console.error('[WebUI API] Error creating conversation:', error)
    const err = serverError(`Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * GET /api/webui/sessions/:sessionId/conversations
 * List conversations for session
 */
async function listConversationsHandler(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError('UNAUTHORIZED', 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { sessionId } = request.params

    logOperation('LIST_CONVERSATIONS', `Session: ${sessionId}`)

    // Verify session exists
    const session = await worker.getSession(sessionId)
    if (!session) {
      logOperation('LIST_CONVERSATIONS_SESSION_NOT_FOUND', `Session: ${sessionId}`)
      const err = sessionNotFound(sessionId)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const sessionConversations = Array.from(conversations.values()).filter(
      c => c.sessionId === sessionId
    )

    logOperation('LIST_CONVERSATIONS_SUCCESS', `Session: ${sessionId}`, {
      count: sessionConversations.length,
    })

    return successResponse(sessionConversations)
  } catch (error) {
    console.error('[WebUI API] Error listing conversations:', error)
    const err = serverError(`Failed to list conversations: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * DELETE /api/webui/conversations/:conversationId
 * Delete conversation
 */
async function deleteConversationHandler(
  request: FastifyRequest<{ Params: { conversationId: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError('UNAUTHORIZED', 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { conversationId } = request.params

    logOperation('DELETE_CONVERSATION', `Conversation: ${conversationId}`)

    if (!conversations.has(conversationId)) {
      logOperation('DELETE_CONVERSATION_NOT_FOUND', `Conversation: ${conversationId}`)
      const err = conversationNotFound(conversationId)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    conversations.delete(conversationId)
    messages.delete(conversationId)

    logOperation('DELETE_CONVERSATION_SUCCESS', `Conversation: ${conversationId}`)

    return successResponse({ success: true })
  } catch (error) {
    console.error('[WebUI API] Error deleting conversation:', error)
    const err = serverError(`Failed to delete conversation: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * POST /api/webui/conversations/:conversationId/messages
 * Send message in conversation
 */
async function sendMessageHandler(
  request: FastifyRequest<{
    Params: { conversationId: string }
    Body: SendMessageRequest
  }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError('UNAUTHORIZED', 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { conversationId } = request.params
    const { content } = request.body

    logOperation('SEND_MESSAGE', `Conversation: ${conversationId}`, {
      contentLength: content?.length,
    })

    if (!conversations.has(conversationId)) {
      logOperation('SEND_MESSAGE_CONVERSATION_NOT_FOUND', `Conversation: ${conversationId}`)
      const err = conversationNotFound(conversationId)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    if (!content || content.trim().length === 0) {
      logOperation('SEND_MESSAGE_EMPTY_CONTENT', `Conversation: ${conversationId}`)
      const err = invalidFormat('Message content cannot be empty')
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const messageId = generateId()
    const userMessage: Message = {
      id: messageId,
      conversationId,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    }

    const conversationMessages = messages.get(conversationId) || []
    conversationMessages.push(userMessage)
    messages.set(conversationId, conversationMessages)

    // Update conversation updatedAt
    const conversation = conversations.get(conversationId)
    if (conversation) {
      conversation.updatedAt = Date.now()
    }

    logOperation('SEND_MESSAGE_SUCCESS', `Conversation: ${conversationId}`, {
      messageId,
      contentLength: content.length,
    })

    return successResponse(userMessage)
  } catch (error) {
    console.error('[WebUI API] Error sending message:', error)
    const err = serverError(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * GET /api/webui/conversations/:conversationId/messages
 * Get messages from conversation (paginated)
 */
async function getMessagesHandler(
  request: FastifyRequest<{
    Params: { conversationId: string }
    Querystring: GetMessagesQuery
  }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError('UNAUTHORIZED', 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { conversationId } = request.params
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20', 10) || 20))
    const offset = Math.max(0, parseInt(request.query.offset || '0', 10) || 0)

    logOperation('GET_MESSAGES', `Conversation: ${conversationId}`, { limit, offset })

    if (!conversations.has(conversationId)) {
      logOperation('GET_MESSAGES_CONVERSATION_NOT_FOUND', `Conversation: ${conversationId}`)
      const err = conversationNotFound(conversationId)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const conversationMessages = messages.get(conversationId) || []
    const total = conversationMessages.length
    const paginatedMessages = conversationMessages.slice(offset, offset + limit)

    logOperation('GET_MESSAGES_SUCCESS', `Conversation: ${conversationId}`, {
      total,
      returned: paginatedMessages.length,
      offset,
      limit,
    })

    return successResponse({
      messages: paginatedMessages,
      total,
      offset,
      limit,
    })
  } catch (error) {
    console.error('[WebUI API] Error getting messages:', error)
    const err = serverError(`Failed to get messages: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

// ==================== Route Registration ====================

export function registerWebUIRoutes(server: FastifyInstance): void {
  console.log('[WebUI API] Registering WebUI routes...')

  // ==================== Authentication Routes ====================

  server.post<{ Body: { username: string; password: string } }>(
    '/api/webui/auth/login',
    { logLevel: 'warn' },
    handleAuthLogin
  )

  server.post<{ Body: { username: string; password: string } }>(
    '/api/webui/auth/register',
    { logLevel: 'warn' },
    handleAuthRegister
  )

  server.post('/api/webui/auth/logout', { logLevel: 'warn' }, handleAuthLogout)

  server.post<{ Body: { oldPassword: string; newPassword: string } }>(
    '/api/webui/auth/change-password',
    { logLevel: 'warn' },
    handleChangePasswordEndpoint
  )

  // ==================== Session Routes ====================

  server.get('/api/webui/sessions', { logLevel: 'warn' }, listSessionsHandler)

  server.get<{ Params: { sessionId: string } }>(
    '/api/webui/sessions/:sessionId',
    { logLevel: 'warn' },
    getSessionHandler
  )

  // ==================== Conversation Routes ====================

  server.post<{ Body: CreateConversationRequest }>(
    '/api/webui/conversations',
    { logLevel: 'warn' },
    createConversationHandler
  )

  server.get<{ Params: { sessionId: string } }>(
    '/api/webui/sessions/:sessionId/conversations',
    { logLevel: 'warn' },
    listConversationsHandler
  )

  server.delete<{ Params: { conversationId: string } }>(
    '/api/webui/conversations/:conversationId',
    { logLevel: 'warn' },
    deleteConversationHandler
  )

  // ==================== Message Routes ====================

  server.post<{
    Params: { conversationId: string }
    Body: SendMessageRequest
  }>(
    '/api/webui/conversations/:conversationId/messages',
    { logLevel: 'warn' },
    sendMessageHandler
  )

  server.get<{
    Params: { conversationId: string }
    Querystring: GetMessagesQuery
  }>(
    '/api/webui/conversations/:conversationId/messages',
    { logLevel: 'warn' },
    getMessagesHandler
  )

  console.log('[WebUI API] WebUI routes registered successfully')
}
