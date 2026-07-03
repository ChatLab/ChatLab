import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { messageTypeToString } from './message-type'

describe('messageTypeToString', () => {
  it('maps known numeric types to semantic strings', () => {
    assert.equal(messageTypeToString(0), 'text')
    assert.equal(messageTypeToString(1), 'image')
    assert.equal(messageTypeToString(2), 'voice')
    assert.equal(messageTypeToString(3), 'video')
    assert.equal(messageTypeToString(4), 'file')
    assert.equal(messageTypeToString(5), 'emoji')
    assert.equal(messageTypeToString(7), 'link')
    assert.equal(messageTypeToString(8), 'location')
    assert.equal(messageTypeToString(20), 'red_packet')
    assert.equal(messageTypeToString(21), 'transfer')
    assert.equal(messageTypeToString(22), 'poke')
    assert.equal(messageTypeToString(23), 'call')
    assert.equal(messageTypeToString(24), 'share')
    assert.equal(messageTypeToString(25), 'reply')
    assert.equal(messageTypeToString(26), 'forward')
    assert.equal(messageTypeToString(27), 'contact')
    assert.equal(messageTypeToString(80), 'system')
    assert.equal(messageTypeToString(81), 'recall')
    assert.equal(messageTypeToString(99), 'other')
  })

  it('falls back to other for unmapped values', () => {
    assert.equal(messageTypeToString(42), 'other')
    assert.equal(messageTypeToString(-1), 'other')
  })
})
