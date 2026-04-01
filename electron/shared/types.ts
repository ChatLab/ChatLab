/**
 * Electron 主进程 / Preload / 渲染进程共享的 Agent 类型定义
 *
 * 此文件是 AgentRuntimeStatus、TokenUsage 等跨进程类型的唯一定义源。
 * 所有使用方应从此处导入，避免重复定义导致类型漂移。
 */

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AgentRuntimeStatus {
  phase: 'preparing' | 'thinking' | 'tool_running' | 'responding' | 'completed' | 'aborted' | 'error'
  round: number
  toolsUsed: number
  currentTool?: string
  contextTokens: number
  totalUsage: TokenUsage
  updatedAt: number
}
