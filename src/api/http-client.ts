/**
 * HTTP-based API Client Implementation
 * Used for accessing the Web UI from a browser via HTTP
 */

import type {
  IApiClient,
  AuthCredentials,
  AuthResponse,
  LogoutResponse,
  AnalysisSession,
  ListSessionsResponse,
  GetSessionResponse,
  CreateConversationRequest,
  CreateConversationResponse,
  ListConversationsResponse,
  DeleteConversationRequest,
  DeleteConversationResponse,
  SendMessageRequest,
  SendMessageResponse,
  GetMessagesRequest,
  GetMessagesResponse,
} from './types'

/**
 * HttpClient - HTTP-based API client for Web UI
 * Makes requests to Fastify API server with Bearer token authentication
 */
export class HttpClient implements IApiClient {
  private baseURL: string
  private token: string | null = null
  private tokenExpiresAt: number = 0

  constructor(baseURL: string = '') {
    // If baseURL is empty, derive from current location
    this.baseURL = baseURL || `${window.location.protocol}//${window.location.host}`
  }

  /**
   * Make HTTP request with authentication
   */
  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, any>
  ): Promise<T | null> {
    const url = `${this.baseURL}/api${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add authorization token if available
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired or invalid
          this.clearToken()
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      return data
    } catch (error) {
      console.error(`[HttpClient] Request failed:`, error)
      throw error
    }
  }

  /**
   * Login with credentials
   */
  async login(credentials: AuthCredentials): Promise<AuthResponse> {
    try {
      const response = await this.request<AuthResponse>('POST', '/auth/login', {
        username: credentials.username,
        password: credentials.password,
      })

      if (response && response.success && response.token && response.expiresAt) {
        this.setToken(response.token, response.expiresAt)
      }

      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Login failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Logout
   */
  async logout(): Promise<LogoutResponse> {
    try {
      const response = await this.request<LogoutResponse>('POST', '/auth/logout')
      this.clearToken()
      return response || { success: true }
    } catch (error) {
      console.error('[HttpClient] Logout error:', error)
      this.clearToken()
      return { success: true }
    }
  }

  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    if (!this.token) {
      return false
    }

    // Check if token has expired
    if (this.tokenExpiresAt && Date.now() > this.tokenExpiresAt) {
      this.clearToken()
      return false
    }

    return true
  }

  /**
   * Get current authentication token
   */
  async getToken(): Promise<string | null> {
    return this.token
  }

  /**
   * Set token and expiration
   */
  setToken(token: string, expiresAt: number): void {
    this.token = token
    this.tokenExpiresAt = expiresAt
    // Persist to localStorage for persistence across page reloads
    localStorage.setItem('chatlab_token', token)
    localStorage.setItem('chatlab_token_expires_at', String(expiresAt))
  }

  /**
   * Clear token
   */
  clearToken(): void {
    this.token = null
    this.tokenExpiresAt = 0
    localStorage.removeItem('chatlab_token')
    localStorage.removeItem('chatlab_token_expires_at')
  }

  /**
   * Restore token from localStorage
   */
  restoreToken(): void {
    const token = localStorage.getItem('chatlab_token')
    const expiresAt = localStorage.getItem('chatlab_token_expires_at')

    if (token && expiresAt) {
      const expiresAtNum = parseInt(expiresAt, 10)
      if (Date.now() < expiresAtNum) {
        this.token = token
        this.tokenExpiresAt = expiresAtNum
      } else {
        this.clearToken()
      }
    }
  }

  /**
   * List all analysis sessions
   */
  async listSessions(): Promise<ListSessionsResponse> {
    try {
      const response = await this.request<ListSessionsResponse>('GET', '/sessions')
      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Get a specific analysis session
   */
  async getSession(sessionId: string): Promise<GetSessionResponse> {
    try {
      const response = await this.request<GetSessionResponse>('GET', `/sessions/${sessionId}`)
      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to get session: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Create a new AI conversation
   */
  async createConversation(request: CreateConversationRequest): Promise<CreateConversationResponse> {
    try {
      const response = await this.request<CreateConversationResponse>('POST', '/conversations', {
        sessionId: request.sessionId,
        title: request.title,
        assistantId: request.assistantId,
      })

      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * List conversations for a session
   */
  async listConversations(sessionId: string): Promise<ListConversationsResponse> {
    try {
      const response = await this.request<ListConversationsResponse>(
        'GET',
        `/sessions/${sessionId}/conversations`
      )

      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to list conversations: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(request: DeleteConversationRequest): Promise<DeleteConversationResponse> {
    try {
      const response = await this.request<DeleteConversationResponse>(
        'DELETE',
        `/conversations/${request.conversationId}`
      )

      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete conversation: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Send a message in a conversation
   */
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    try {
      const response = await this.request<SendMessageResponse>(
        'POST',
        `/conversations/${request.conversationId}/messages`,
        { content: request.content }
      )

      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Get messages from a conversation
   */
  async getMessages(request: GetMessagesRequest): Promise<GetMessagesResponse> {
    try {
      const params = new URLSearchParams()
      if (request.limit) params.append('limit', String(request.limit))
      if (request.offset) params.append('offset', String(request.offset))

      const query = params.toString() ? `?${params.toString()}` : ''
      const response = await this.request<GetMessagesResponse>(
        'GET',
        `/conversations/${request.conversationId}/messages${query}`
      )

      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to get messages: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Check if running in Electron
   */
  isElectron(): boolean {
    return false
  }
}
