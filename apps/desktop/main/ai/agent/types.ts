/**
 * Agent 模块类型定义
 */

import type { TokenUsage } from '@openchatlab/node-runtime'
import type { SerializedErrorInfo } from '../../../shared/types'
import type { ThinkingLevel } from '@openchatlab/core'
import type { ChartAutoMode } from '@openchatlab/shared-types'

export type { TokenUsage, AgentRuntimeStatus } from '@openchatlab/node-runtime'
export type { SerializedErrorInfo }

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** 最大工具调用轮数（防止无限循环） */
  maxToolRounds?: number
  /** 中止信号，用于取消执行 */
  abortSignal?: AbortSignal
  /** Override thinking level for this request; clamped to what the model supports. */
  thinkingLevel?: ThinkingLevel
  /** Controls how aggressively chart capability is exposed for automatic use. */
  chartAutoMode?: ChartAutoMode
}

/**
 * Agent stream chunk — re-exported from shared, used by Electron IPC layer.
 */
export type { AgentStreamChunk } from '@openchatlab/node-runtime'

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
  /** 结构化错误信息（请求失败时） */
  error?: SerializedErrorInfo
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
