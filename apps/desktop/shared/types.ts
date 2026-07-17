/**
 * Electron 主进程 / Preload / 渲染进程共享的 Agent 类型定义
 *
 * 此文件是 AgentRuntimeStatus、TokenUsage 等跨进程类型的唯一定义源。
 * 所有使用方应从此处导入，避免重复定义导致类型漂移。
 */

/**
 * 序列化后的结构化错误信息，跨进程传输 & 持久化存储。
 * 所有字段可选——仅在原始错误中存在时才填充。
 */
export interface SerializedErrorInfo {
  name: string | null
  message: string | null
  stack: string | null
  statusCode?: number | null
  url?: string | null
  responseBody?: string | null
  responseHeaders?: Record<string, string> | null
  requestBody?: string | null
  cause?: string | null
  provider?: string | null
  /** formatAIError 生成的用户友好摘要 */
  friendlyMessage?: string | null
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface AgentRuntimeStatus {
  phase: 'compressing' | 'preparing' | 'thinking' | 'tool_running' | 'responding' | 'completed' | 'aborted' | 'error'
  round: number
  toolsUsed: number
  currentTool?: string
  contextTokens: number
  totalUsage: TokenUsage
  updatedAt: number
}

export type AppLockState = 'unlocked' | 'locked'

export type AppLockErrorCode =
  | 'busy'
  | 'locked'
  | 'disabled'
  | 'invalid-pin'
  | 'password-already-set'
  | 'password-not-set'
  | 'same-password'
  | 'wrong-password'
  | 'too-many-attempts'
  | 'save-failed'
  | 'invalid-config'
  | 'internal-error'

export interface AppLockConfig {
  enabled: boolean
  idleTimeoutMinutes: number
  lockOnStartup: boolean
}

export interface AppLockConfigUpdate {
  idleTimeoutMinutes?: number
  lockOnStartup?: boolean
}

export interface AppLockResult {
  success: boolean
  error?: AppLockErrorCode
}

export interface AppLockUnlockResult extends AppLockResult {
  wrongPassword?: boolean
  retryAfterSeconds?: number
}

export interface SecurityApi {
  getConfig: () => Promise<AppLockConfig>
  getState: () => Promise<AppLockState>
  lock: () => Promise<AppLockResult>
  unlock: (password: string) => Promise<AppLockUnlockResult>
  setPassword: (newPassword: string) => Promise<AppLockResult>
  changePassword: (oldPassword: string, newPassword: string) => Promise<AppLockResult>
  resetPassword: () => Promise<AppLockResult>
  updateConfig: (updates: AppLockConfigUpdate) => Promise<AppLockResult & { config?: AppLockConfig }>
  onLockStateChanged: (callback: (locked: boolean) => void) => () => void
}
