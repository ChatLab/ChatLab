/**
 * 口头禅分析模块（平台无关）
 */

import { MessageType, type TimeFilter } from '@openchatlab/shared-types'
import type { DatabaseAdapter } from '../../interfaces'
import { isSystemMessageContent, stripVoiceTranscriptionPrefix } from '../../nlp'
import { buildTimeFilter } from '../filters'
import { isSystemPlaceholderContent } from './text-filters'

// Keep one-off voice transcription rows in the grouped query so JavaScript can
// normalize away duration labels before applying the repeated-phrase threshold.
const VOICE_TRANSCRIPTION_SQL = `
        TRIM(msg.content) LIKE '[语音] %' OR
        TRIM(msg.content) LIKE '[语音 %] %' OR
        TRIM(msg.content) LIKE '[Voice] %' OR
        TRIM(msg.content) LIKE '[Voice %] %' OR
        TRIM(msg.content) LIKE '[Audio] %' OR
        TRIM(msg.content) LIKE '[Audio %] %'
      `
const CATCHPHRASE_MESSAGE_TYPES = [MessageType.TEXT, MessageType.EMOJI].join(', ')

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
    whereClause += ` AND COALESCE(m.account_name, '') != '系统消息' AND msg.type IN (${CATCHPHRASE_MESSAGE_TYPES}) AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2`
  } else {
    whereClause = ` WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type IN (${CATCHPHRASE_MESSAGE_TYPES}) AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2`
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
      HAVING COUNT(*) >= 2 OR (${VOICE_TRANSCRIPTION_SQL})
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
  const phraseMaps = new Map<number, Map<string, CatchphraseItem>>()

  for (const row of rows) {
    const content = stripVoiceTranscriptionPrefix(row.content)
    if (!content || isSystemMessageContent(content) || isSystemPlaceholderContent(content)) continue

    if (!memberMap.has(row.memberId)) {
      memberMap.set(row.memberId, {
        memberId: row.memberId,
        platformId: row.platformId,
        name: row.name,
        catchphrases: [],
      })
    }

    let phrases = phraseMaps.get(row.memberId)
    if (!phrases) {
      phrases = new Map<string, CatchphraseItem>()
      phraseMaps.set(row.memberId, phrases)
    }
    const existing = phrases.get(content)
    if (existing) existing.count += Number(row.count)
    else phrases.set(content, { content, count: Number(row.count) })
  }

  const members = Array.from(memberMap.values())
  for (const member of members) {
    member.catchphrases = [...(phraseMaps.get(member.memberId)?.values() ?? [])]
      .filter((item) => item.count >= 2)
      .sort((a, b) => b.count - a.count || a.content.localeCompare(b.content))
      .slice(0, 100)
  }
  members.sort((a, b) => {
    const countDifference = (b.catchphrases[0]?.count ?? 0) - (a.catchphrases[0]?.count ?? 0)
    return countDifference || a.memberId - b.memberId
  })

  return { members: members.filter((member) => member.catchphrases.length > 0) }
}
