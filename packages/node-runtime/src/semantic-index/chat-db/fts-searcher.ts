/**
 * 聊天库 FTS 检索适配器
 *
 * 把自然语言 query 用 jieba 分词成关键词，作为多关键词传入 searchByFts
 * （多关键词以 OR 组合，最大化召回；精度由 dense 路与 RRF 融合保证）。
 * 返回按 FTS rank 排序的 message_id。
 */

import type { DatabaseAdapter } from '@openchatlab/core'
import { searchByFts } from '../../fts'
import { getJieba } from '../../nlp/segmenter'
import type { FtsSearcher } from '../retrieval/hybrid-search'

/** 自然语言 query -> 去重关键词列表 */
export function extractFtsKeywords(query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  try {
    const tokens = getJieba()
      .cut(trimmed, false)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    return [...new Set(tokens)]
  } catch {
    return [...new Set(trimmed.split(/\s+/).filter((t) => t.length > 0))]
  }
}

export function createChatDbFtsSearcher(db: DatabaseAdapter): FtsSearcher {
  return {
    search(query: string, topN: number): Array<{ id: number; ts: number }> {
      const keywords = extractFtsKeywords(query)
      if (keywords.length === 0) return []
      const { rowids } = searchByFts(db, keywords, topN, 0)
      if (rowids.length === 0) return []
      const placeholders = rowids.map(() => '?').join(', ')
      const tsRows = db.prepare(`SELECT id, ts FROM message WHERE id IN (${placeholders})`).all(...rowids) as Array<{
        id: number
        ts: number
      }>
      const tsById = new Map(tsRows.map((r) => [r.id, r.ts * 1000]))
      return rowids.flatMap((id) => {
        const ts = tsById.get(id)
        return ts !== undefined ? [{ id, ts }] : []
      })
    },
  }
}
