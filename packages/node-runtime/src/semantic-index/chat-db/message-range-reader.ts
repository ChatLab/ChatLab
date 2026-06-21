/**
 * 聊天库消息区间读取适配器
 *
 * 为证据组装提供 parent 边界消息的闭区间原文。使用 (ts, id) 复合边界：
 * - ts 范围只精确到秒，同一秒可有多条消息；若只用 ts 边界，会纳入同秒的相邻 parent 消息
 * - (ts, id) 复合条件可精确到行，保证不跨 parent 越界
 * - 同时支持回填旧消息（高 id 但低 ts）后的正确读取
 * 结果按 ts, id 升序返回（与 chunker 排序一致）。证据保留全部消息（含非文本）。
 */

import type { DatabaseAdapter } from '@openchatlab/core'
import type { EvidenceMessage, MessageRangeReader } from '../retrieval/evidence'

const SELECT_RANGE = `
  WITH b AS (
    SELECT (SELECT ts FROM message WHERE id = ?) AS s_ts,
           (SELECT ts FROM message WHERE id = ?) AS e_ts
  )
  SELECT msg.id AS id,
         msg.ts AS ts,
         msg.content AS content,
         msg.sender_id AS senderId,
         m.platform_id AS senderPlatformId,
         COALESCE(msg.sender_group_nickname, msg.sender_account_name, m.group_nickname, m.account_name, m.platform_id) AS senderName
  FROM message msg
  JOIN member m ON msg.sender_id = m.id, b
  WHERE (msg.ts > b.s_ts OR (msg.ts = b.s_ts AND msg.id >= ?))
    AND (msg.ts < b.e_ts OR (msg.ts = b.e_ts AND msg.id <= ?))
  ORDER BY msg.ts ASC, msg.id ASC
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
      const rows = db.prepare(SELECT_RANGE).all(startId, endId, startId, endId) as unknown as RangeRow[]
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
