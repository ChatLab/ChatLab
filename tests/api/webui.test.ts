/**
 * ChatLab Web UI API Tests
 * Comprehensive test suite for authentication, conversation, and messaging APIs
 * Run with: npm test -- tests/api/webui.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Mock types for testing
interface TestContext {
  baseURL: string
  token?: string
  sessionId?: string
  conversationId?: string
}

/**
 * Test fixture helper
 */
class WebUIApiTestClient {
  private baseURL: string

  constructor(baseURL: string) {
    this.baseURL = baseURL
  }

  async request(
    method: string,
    path: string,
    options?: { body?: any; token?: string }
  ): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (options?.token) {
      headers['Authorization'] = `Bearer ${options.token}`
    }

    const response = await fetch(`${this.baseURL}${path}`, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    })

    const data = await response.json()
    return { status: response.status, data }
  }

  // Convenience methods
  async login(username: string, password: string) {
    return this.request('POST', '/api/webui/auth/login', {
      body: { username, password },
    })
  }

  async logout(token: string) {
    return this.request('POST', '/api/webui/auth/logout', {
      token,
    })
  }

  async listSessions(token: string) {
    return this.request('GET', '/api/webui/sessions', { token })
  }

  async getSession(sessionId: string, token: string) {
    return this.request('GET', `/api/webui/sessions/${sessionId}`, { token })
  }

  async createConversation(body: any, token: string) {
    return this.request('POST', '/api/webui/conversations', { body, token })
  }

  async listConversations(sessionId: string, token: string) {
    return this.request('GET', `/api/webui/sessions/${sessionId}/conversations`, { token })
  }

  async deleteConversation(conversationId: string, token: string) {
    return this.request('DELETE', `/api/webui/conversations/${conversationId}`, { token })
  }

  async sendMessage(conversationId: string, content: string, token: string) {
    return this.request('POST', `/api/webui/conversations/${conversationId}/messages`, {
      body: { content },
      token,
    })
  }

  async getMessages(conversationId: string, token: string, limit?: number, offset?: number) {
    let path = `/api/webui/conversations/${conversationId}/messages`
    const params = []
    if (limit !== undefined) params.push(`limit=${limit}`)
    if (offset !== undefined) params.push(`offset=${offset}`)
    if (params.length > 0) path += `?${params.join('&')}`

    return this.request('GET', path, { token })
  }
}

describe('WebUI API Tests', () => {
  let client: WebUIApiTestClient
  let context: TestContext
  let validToken: string

  beforeAll(() => {
    // Initialize test client
    context = {
      baseURL: 'http://127.0.0.1:9871', // Default API port
    }
    client = new WebUIApiTestClient(context.baseURL)
    console.log('[Test] Initializing WebUI API tests...')
  })

  afterAll(() => {
    console.log('[Test] WebUI API tests completed')
  })

  // ==================== Authentication Tests ====================

  describe('Authentication (POST /api/webui/auth/login)', () => {
    it('should successfully login with valid credentials', async () => {
      console.log('[Test] Testing login with valid credentials')
      const response = await client.login('admin', 'admin123')

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      expect(response.data.data).toBeDefined()
      expect(response.data.data.token).toBeDefined()
      expect(response.data.data.expiresAt).toBeDefined()

      validToken = response.data.data.token
      context.token = validToken

      console.log('[Test] Login successful, token obtained')
    })

    it('should reject login with invalid credentials', async () => {
      console.log('[Test] Testing login with invalid credentials')
      const response = await client.login('admin', 'wrongpassword')

      expect(response.status).toBe(401)
      expect(response.data.success).toBe(false)
      expect(response.data.error).toBeDefined()

      console.log('[Test] Invalid credentials correctly rejected')
    })

    it('should reject login with missing credentials', async () => {
      console.log('[Test] Testing login with missing credentials')
      const response = await client.request('POST', '/api/webui/auth/login', {
        body: { username: 'admin' },
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.data.success).toBe(false)

      console.log('[Test] Missing credentials correctly rejected')
    })

    it('should enforce rate limiting on repeated failed attempts', async () => {
      console.log('[Test] Testing rate limiting on failed login attempts')

      // Attempt login 6 times (more than MAX_LOGIN_ATTEMPTS=5)
      for (let i = 0; i < 6; i++) {
        const response = await client.login('admin', 'wrongpassword')
        console.log(`[Test] Attempt ${i + 1}: Status ${response.status}`)

        if (i < 5) {
          expect(response.status).toBe(401)
        } else {
          // 6th attempt should be rate limited
          expect(response.status).toBe(401)
          expect(response.data.data?.error || response.data.error?.message).toContain('rate')
        }
      }

      console.log('[Test] Rate limiting correctly enforced')
    })
  })

  describe('Logout (POST /api/webui/auth/logout)', () => {
    it('should successfully logout with valid token', async () => {
      console.log('[Test] Testing logout with valid token')
      const response = await client.logout(validToken)

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)

      console.log('[Test] Logout successful')
    })

    it('should reject logout without token', async () => {
      console.log('[Test] Testing logout without token')
      const response = await client.request('POST', '/api/webui/auth/logout')

      expect(response.status).toBe(401)
      expect(response.data.success).toBe(false)

      console.log('[Test] Logout without token correctly rejected')
    })
  })

  // ==================== Session Tests ====================

  describe('Sessions (GET /api/webui/sessions)', () => {
    beforeAll(async () => {
      // Get a valid token for session tests
      const loginResponse = await client.login('admin', 'admin123')
      validToken = loginResponse.data.data.token
      console.log('[Test] Token refreshed for session tests')
    })

    it('should list all sessions with authentication', async () => {
      console.log('[Test] Listing all sessions')
      const response = await client.listSessions(validToken)

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      expect(Array.isArray(response.data.data)).toBe(true)

      console.log(`[Test] Found ${response.data.data.length} sessions`)
    })

    it('should reject listing sessions without token', async () => {
      console.log('[Test] Testing list sessions without token')
      const response = await client.request('GET', '/api/webui/sessions')

      expect(response.status).toBe(401)
      expect(response.data.success).toBe(false)

      console.log('[Test] Listing sessions without token correctly rejected')
    })

    it('should get specific session details', async () => {
      console.log('[Test] Getting specific session details')
      const listResponse = await client.listSessions(validToken)

      if (listResponse.data.data.length > 0) {
        const sessionId = listResponse.data.data[0].id
        context.sessionId = sessionId

        const response = await client.getSession(sessionId, validToken)

        expect(response.status).toBe(200)
        expect(response.data.success).toBe(true)
        expect(response.data.data.id).toBe(sessionId)

        console.log(`[Test] Session details retrieved: ${sessionId}`)
      }
    })

    it('should return 404 for non-existent session', async () => {
      console.log('[Test] Testing non-existent session')
      const response = await client.getSession('non-existent-session-id', validToken)

      expect(response.status).toBe(404)
      expect(response.data.success).toBe(false)
      expect(response.data.error.code).toBe('SESSION_NOT_FOUND')

      console.log('[Test] Non-existent session correctly returned 404')
    })
  })

  // ==================== Conversation Tests ====================

  describe('Conversations (POST /api/webui/conversations)', () => {
    beforeAll(async () => {
      // Ensure we have a valid token and session
      const loginResponse = await client.login('admin', 'admin123')
      validToken = loginResponse.data.data.token

      const listResponse = await client.listSessions(validToken)
      if (listResponse.data.data.length > 0) {
        context.sessionId = listResponse.data.data[0].id
      }

      console.log('[Test] Setup completed for conversation tests')
    })

    it('should create a new conversation in a session', async () => {
      if (!context.sessionId) {
        console.log('[Test] Skipping: No session available')
        return
      }

      console.log('[Test] Creating new conversation')
      const response = await client.createConversation(
        {
          sessionId: context.sessionId,
          title: 'Test Conversation',
          assistantId: 'test-assistant',
        },
        validToken
      )

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      expect(response.data.data.id).toBeDefined()
      expect(response.data.data.sessionId).toBe(context.sessionId)
      expect(response.data.data.title).toBe('Test Conversation')

      context.conversationId = response.data.data.id

      console.log(`[Test] Conversation created: ${context.conversationId}`)
    })

    it('should reject conversation creation for non-existent session', async () => {
      console.log('[Test] Testing conversation creation with non-existent session')
      const response = await client.createConversation(
        {
          sessionId: 'non-existent-session-id',
          title: 'Test',
        },
        validToken
      )

      expect(response.status).toBe(404)
      expect(response.data.success).toBe(false)
      expect(response.data.error.code).toBe('SESSION_NOT_FOUND')

      console.log('[Test] Non-existent session correctly rejected')
    })

    it('should list conversations for a session', async () => {
      if (!context.sessionId) {
        console.log('[Test] Skipping: No session available')
        return
      }

      console.log('[Test] Listing conversations for session')
      const response = await client.listConversations(context.sessionId, validToken)

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      expect(Array.isArray(response.data.data)).toBe(true)

      console.log(`[Test] Found ${response.data.data.length} conversations`)
    })
  })

  // ==================== Message Tests ====================

  describe('Messages (POST /api/webui/conversations/:id/messages)', () => {
    beforeAll(async () => {
      // Setup: login and create a conversation
      const loginResponse = await client.login('admin', 'admin123')
      validToken = loginResponse.data.data.token

      const listResponse = await client.listSessions(validToken)
      if (listResponse.data.data.length > 0) {
        context.sessionId = listResponse.data.data[0].id

        const convResponse = await client.createConversation(
          { sessionId: context.sessionId },
          validToken
        )
        if (convResponse.data.success) {
          context.conversationId = convResponse.data.data.id
        }
      }

      console.log('[Test] Setup completed for message tests')
    })

    it('should send a message in a conversation', async () => {
      if (!context.conversationId) {
        console.log('[Test] Skipping: No conversation available')
        return
      }

      console.log('[Test] Sending message')
      const response = await client.sendMessage(
        context.conversationId,
        'Hello, this is a test message!',
        validToken
      )

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      expect(response.data.data.role).toBe('user')
      expect(response.data.data.content).toBe('Hello, this is a test message!')

      console.log(`[Test] Message sent: ${response.data.data.id}`)
    })

    it('should reject empty messages', async () => {
      if (!context.conversationId) {
        console.log('[Test] Skipping: No conversation available')
        return
      }

      console.log('[Test] Testing empty message rejection')
      const response = await client.sendMessage(context.conversationId, '', validToken)

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.data.success).toBe(false)

      console.log('[Test] Empty message correctly rejected')
    })

    it('should get messages from a conversation (paginated)', async () => {
      if (!context.conversationId) {
        console.log('[Test] Skipping: No conversation available')
        return
      }

      console.log('[Test] Getting messages with pagination')
      const response = await client.getMessages(context.conversationId, validToken, 10, 0)

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      expect(Array.isArray(response.data.data.messages)).toBe(true)
      expect(response.data.data.total).toBeGreaterThanOrEqual(0)
      expect(response.data.data.limit).toBe(10)
      expect(response.data.data.offset).toBe(0)

      console.log(`[Test] Retrieved ${response.data.data.messages.length} messages`)
    })

    it('should respect pagination limits', async () => {
      if (!context.conversationId) {
        console.log('[Test] Skipping: No conversation available')
        return
      }

      console.log('[Test] Testing pagination limits')

      // Test with limit > 100 (should be capped)
      const response = await client.getMessages(context.conversationId, validToken, 200, 0)

      expect(response.data.data.limit).toBeLessThanOrEqual(100)

      console.log('[Test] Pagination limits correctly enforced')
    })

    it('should return 404 for non-existent conversation', async () => {
      console.log('[Test] Testing messages for non-existent conversation')
      const response = await client.getMessages('non-existent-conv-id', validToken)

      expect(response.status).toBe(404)
      expect(response.data.success).toBe(false)
      expect(response.data.error.code).toBe('CONVERSATION_NOT_FOUND')

      console.log('[Test] Non-existent conversation correctly returned 404')
    })
  })

  // ==================== Conversation Deletion Tests ====================

  describe('Delete Conversation (DELETE /api/webui/conversations/:id)', () => {
    let testConvId: string

    beforeAll(async () => {
      // Create a conversation to delete
      const loginResponse = await client.login('admin', 'admin123')
      validToken = loginResponse.data.data.token

      const listResponse = await client.listSessions(validToken)
      if (listResponse.data.data.length > 0) {
        context.sessionId = listResponse.data.data[0].id

        const convResponse = await client.createConversation(
          { sessionId: context.sessionId, title: 'To Delete' },
          validToken
        )
        if (convResponse.data.success) {
          testConvId = convResponse.data.data.id
        }
      }

      console.log('[Test] Setup completed for deletion tests')
    })

    it('should delete an existing conversation', async () => {
      if (!testConvId) {
        console.log('[Test] Skipping: No conversation created')
        return
      }

      console.log('[Test] Deleting conversation')
      const response = await client.deleteConversation(testConvId, validToken)

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)

      console.log(`[Test] Conversation deleted: ${testConvId}`)
    })

    it('should return 404 when deleting non-existent conversation', async () => {
      console.log('[Test] Testing deletion of non-existent conversation')
      const response = await client.deleteConversation('non-existent-conv-id', validToken)

      expect(response.status).toBe(404)
      expect(response.data.success).toBe(false)
      expect(response.data.error.code).toBe('CONVERSATION_NOT_FOUND')

      console.log('[Test] Non-existent conversation deletion correctly rejected')
    })
  })

  // ==================== Error Handling Tests ====================

  describe('Error Handling', () => {
    it('should return proper error structure for API errors', async () => {
      console.log('[Test] Testing error response structure')
      const response = await client.login('invalid', 'invalid')

      expect(response.data).toHaveProperty('success', false)
      expect(response.data).toHaveProperty('error')
      expect(response.data.error).toHaveProperty('code')
      expect(response.data.error).toHaveProperty('message')

      console.log('[Test] Error response structure is correct')
    })

    it('should include timestamp and version in success responses', async () => {
      console.log('[Test] Testing response metadata')
      const response = await client.login('admin', 'admin123')

      if (response.data.success) {
        expect(response.data).toHaveProperty('meta')
        expect(response.data.meta).toHaveProperty('timestamp')
        expect(response.data.meta).toHaveProperty('version')

        console.log('[Test] Response metadata correctly included')
      }
    })
  })
})

// ==================== Integration Test ====================

describe('WebUI API Integration Test', () => {
  let client: WebUIApiTestClient

  beforeAll(() => {
    client = new WebUIApiTestClient('http://127.0.0.1:9871')
    console.log('[Integration Test] Starting complete workflow test')
  })

  it('should complete full workflow: login -> create conversation -> send messages -> logout', async () => {
    // 1. Login
    console.log('[Integration Test] Step 1: Login')
    const loginResponse = await client.login('admin', 'admin123')
    expect(loginResponse.data.success).toBe(true)
    const token = loginResponse.data.data.token

    // 2. List sessions
    console.log('[Integration Test] Step 2: List sessions')
    const sessionsResponse = await client.listSessions(token)
    expect(sessionsResponse.data.success).toBe(true)
    const sessionId = sessionsResponse.data.data[0]?.id

    if (sessionId) {
      // 3. Create conversation
      console.log('[Integration Test] Step 3: Create conversation')
      const convResponse = await client.createConversation(
        { sessionId, title: 'Integration Test Conv' },
        token
      )
      expect(convResponse.data.success).toBe(true)
      const conversationId = convResponse.data.data.id

      // 4. Send message
      console.log('[Integration Test] Step 4: Send message')
      const msgResponse = await client.sendMessage(conversationId, 'Integration test message', token)
      expect(msgResponse.data.success).toBe(true)

      // 5. Get messages
      console.log('[Integration Test] Step 5: Get messages')
      const getResponse = await client.getMessages(conversationId, token)
      expect(getResponse.data.success).toBe(true)
      expect(getResponse.data.data.messages.length).toBeGreaterThan(0)

      // 6. Delete conversation
      console.log('[Integration Test] Step 6: Delete conversation')
      const delResponse = await client.deleteConversation(conversationId, token)
      expect(delResponse.data.success).toBe(true)
    }

    // 7. Logout
    console.log('[Integration Test] Step 7: Logout')
    const logoutResponse = await client.logout(token)
    expect(logoutResponse.data.success).toBe(true)

    console.log('[Integration Test] Complete workflow test passed!')
  })
})
