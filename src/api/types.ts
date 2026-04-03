/**
 * API Client Abstraction Layer - Type Definitions
 * Defines interfaces for both IPC and HTTP based API clients
 */

// ==================== Authentication Types ====================

export interface AuthCredentials {
  username: string
  password: string
}

export interface AuthToken {
  token: string
  expiresAt: number
}

export interface AuthResponse {
  success: boolean
  token?: string
  expiresAt?: number
  error?: string
}

export interface LogoutResponse {
  success: boolean
  error?: string
}

// ==================== AI Dialog Types ====================

export interface AIMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface AIConversation {
  id: string
  sessionId: string
  title: string | null
  assistantId: string
  createdAt: number
  updatedAt: number
}

export interface CreateConversationRequest {
  sessionId: string
  title?: string
  assistantId?: string
}

export interface CreateConversationResponse {
  success: boolean
  conversation?: AIConversation
  error?: string
}

export interface SendMessageRequest {
  conversationId: string
  content: string
}

export interface SendMessageResponse {
  success: boolean
  message?: AIMessage
  error?: string
}

export interface GetMessagesRequest {
  conversationId: string
  limit?: number
  offset?: number
}

export interface GetMessagesResponse {
  success: boolean
  messages?: AIMessage[]
  total?: number
  error?: string
}

// ==================== Session Types ====================

export interface AnalysisSession {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface ListSessionsResponse {
  success: boolean
  sessions?: AnalysisSession[]
  error?: string
}

export interface GetSessionResponse {
  success: boolean
  session?: AnalysisSession
  error?: string
}

// ==================== Conversation Management ====================

export interface ListConversationsResponse {
  success: boolean
  conversations?: AIConversation[]
  error?: string
}

export interface DeleteConversationRequest {
  conversationId: string
}

export interface DeleteConversationResponse {
  success: boolean
  error?: string
}

// ==================== Error Response ====================

export interface ErrorResponse {
  success: false
  error: string
}

// ==================== API Client Interface ====================

/**
 * Unified API client interface
 * Implementations: ElectronClient (IPC), HttpClient (HTTP)
 */
export interface IApiClient {
  // Authentication
  login(credentials: AuthCredentials): Promise<AuthResponse>
  logout(): Promise<LogoutResponse>
  isAuthenticated(): Promise<boolean>
  getToken(): Promise<string | null>

  // Session Management
  listSessions(): Promise<ListSessionsResponse>
  getSession(sessionId: string): Promise<GetSessionResponse>

  // Conversation Management
  createConversation(request: CreateConversationRequest): Promise<CreateConversationResponse>
  listConversations(sessionId: string): Promise<ListConversationsResponse>
  deleteConversation(request: DeleteConversationRequest): Promise<DeleteConversationResponse>

  // AI Dialog
  sendMessage(request: SendMessageRequest): Promise<SendMessageResponse>
  getMessages(request: GetMessagesRequest): Promise<GetMessagesResponse>

  // Utilities
  isElectron(): boolean
  setToken(token: string, expiresAt: number): void
  clearToken(): void
}
