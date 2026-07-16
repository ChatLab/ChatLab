/**
 * AI 模块共享类型（助手、技能的解析结构）
 *
 * 与 Electron 端 types.ts 的同名接口结构一致（TypeScript 结构类型兼容）。
 */

export interface AssistantConfig {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  allowedBuiltinTools?: string[]
  builtinId?: string
  /** Builtin template version this config was based on, used only for safe upgrades. */
  builtinVersion?: number
  /** Digest of the source builtin template; remains unchanged after user edits. */
  builtinDigest?: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

export interface AssistantSummary {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  builtinId?: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

export interface SkillDef {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  prompt: string
  tools: string[]
  builtinId?: string
}

export interface SkillSummary {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  tools: string[]
  builtinId?: string
}
