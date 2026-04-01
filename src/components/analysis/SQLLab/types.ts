/**
 * SQL 实验室共享类型定义
 */

// Schema 类型
export interface TableSchema {
  name: string
  columns: ColumnSchema[]
}

export interface ColumnSchema {
  name: string
  type: string
  notnull: boolean
  pk: boolean
}

// AI 历史记录类型
export interface AIHistory {
  id: string
  prompt: string
  sql: string
  explanation: string
  timestamp: number
}

// SQL 执行结果类型
export interface SQLResult {
  columns: string[]
  rows: any[][]
  rowCount: number
  duration: number
  limited: boolean
}

// 表/列标签目前只维护中英文；其他 locale 先归一化后复用。
type LabelLocale = 'zh-CN' | 'en-US'

export const TABLE_LABELS: Record<LabelLocale, Record<string, string>> = {
  'zh-CN': {
    message: '消息记录',
    member: '成员',
    meta: '群信息',
    member_name_history: '昵称历史',
  },
  'en-US': {
    message: 'Messages',
    member: 'Members',
    meta: 'Chat Info',
    member_name_history: 'Nickname History',
  },
}

export const COLUMN_LABELS: Record<LabelLocale, Record<string, Record<string, string>>> = {
  'zh-CN': {
    message: {
      id: '消息ID',
      sender_id: '发送者ID',
      sender_account_name: '发送时账号名',
      sender_group_nickname: '发送时群昵称',
      ts: '时间戳(秒)',
      type: '消息类型',
      content: '消息内容',
    },
    member: {
      id: '成员ID',
      platform_id: '平台ID',
      account_name: '账号名称',
      group_nickname: '群昵称',
      aliases: '自定义别名',
    },
    meta: {
      name: '群名称',
      platform: '平台',
      type: '聊天类型',
      imported_at: '导入时间',
    },
    member_name_history: {
      id: '记录ID',
      member_id: '成员ID',
      name_type: '名称类型',
      name: '昵称值',
      start_ts: '开始时间',
      end_ts: '结束时间',
    },
  },
  'en-US': {
    message: {
      id: 'Message ID',
      sender_id: 'Sender ID',
      sender_account_name: 'Sender Account',
      sender_group_nickname: 'Sender Nickname',
      ts: 'Timestamp (sec)',
      type: 'Message Type',
      content: 'Content',
    },
    member: {
      id: 'Member ID',
      platform_id: 'Platform ID',
      account_name: 'Account Name',
      group_nickname: 'Group Nickname',
      aliases: 'Custom Aliases',
    },
    meta: {
      name: 'Chat Name',
      platform: 'Platform',
      type: 'Chat Type',
      imported_at: 'Imported At',
    },
    member_name_history: {
      id: 'Record ID',
      member_id: 'Member ID',
      name_type: 'Name Type',
      name: 'Nickname',
      start_ts: 'Start Time',
      end_ts: 'End Time',
    },
  },
}

// 获取表的标签
export function getTableLabel(tableName: string, locale: string = 'zh-CN'): string {
  return TABLE_LABELS[normalizeLabelLocale(locale)]?.[tableName] || tableName
}

// 获取列的标签
export function getColumnLabel(tableName: string, columnName: string, locale: string = 'zh-CN'): string {
  return COLUMN_LABELS[normalizeLabelLocale(locale)]?.[tableName]?.[columnName] || columnName
}

function normalizeLabelLocale(locale: string): LabelLocale {
  return locale.startsWith('zh') ? 'zh-CN' : 'en-US'
}
