import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { API_VERSION, QueryError, successEnvelope, errorEnvelope, exitCodeForError } from './envelope'

describe('successEnvelope', () => {
  const cases = [
    ['builds ok envelope with data, meta and apiVersion', 'messages.search', { text: 'hello' }, { totalHits: 3 }],
    ['does not emit an error key on success', 'sessions.list', { items: [] }, undefined],
  ] as const

  for (const [name, command, data, meta] of cases) {
    it(name, () => {
      const envelope = successEnvelope(command, data, meta)
      assert.equal(envelope.ok, true)
      assert.equal(envelope.command, command)
      assert.deepEqual(envelope.data, data)
      assert.equal('error' in envelope, false)
      assert.deepEqual(envelope.meta, { ...meta, apiVersion: API_VERSION })
    })
  }
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
  const cases = [
    ['maps argument-class errors to 2', ['INVALID_ARGUMENT', 'CURSOR_INVALID', 'RAW_DISABLED', 'SQL_DISABLED'], 2],
    ['maps not-found errors to 3', ['SESSION_NOT_FOUND', 'MEMBER_NOT_FOUND', 'SEGMENT_NOT_FOUND'], 3],
    ['maps ambiguity errors to 4', ['SESSION_AMBIGUOUS', 'MEMBER_AMBIGUOUS'], 4],
    ['maps SQL errors to 5', ['SQL_ERROR'], 5],
    ['maps unknown errors to 1', ['SOMETHING_ELSE'], 1],
  ] as const

  for (const [name, codes, expected] of cases) {
    it(name, () => {
      for (const code of codes) assert.equal(exitCodeForError(code), expected, code)
    })
  }
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
