/**
 * chart-interaction 插件类型定义
 * 互动关系图（@提及分析）所需的数据类型
 */

/** 成员信息（含消息数） */
export interface MemberInfo {
  id: number
  platformId: string
  name: string
  messageCount: number
}

/** 成员历史昵称 */
export interface NameHistory {
  memberId: number
  name: string
}

/** 包含 @ 的消息 */
export interface MentionMessage {
  senderId: number
  content: string
}

/** 关系图节点 */
export interface MentionGraphNode {
  id: number | string
  name: string
  value: number
  symbolSize: number
}

/** 关系图连线 */
export interface MentionGraphLink {
  source: string
  target: string
  value: number
}

/** 关系图完整数据 */
export interface MentionGraphData {
  nodes: MentionGraphNode[]
  links: MentionGraphLink[]
  maxLinkValue: number
}

/** ctx.db.compute 输入数据 */
export interface BuildGraphInput {
  members: MemberInfo[]
  nameHistory: NameHistory[]
  messages: MentionMessage[]
}
