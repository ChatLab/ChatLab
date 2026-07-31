import type { DatabaseAdapter, PreparedStatement } from '@openchatlab/core'

const MESSAGE_COLUMN_COUNT = 8
const SQLITE_LEGACY_VARIABLE_LIMIT = 999

/**
 * Keep each statement below SQLite's historical 999-variable limit.
 * Modern bundled SQLite builds allow more, but this conservative bound keeps
 * the shared DatabaseAdapter path compatible with older/runtime-specific builds.
 */
export const MESSAGE_INSERT_MAX_ROWS = Math.floor(SQLITE_LEGACY_VARIABLE_LIMIT / MESSAGE_COLUMN_COUNT)

export interface MessageInsertRow {
  senderId: number
  senderAccountName: string | null
  senderGroupNickname: string | null
  timestamp: number
  type: number
  content: string | null
  replyToMessageId: string | null
  platformMessageId: string | null
}

export class MessageBatchInserter {
  private readonly statementCache = new Map<number, PreparedStatement>()

  constructor(private readonly db: DatabaseAdapter) {}

  insert(rows: readonly MessageInsertRow[]): number {
    let statementCount = 0
    for (let offset = 0; offset < rows.length; offset += MESSAGE_INSERT_MAX_ROWS) {
      const batch = rows.slice(offset, offset + MESSAGE_INSERT_MAX_ROWS)
      const statement = this.getStatement(batch.length)
      statement.run(...batch.flatMap(toParams))
      statementCount++
    }
    return statementCount
  }

  private getStatement(rowCount: number): PreparedStatement {
    const cached = this.statementCache.get(rowCount)
    if (cached) return cached

    const values = Array.from({ length: rowCount }, () => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
    const statement = this.db.prepare(
      `INSERT INTO message (
         sender_id,
         sender_account_name,
         sender_group_nickname,
         ts,
         type,
         content,
         reply_to_message_id,
         platform_message_id
       ) VALUES ${values}`
    )
    this.statementCache.set(rowCount, statement)
    return statement
  }
}

function toParams(row: MessageInsertRow): unknown[] {
  return [
    row.senderId,
    row.senderAccountName,
    row.senderGroupNickname,
    row.timestamp,
    row.type,
    row.content,
    row.replyToMessageId,
    row.platformMessageId,
  ]
}
