/**
 * 聊天库消息区间读取适配器
 *
 * 为证据组装提供 [startId, endId] 闭区间原文。证据保留全部消息（含非文本），
 * 保证聊天真实性与可读性。ts 同样由秒转为毫秒，与 chunk 内时间口径一致。
 */

import type { DatabaseAdapter } from '@openchatlab/core'
import type { EvidenceMessage, MessageRangeReader } from '../retrieval/evidence'

const SELECT_RANGE = `
  SELECT msg.id AS id,
         msg.ts AS ts,
         msg.content AS content,
         msg.sender_id AS senderId,
         m.platform_id AS senderPlatformId,
         COALESCE(msg.sender_group_nickname, msg.sender_account_name, m.group_nickname, m.account_name, m.platform_id) AS senderName
  FROM message msg
  JOIN member m ON msg.sender_id = m.id
  WHERE msg.id >= ? AND msg.id <= ?
  ORDER BY msg.id ASC
`

interface RangeRow {
  id: number
  ts: number
  content: string | null
  senderId: number | null
  senderPlatformId: string | null
  senderName: string | null
}

export function createChatDbMessageRangeReader(db: DatabaseAdapter): MessageRangeReader {
  return {
    readRange(startId: number, endId: number): EvidenceMessage[] {
      const rows = db.prepare(SELECT_RANGE).all(startId, endId) as unknown as RangeRow[]
      return rows.map((r) => ({
        id: r.id,
        senderName: r.senderName ?? '',
        content: r.content ?? '',
        ts: r.ts * 1000,
        senderId: r.senderId ?? undefined,
        senderPlatformId: r.senderPlatformId ?? undefined,
      }))
    },
  }
}
