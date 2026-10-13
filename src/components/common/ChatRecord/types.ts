/**
 * 聊天记录查看器类型定义
 */

import type { ChatRecordQuery, ChatRecordMessage } from '@/types/format'

// 重新导出类型
export type { ChatRecordQuery, ChatRecordMessage }

/**
 * 筛选表单数据
 */
export interface FilterFormData {
  /** 消息 ID */
  messageId: string
  /** 成员 ID */
  memberId: number | null
  /** 成员名称 */
  memberName: string
  /** 关键词（逗号分隔） */
  keywords: string
  /** 开始日期 */
  startDate: string
  /** 结束日期 */
  endDate: string
  /** 标记分类 */
  markCategories: string[]
  /** 标记颜色 */
  markColor: string
  /** 标记备注关键词 */
  markComment: string
}

/**
 * 筛选器更新事件
 */
export interface FilterUpdateEvent {
  query: ChatRecordQuery
  shouldReload: boolean
}
