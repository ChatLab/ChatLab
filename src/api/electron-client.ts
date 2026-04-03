/**
 * Electron IPC-based API Client Implementation
 * Uses window.chatApi and window.aiApi from preload script
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
 * ElectronClient - IPC-based API client for Electron environment
 * Delegates to native window.chatApi and window.aiApi objects
 */
export class ElectronClient implements IApiClient {
  private token: string | null = null
  private tokenExpiresAt: number = 0

  /**
   * Login - Not supported via IPC, returns error
   * Authentication in Electron is handled differently (native auth system)
   */
  async login(credentials: AuthCredentials): Promise<AuthResponse> {
    console.warn('[ElectronClient] Login is not supported in Electron mode')
    return {
      success: false,
      error: 'Authentication is not available in Electron mode. Use the desktop app directly.',
    }
  }

  /**
   * Logout - Not applicable in Electron mode
   */
  async logout(): Promise<LogoutResponse> {
    this.token = null
    this.tokenExpiresAt = 0
    return { success: true }
  }

  /**
   * Check if authenticated - Always true in Electron (trusted context)
   */
  async isAuthenticated(): Promise<boolean> {
    return true
  }

  /**
   * Get authentication token - Returns null in Electron (IPC based)
   */
  async getToken(): Promise<string | null> {
    return null
  }

  /**
   * Set token - Stored for reference, not used in IPC mode
   */
  setToken(token: string, expiresAt: number): void {
    this.token = token
    this.tokenExpiresAt = expiresAt
  }

  /**
   * Clear token
   */
  clearToken(): void {
    this.token = null
    this.tokenExpiresAt = 0
  }

  /**
   * List all analysis sessions
   */
  async listSessions(): Promise<ListSessionsResponse> {
    try {
      // Use chatApi from preload script
      const chatApi = (window as any).chatApi
      if (!chatApi?.getSessions) {
        return {
          success: false,
          error: 'chatApi is not available in window context',
        }
      }

      const sessions = await chatApi.getSessions()
      return {
        success: true,
        sessions: sessions || [],
      }
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
      const chatApi = (window as any).chatApi
      if (!chatApi?.getSession) {
        return {
          success: false,
          error: 'chatApi is not available in window context',
        }
      }

      const session = await chatApi.getSession(sessionId)
      return {
        success: true,
        session: session || undefined,
      }
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
      const aiApi = (window as any).aiApi
      if (!aiApi?.createConversation) {
        return {
          success: false,
          error: 'aiApi is not available in window context',
        }
      }

      const conversation = await aiApi.createConversation({
        sessionId: request.sessionId,
        title: request.title,
        assistantId: request.assistantId,
      })

      return {
        success: true,
        conversation,
      }
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
      const aiApi = (window as any).aiApi
      if (!aiApi?.getConversations) {
        return {
          success: false,
          error: 'aiApi is not available in window context',
        }
      }

      const conversations = await aiApi.getConversations(sessionId)
      return {
        success: true,
        conversations: conversations || [],
      }
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
      const aiApi = (window as any).aiApi
      if (!aiApi?.deleteConversation) {
        return {
          success: false,
          error: 'aiApi is not available in window context',
        }
      }

      await aiApi.deleteConversation(request.conversationId)
      return { success: true }
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
      const aiApi = (window as any).aiApi
      if (!aiApi?.sendMessage) {
        return {
          success: false,
          error: 'aiApi is not available in window context',
        }
      }

      const message = await aiApi.sendMessage(request.conversationId, request.content)
      return {
        success: true,
        message,
      }
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
      const aiApi = (window as any).aiApi
      if (!aiApi?.getMessages) {
        return {
          success: false,
          error: 'aiApi is not available in window context',
        }
      }

      const messages = await aiApi.getMessages(request.conversationId, {
        limit: request.limit,
        offset: request.offset,
      })

      return {
        success: true,
        messages: messages?.messages || [],
        total: messages?.total,
      }
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
    return true
  }
}
