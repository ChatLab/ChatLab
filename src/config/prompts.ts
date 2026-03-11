/**
 * AI 提示词统一配置
 *
 * 本文件集中管理所有 AI 提示词相关的配置：
 * - 内置预设定义（统一版本，不再区分群聊/私聊）
 * - 默认系统提示词
 * - 锁定部分说明（用于前端预览）
 *
 * 注意：群聊/私聊的差异化内容（如成员查询策略）由后端 agent.ts 根据运行时 chatType 自动处理。
 */

import type { PromptPreset } from '@/types/ai'

// ==================== 类型定义 ====================

export type LocaleType = 'zh-CN' | 'en-US' | 'zh-TW' | 'ja-JP'

// ==================== 国际化内容配置 ====================

const i18nContent = {
  'zh-CN': {
    presetName: '默认分析助手',
    systemPrompt: `你是一个专业但风格轻松的聊天记录分析助手。
你的任务是帮助用户理解和分析他们的聊天记录数据，同时可以适度使用 B 站/网络热梗和表情/颜文字活跃气氛，但不影响结论的准确性。

## 回答要求
1. 基于工具返回的数据回答，不要编造信息
2. 如果数据不足以回答问题，请说明
3. 回答要简洁明了，使用 Markdown 格式
4. 可以引用具体的发言作为证据
5. 对于统计数据，可以适当总结趋势和特点
6. 可以适度加入 B 站/网络热梗、表情/颜文字（强度适中）
7. 玩梗不得影响事实准确与结论清晰，避免低俗或冒犯性表达`,
    lockedSection: {
      chatContext: {
        group: '群聊',
        private: '对话',
      },
      ownerNoteTemplate: (displayName: string, chatContext: string) =>
        `当前用户身份：
- 用户在${chatContext}中的身份是「${displayName}」
- 当用户提到"我"、"我的"时，指的就是「${displayName}」
- 查询"我"的发言时，使用 sender_id 参数筛选该成员
`,
      memberNote: {
        group: `成员查询策略：
- 当用户提到特定群成员（如"张三说过什么"、"小明的发言"等）时，应先调用 get_members 获取成员列表
- 群成员有三种名称：accountName（原始昵称）、groupNickname（群昵称）、aliases（用户自定义别名）
- 通过 get_members 的 search 参数可以模糊搜索这三种名称
- 找到成员后，使用其 id 字段作为 search_messages 的 sender_id 参数来获取该成员的发言`,
        private: `成员查询策略：
- 私聊只有两个人，可以直接获取成员列表
- 当用户提到"对方"、"他/她"时，通过 get_members 获取另一方信息`,
      },
      currentDatePrefix: '当前日期是',
      timeParamsTemplate: (year: number, prevYear: number) =>
        `时间参数：按用户提到的精度组合 year/month/day/hour
- "10月" → year: ${year}, month: 10
- "10月1号" → year: ${year}, month: 10, day: 1
- "10月1号下午3点" → year: ${year}, month: 10, day: 1, hour: 15
未指定年份默认${year}年，若该月份未到则用${prevYear}年`,
      conclusion: '根据用户的问题，选择合适的工具获取数据，然后基于数据给出回答。',
    },
  },
  'en-US': {
    presetName: 'Default Analysis Assistant',
    systemPrompt: `You are a professional chat analysis assistant.
Your task is to help users understand and analyze their chat records.

## Response Requirements
1. Answer based on data returned by tools, do not fabricate information
2. If data is insufficient to answer the question, explain
3. Keep answers concise and clear, use Markdown format
4. Quote specific messages as evidence when possible
5. For statistics, summarize trends and characteristics appropriately`,
    lockedSection: {
      chatContext: {
        group: 'group chat',
        private: 'conversation',
      },
      ownerNoteTemplate: (displayName: string, chatContext: string) =>
        `Current user identity:
- The user's identity in the ${chatContext} is "${displayName}"
- When the user mentions "I" or "my", it refers to "${displayName}"
- When querying "my" messages, use sender_id parameter to filter by this member
`,
      memberNote: {
        group: `Member query strategy:
- When the user mentions a specific group member (e.g., "what did John say", "Mary's messages"), first call get_members to get the member list
- Group members have three name types: accountName (original nickname), groupNickname (group nickname), aliases (user-defined aliases)
- Use the search parameter of get_members to fuzzy search across all three name types
- After finding the member, use their id field as the sender_id parameter for search_messages to get their messages`,
        private: `Member query strategy:
- Private chats have only two people, you can directly get the member list
- When the user mentions "the other person" or "he/she", use get_members to get the other party's information`,
      },
      currentDatePrefix: 'The current date is',
      timeParamsTemplate: (year: number, prevYear: number) =>
        `Time parameters: Combine year/month/day/hour based on user's specified precision
- "October" → year: ${year}, month: 10
- "October 1st" → year: ${year}, month: 10, day: 1
- "October 1st 3pm" → year: ${year}, month: 10, day: 1, hour: 15
Default to ${year} if year not specified, use ${prevYear} if the month hasn't arrived yet`,
      conclusion:
        "Based on the user's question, select appropriate tools to retrieve data, then provide an answer based on the data.",
    },
  },
}

// ==================== 预设 ID 常量 ====================

/** 默认预设ID */
export const DEFAULT_PRESET_ID = 'builtin-default'

/** @deprecated 使用 DEFAULT_PRESET_ID 代替 */
export const DEFAULT_GROUP_PRESET_ID = DEFAULT_PRESET_ID
/** @deprecated 使用 DEFAULT_PRESET_ID 代替 */
export const DEFAULT_PRIVATE_PRESET_ID = DEFAULT_PRESET_ID

// ==================== 默认提示词内容 ====================

/**
 * 获取默认系统提示词
 * @param locale 语言设置
 */
export function getDefaultSystemPrompt(locale: LocaleType = 'zh-CN'): string {
  const content = i18nContent[locale] || i18nContent['zh-CN']
  return content.systemPrompt
}

/** @deprecated 使用 getDefaultSystemPrompt 代替 */
export function getDefaultRoleDefinition(locale: LocaleType = 'zh-CN'): string {
  return getDefaultSystemPrompt(locale)
}

/** @deprecated responseRules 已合并到 systemPrompt */
export function getDefaultResponseRules(locale: LocaleType = 'zh-CN'): string {
  return ''
}

/**
 * 获取内置预设名称
 * @param locale 语言设置
 */
export function getBuiltinPresetName(locale: LocaleType = 'zh-CN'): string {
  const content = i18nContent[locale] || i18nContent['zh-CN']
  return content.presetName
}

// ==================== 内置预设定义 ====================

/**
 * 获取内置预设列表
 * @param locale 语言设置
 */
export function getBuiltinPresets(locale: LocaleType = 'zh-CN'): PromptPreset[] {
  const now = Date.now()

  const BUILTIN_DEFAULT: PromptPreset = {
    id: DEFAULT_PRESET_ID,
    name: getBuiltinPresetName(locale),
    systemPrompt: getDefaultSystemPrompt(locale),
    isBuiltIn: true,
    createdAt: now,
    updatedAt: now,
  }

  return [BUILTIN_DEFAULT]
}

/** 所有内置预设（原始版本，用于重置）- 默认中文 */
export const BUILTIN_PRESETS: PromptPreset[] = getBuiltinPresets('zh-CN')

/**
 * 获取内置预设的原始版本（用于重置）
 * @param presetId 预设ID
 * @param locale 语言设置
 */
export function getOriginalBuiltinPreset(presetId: string, locale: LocaleType = 'zh-CN'): PromptPreset | undefined {
  const presets = getBuiltinPresets(locale)
  return presets.find((p) => p.id === presetId)
}

// ==================== 锁定部分预览（仅用于前端展示） ====================

/** Owner 信息（用于前端预览） */
export interface OwnerInfoPreview {
  displayName: string
}

/**
 * 获取锁定部分的提示词预览
 * 注意：实际执行时由主进程 agent.ts 生成，包含动态日期和差异化内容
 *
 * @param chatType 聊天类型（用于展示对应的成员策略）
 * @param ownerInfo Owner 信息（可选，用于预览时显示）
 * @param locale 语言设置
 */
export function getLockedPromptSectionPreview(
  chatType: 'group' | 'private' = 'group',
  ownerInfo?: OwnerInfoPreview,
  locale: LocaleType = 'zh-CN'
): string {
  const contentKey = locale.startsWith('zh') ? 'zh-CN' : 'en-US'
  const content = i18nContent[contentKey] || i18nContent['zh-CN']
  const now = new Date()

  const dateLocale = locale.startsWith('zh') ? 'zh-CN' : locale === 'ja-JP' ? 'ja-JP' : 'en-US'
  const currentDate = now.toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  const chatContext = content.lockedSection.chatContext[chatType]
  const ownerNote = ownerInfo ? content.lockedSection.ownerNoteTemplate(ownerInfo.displayName, chatContext) : ''
  const memberNote = content.lockedSection.memberNote[chatType]
  const year = now.getFullYear()
  const prevYear = year - 1

  return `${content.lockedSection.currentDatePrefix} ${currentDate}。
${ownerNote}
${memberNote}

${content.lockedSection.timeParamsTemplate(year, prevYear)}

${content.lockedSection.conclusion}`
}

/**
 * 构建完整提示词预览（用于前端展示）
 * @param systemPrompt 系统提示词
 * @param chatType 聊天类型（用于展示对应的锁定部分）
 * @param ownerInfo Owner 信息（可选）
 * @param locale 语言设置
 */
export function buildPromptPreview(
  systemPrompt: string,
  chatType: 'group' | 'private' = 'group',
  ownerInfo?: OwnerInfoPreview,
  locale: LocaleType = 'zh-CN'
): string {
  const lockedSection = getLockedPromptSectionPreview(chatType, ownerInfo, locale)

  return `${systemPrompt}

${lockedSection}`
}
