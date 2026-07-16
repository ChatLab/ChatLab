import type { TimeFilter } from '@openchatlab/shared-types'
import type { ChatRecordQuery } from '@/types/format'

export function buildCatchphraseRecordQuery(content: string, timeFilter?: TimeFilter): ChatRecordQuery {
  return {
    keywords: [content],
    ...(timeFilter?.memberId != null ? { memberId: timeFilter.memberId } : {}),
  }
}
