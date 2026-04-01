/**
 * Agent 模块类型定义
 */

import type { TokenUsage, AgentRuntimeStatus } from '../../../shared/types'

export type { TokenUsage, AgentRuntimeStatus } from '../../../shared/types'

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** 最大工具调用轮数（防止无限循环） */
  maxToolRounds?: number
  /** 注入模型的历史消息上限（user+assistant） */
  contextHistoryLimit?: number
  /** 中止信号，用于取消执行 */
  abortSignal?: AbortSignal
}

/**
 * Agent 流式响应 chunk
 */
export interface AgentStreamChunk {
  /** chunk 类型 */
  type: 'content' | 'think' | 'tool_start' | 'tool_result' | 'status' | 'done' | 'error'
  /** 文本内容（type=content 时） */
  content?: string
  /** 思考标签名称（type=think 时） */
  thinkTag?: string
  /** 思考耗时（毫秒，type=think 时可选） */
  thinkDurationMs?: number
  /** 工具名称（type=tool_start/tool_result 时） */
  toolName?: string
  /** 工具调用参数（type=tool_start 时） */
  toolParams?: Record<string, unknown>
  /** 工具执行结果（type=tool_result 时） */
  toolResult?: unknown
  /** 错误信息（type=error 时） */
  error?: string
  /** 是否完成 */
  isFinished?: boolean
  /** Token 使用量（type=done 时返回累计值） */
  usage?: TokenUsage
  /** 运行状态（type=status 时返回） */
  status?: AgentRuntimeStatus
}

/**
 * Agent 执行结果
 */
export interface AgentResult {
  /** 最终文本响应 */
  content: string
  /** 使用的工具列表 */
  toolsUsed: string[]
  /** 工具调用轮数 */
  toolRounds: number
  /** 总 Token 使用量（累计所有 LLM 调用） */
  totalUsage?: TokenUsage
}

/**
 * 技能上下文（传递给 prompt-builder）
 * 手动选择和 AI 自选两种模式互斥
 */
export interface SkillContext {
  /** 手动选择时传入完整 SkillDef，AI 自选时为 undefined */
  skillDef?: import('../skills/types').SkillDef
  /** AI 自选时传入技能菜单文本，手动选择时为 undefined */
  skillMenu?: string
}
