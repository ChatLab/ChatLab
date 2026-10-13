import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CHAT_DB_TABLES } from '../../schema'
import { getMessageMark, saveMessageMark } from '../message-mark'
import { SqliteTestAdapter } from './sqlite-test-adapter'

function createMessage() {
  const db = new SqliteTestAdapter()
  db.exec(CHAT_DB_TABLES)
  const memberId = Number(db.prepare('INSERT INTO member (platform_id) VALUES (?)').run('alice').lastInsertRowid)
  const messageId = Number(
    db.prepare('INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, ?, ?)').run(memberId, 1, 0, 'hello')
      .lastInsertRowid
  )
  return { db, messageId }
}

describe('message marks', () => {
  it('creates, updates, and removes one mark per message', () => {
    const { db, messageId } = createMessage()

    const created = saveMessageMark(db, messageId, {
      categories: [' Favorite ', 'Work', 'Favorite'],
      color: 'rose',
      comment: ' Note ',
    })
    assert.deepEqual(created && { ...created, updatedAt: 0 }, {
      categories: ['Favorite', 'Work'],
      color: 'rose',
      comment: 'Note',
      updatedAt: 0,
    })
    assert.deepEqual(getMessageMark(db, messageId)?.categories, ['Favorite', 'Work'])

    const categoryOnly = saveMessageMark(db, messageId, { categories: ['Favorite'], color: '', comment: '' })
    assert.deepEqual(categoryOnly?.categories, ['Favorite'])

    const colorOnly = saveMessageMark(db, messageId, { categories: [], color: 'blue', comment: '' })
    assert.equal(colorOnly?.color, 'blue')

    const commentOnly = saveMessageMark(db, messageId, { categories: [], color: '', comment: 'Remember this' })
    assert.equal(commentOnly?.comment, 'Remember this')

    assert.equal(saveMessageMark(db, messageId, { categories: [], color: '', comment: '' }), null)
    assert.equal(getMessageMark(db, messageId), null)
    db.close()
  })

  it('does not create a mark for a missing message', () => {
    const { db } = createMessage()
    assert.equal(saveMessageMark(db, 999, { categories: ['Favorite'], color: '', comment: '' }), null)
    db.close()
  })
})
