/**
 * ChatLab AI 相关类型定义
 * 包含：提示词预设、AI 配置
 */

// ==================== AI 提示词预设 ====================

/**
 * 预设适用的聊天类型
 * - 'group': 仅群聊
 * - 'private': 仅私聊
 * - 'common': 通用（群聊和私聊都适用）
 */
export type PresetApplicableType = 'group' | 'private' | 'common'

/**
 * AI 提示词预设
 *
 * applicableTo 表示预设适用的场景：
 * - 'common' 表示群聊和私聊都适用（默认）
 * - 'group' 表示仅群聊
 * - 'private' 表示仅私聊
 *
 * 后端会根据运行时的 chatType 自动处理差异化内容（如成员查询策略）。
 */
export interface PromptPreset {
  id: string
  name: string // 预设名称
  systemPrompt: string // 系统提示词（角色定义 + 回答要求，统一为单一字段）
  isBuiltIn: boolean // 是否内置（内置不可删除）
  applicableTo?: PresetApplicableType // 适用场景，默认 'common'
  createdAt: number
  updatedAt: number
}

/**
 * AI 提示词配置（激活的预设）
 */
export interface AIPromptSettings {
  activePresetId: string // 当前激活的预设ID
}

// ==================== 兼容旧版本 ====================

/**
 * @deprecated 使用 PresetApplicableType 代替
 */
export type PromptPresetChatType = 'group' | 'private'
