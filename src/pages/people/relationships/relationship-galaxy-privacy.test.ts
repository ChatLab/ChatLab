/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-privacy.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { maskRelationshipGalaxyPrivateText, relationshipGalaxyPrivateAvatarText } from './relationship-galaxy-privacy'

test('masks Chinese names with two stars and the last Chinese character', () => {
  assert.equal(maskRelationshipGalaxyPrivateText('张小红'), '**红')
  assert.equal(maskRelationshipGalaxyPrivateText('王'), '**王')
  assert.equal(maskRelationshipGalaxyPrivateText('Alice 王'), '**王')
})

test('masks latin names by preserving the first and last character', () => {
  assert.equal(maskRelationshipGalaxyPrivateText('Alice'), 'A***e')
  assert.equal(maskRelationshipGalaxyPrivateText('alice.zhang'), 'a***g')
  assert.equal(maskRelationshipGalaxyPrivateText('wxid_8tvjn5yes4hi11'), 'w***1')
})

test('masks very short and empty relationship labels without revealing full names', () => {
  assert.equal(maskRelationshipGalaxyPrivateText('Li'), 'L***')
  assert.equal(maskRelationshipGalaxyPrivateText('A'), '*')
  assert.equal(maskRelationshipGalaxyPrivateText(''), '*')
  assert.equal(maskRelationshipGalaxyPrivateText('   '), '*')
})

test('uses a non-identifying avatar fallback in relationship privacy mode', () => {
  assert.equal(relationshipGalaxyPrivateAvatarText(), '*')
})
