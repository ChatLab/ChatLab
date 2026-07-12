import assert from 'node:assert/strict'
import test from 'node:test'
import { buildContactKey, shouldScopeContactToSession } from '../contact-identity'

const contact = {
  id: 2,
  platformId: 'alice',
  name: 'Alice',
  aliases: [],
  avatar: null,
}

test('builds platform-level contact keys for stable identities', () => {
  assert.equal(shouldScopeContactToSession('weixin', contact), false)
  assert.equal(buildContactKey('weixin', contact.platformId), 'weixin:alice')
})

test('scopes name-matched and QQ nickname identities to their session', () => {
  assert.equal(shouldScopeContactToSession('whatsapp', contact), true)
  assert.equal(shouldScopeContactToSession('qq', { ...contact, platformId: 'Alice' }), true)
  assert.equal(buildContactKey('whatsapp', contact.platformId, 'chat-1'), 'whatsapp:chat-1:alice')
})

test('rejects empty contact key parts', () => {
  assert.throws(() => buildContactKey('', 'alice'), /platform is required/)
  assert.throws(() => buildContactKey('weixin', '  '), /platformId is required/)
})
