import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { API_VERSION, QueryError, successEnvelope, errorEnvelope, exitCodeForError } from './envelope'

describe('successEnvelope', () => {
  it('builds ok envelope with data, meta and apiVersion', () => {
    const envelope = successEnvelope('messages.search', { text: 'hello' }, { totalHits: 3 })

    assert.equal(envelope.ok, true)
    assert.equal(envelope.command, 'messages.search')
    assert.deepEqual(envelope.data, { text: 'hello' })
    assert.equal(envelope.meta.totalHits, 3)
    assert.equal(envelope.meta.apiVersion, API_VERSION)
  })

  it('does not emit an error key on success', () => {
    const envelope = successEnvelope('sessions.list', { items: [] })
    assert.equal('error' in envelope, false)
    assert.deepEqual(envelope.meta, { apiVersion: API_VERSION })
  })
})

describe('errorEnvelope', () => {
  it('builds error envelope without data/meta placeholders', () => {
    const envelope = errorEnvelope('messages.between', {
      code: 'MEMBER_AMBIGUOUS',
      message: "Member name '小红' matches 2 members",
      hint: 'Retry with --member <id>',
      candidates: [{ id: 5, name: '小红', messages: 812 }],
    })

    assert.equal(envelope.ok, false)
    assert.equal(envelope.command, 'messages.between')
    assert.equal(envelope.error.code, 'MEMBER_AMBIGUOUS')
    assert.equal(envelope.error.hint, 'Retry with --member <id>')
    assert.equal(envelope.error.candidates?.length, 1)
    assert.equal('data' in envelope, false)
    assert.equal('meta' in envelope, false)
  })

  it('omits hint and candidates when absent', () => {
    const envelope = errorEnvelope('sql', { code: 'SQL_ERROR', message: 'syntax error' })
    assert.equal('hint' in envelope.error, false)
    assert.equal('candidates' in envelope.error, false)
  })

  it('accepts a QueryError instance', () => {
    const err = new QueryError({ code: 'SESSION_NOT_FOUND', message: 'Session x not found', hint: 'Run sessions list' })
    const envelope = errorEnvelope('sessions.show', err)
    assert.equal(envelope.error.code, 'SESSION_NOT_FOUND')
    assert.equal(envelope.error.message, 'Session x not found')
    assert.equal(envelope.error.hint, 'Run sessions list')
  })
})

describe('exitCodeForError', () => {
  it('maps argument-class errors to 2', () => {
    assert.equal(exitCodeForError('INVALID_ARGUMENT'), 2)
    assert.equal(exitCodeForError('CURSOR_INVALID'), 2)
    assert.equal(exitCodeForError('RAW_DISABLED'), 2)
    assert.equal(exitCodeForError('SQL_DISABLED'), 2)
  })

  it('maps not-found errors to 3', () => {
    assert.equal(exitCodeForError('SESSION_NOT_FOUND'), 3)
    assert.equal(exitCodeForError('MEMBER_NOT_FOUND'), 3)
    assert.equal(exitCodeForError('SEGMENT_NOT_FOUND'), 3)
  })

  it('maps ambiguity errors to 4', () => {
    assert.equal(exitCodeForError('SESSION_AMBIGUOUS'), 4)
    assert.equal(exitCodeForError('MEMBER_AMBIGUOUS'), 4)
  })

  it('maps SQL errors to 5 and unknown codes to 1', () => {
    assert.equal(exitCodeForError('SQL_ERROR'), 5)
    assert.equal(exitCodeForError('SOMETHING_ELSE'), 1)
  })
})

describe('QueryError', () => {
  it('carries code, hint and candidates', () => {
    const err = new QueryError({
      code: 'MEMBER_AMBIGUOUS',
      message: 'ambiguous',
      candidates: [{ id: 1 }],
    })
    assert.ok(err instanceof Error)
    assert.equal(err.code, 'MEMBER_AMBIGUOUS')
    assert.deepEqual(err.candidates, [{ id: 1 }])
  })
})
