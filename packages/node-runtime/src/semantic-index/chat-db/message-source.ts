/**
 * 聊天库消息来源适配器
 *
 * 把聊天库的 message/member 表桥接为 warmup runner 需要的 SemanticMessageSource。
 *
 * 时间单位转换：聊天库 message.ts 以秒存储，而 chunker 按毫秒计算时间 gap
 * （gapMs = parentGapSeconds * 1000），故此处统一乘 1000 转为毫秒。
 */

import type { DatabaseAdapter } from '@openchatlab/core'
import type { ChunkSource } from '../chunker'
import type { SemanticMessageSource } from '../warmup/runner'

const SELECT_ALL_MESSAGES = `
  SELECT msg.id AS id,
         msg.ts AS ts,
         msg.type AS type,
         msg.content AS content,
         COALESCE(msg.sender_group_nickname, msg.sender_account_name, m.group_nickname, m.account_name, m.platform_id) AS senderName
  FROM message msg
  JOIN member m ON msg.sender_id = m.id
  ORDER BY msg.ts ASC, msg.id ASC
`

interface MessageRow {
  id: number
  ts: number
  type: number
  content: string | null
  senderName: string | null
}

export function createChatDbMessageSource(db: DatabaseAdapter, source: ChunkSource): SemanticMessageSource {
  return {
    getSource: () => source,
    countMessages: () => {
      const row = db.prepare('SELECT COUNT(*) AS c FROM message').get() as { c: number } | undefined
      return row?.c ?? 0
    },
    readAllMessages: () => {
      const rows = db.prepare(SELECT_ALL_MESSAGES).all() as unknown as MessageRow[]
      return rows.map((r) => ({
        id: r.id,
        senderName: r.senderName ?? '',
        content: r.content,
        ts: r.ts * 1000,
        type: r.type,
      }))
    },
  }
}
