/**
 * chart-message 插件本地类型定义
 */

/** 消息类型枚举 */
export enum MessageType {
  TEXT = 0,
  IMAGE = 1,
  VOICE = 2,
  VIDEO = 3,
  FILE = 4,
  EMOJI = 5,
  LINK = 6,
  LOCATION = 7,
  RED_PACKET = 20,
  TRANSFER = 21,
  POKE = 22,
  CALL = 30,
  SHARE = 31,
  REPLY = 32,
  FORWARD = 33,
  CONTACT = 34,
  SYSTEM = 80,
  RECALL = 81,
  OTHER = 99,
}

/** 消息类型 i18n key 映射 */
const MESSAGE_TYPE_KEYS: Record<number, string> = {
  // 基础消息类型
  [MessageType.TEXT]: 'text',
  [MessageType.IMAGE]: 'image',
  [MessageType.VOICE]: 'voice',
  [MessageType.VIDEO]: 'video',
  [MessageType.FILE]: 'file',
  [MessageType.EMOJI]: 'emoji',
  [MessageType.LINK]: 'link',
  [MessageType.LOCATION]: 'location',
  // 交互消息类型
  [MessageType.RED_PACKET]: 'redPacket',
  [MessageType.TRANSFER]: 'transfer',
  [MessageType.POKE]: 'poke',
  [MessageType.CALL]: 'call',
  [MessageType.SHARE]: 'share',
  [MessageType.REPLY]: 'reply',
  [MessageType.FORWARD]: 'forward',
  [MessageType.CONTACT]: 'contact',
  // 系统消息类型
  [MessageType.SYSTEM]: 'system',
  [MessageType.RECALL]: 'recall',
  // 其他
  [MessageType.OTHER]: 'other',
}

/**
 * 获取消息类型名称
 * @param type 消息类型
 * @param t 可选的 i18n t 函数，传入时使用 common.messageType.* 键
 */
export function getMessageTypeName(type: MessageType | number, t?: (key: string) => string): string {
  const key = MESSAGE_TYPE_KEYS[type]
  if (t && key) return t(`common.messageType.${key}`)
  return t ? t('common.messageType.unknown') : '未知'
}

/** 小时活跃度 */
export interface HourlyActivity {
  hour: number
  messageCount: number
}

/** 日期活跃度 */
export interface DailyActivity {
  date: string
  messageCount: number
}

/** 星期活跃度 */
export interface WeekdayActivity {
  weekday: number
  messageCount: number
}

/** 月份活跃度 */
export interface MonthlyActivity {
  month: number
  messageCount: number
}

/** 年份活跃度 */
export interface YearlyActivity {
  year: number
  messageCount: number
}

/** 消息类型分布 */
export interface MessageTypeCount {
  type: number
  count: number
}

/** 消息长度分布 */
export interface LengthDistribution {
  detail: Array<{ len: number; count: number }>
  grouped: Array<{ range: string; count: number }>
}
