import type { DatabaseAdapter } from '../interfaces/database-adapter'

export interface MessageMark {
  categories: string[]
  color: string
  comment: string
  updatedAt: number
}

export interface MessageMarkInput {
  categories: string[]
  color: string
  comment: string
}

export function getMessageMark(db: DatabaseAdapter, messageId: number): MessageMark | null {
  const row = db
    .prepare('SELECT categories, color, comment, updated_at AS updatedAt FROM message_mark WHERE message_id = ?')
    .get(messageId) as { categories: string; color: string; comment: string; updatedAt: number } | undefined
  if (!row) return null
  let categories: string[] = []
  try {
    const parsed = JSON.parse(row.categories)
    if (Array.isArray(parsed)) categories = parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    // Treat malformed user metadata as an empty category list.
  }
  return { ...row, categories }
}

export function saveMessageMark(db: DatabaseAdapter, messageId: number, input: MessageMarkInput): MessageMark | null {
  const categories = [...new Set(input.categories.map((category) => category.trim()).filter(Boolean))]
  const comment = input.comment.trim()
  const color = input.color.trim()
  if (!categories.length && !color && !comment) {
    db.prepare('DELETE FROM message_mark WHERE message_id = ?').run(messageId)
    return null
  }

  const updatedAt = Math.floor(Date.now() / 1000)
  db.prepare(
    `INSERT INTO message_mark (message_id, categories, color, comment, updated_at)
     SELECT id, ?, ?, ?, ? FROM message WHERE id = ?
     ON CONFLICT(message_id) DO UPDATE SET
       categories = excluded.categories,
       color = excluded.color,
       comment = excluded.comment,
       updated_at = excluded.updated_at`
  ).run(JSON.stringify(categories), color, comment, updatedAt, messageId)
  return getMessageMark(db, messageId)
}
