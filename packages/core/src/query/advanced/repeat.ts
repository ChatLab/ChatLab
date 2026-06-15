/**
 * 口头禅分析模块（平台无关）
 */

import type { TimeFilter } from '@openchatlab/shared-types'
import type { DatabaseAdapter } from '../../interfaces'
import { buildTimeFilter } from '../filters'
import { isSystemPlaceholderContent } from './text-filters'

export interface CatchphraseItem {
  content: string
  count: number
}

export interface MemberCatchphrase {
  memberId: number
  platformId: string
  name: string
  catchphrases: CatchphraseItem[]
}

export interface CatchphraseAnalysis {
  members: MemberCatchphrase[]
}

export function getCatchphraseAnalysis(db: DatabaseAdapter, filter?: TimeFilter): CatchphraseAnalysis {
  const { clause, params } = buildTimeFilter(filter)

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2"
  } else {
    whereClause =
      " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2"
  }

  const rows = db
    .prepare(
      `
      SELECT
        m.id as memberId,
        m.platform_id as platformId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
        TRIM(msg.content) as content,
        COUNT(*) as count
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
      GROUP BY m.id, TRIM(msg.content)
      ORDER BY m.id, count DESC
      `
    )
    .all(...params) as Array<{
    memberId: number
    platformId: string
    name: string
    content: string
    count: number
  }>

  const memberMap = new Map<number, MemberCatchphrase>()

  for (const row of rows) {
    if (isSystemPlaceholderContent(row.content)) continue

    if (!memberMap.has(row.memberId)) {
      memberMap.set(row.memberId, {
        memberId: row.memberId,
        platformId: row.platformId,
        name: row.name,
        catchphrases: [],
      })
    }

    const member = memberMap.get(row.memberId)!
    if (member.catchphrases.length < 100) {
      member.catchphrases.push({ content: row.content, count: row.count })
    }
  }

  const members = Array.from(memberMap.values())
  members.sort((a, b) => {
    const aTotal = a.catchphrases.reduce((sum, c) => sum + c.count, 0)
    const bTotal = b.catchphrases.reduce((sum, c) => sum + c.count, 0)
    return bTotal - aTotal
  })

  return { members }
}
