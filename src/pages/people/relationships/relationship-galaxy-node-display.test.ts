import assert from 'node:assert/strict'
import test from 'node:test'
import type { PeopleRelationshipGraphNode } from '@openchatlab/shared-types'
import {
  getRelationshipGalaxyNodeAvatarSrc,
  getRelationshipGalaxyNodeAvatarText,
  getRelationshipGalaxyNodeDisplayName,
  getRelationshipGalaxyNodePlatformIdentity,
} from './relationship-galaxy-node-display'

const node = {
  key: 'wechat:alice',
  kind: 'contact',
  platformId: 'alice',
  displayName: 'Alice',
} as PeopleRelationshipGraphNode

test('uses masked relationship details for canvas privacy presentation', () => {
  assert.equal(getRelationshipGalaxyNodeDisplayName(node, { privacyMode: true, ownerLabel: 'Me' }), 'A***e')
  assert.equal(getRelationshipGalaxyNodeDisplayName(node, { privacyMode: false, ownerLabel: 'Me' }), 'Alice')
  assert.equal(getRelationshipGalaxyNodeAvatarText(node, { privacyMode: true, ownerLabel: 'M' }), '*')
  assert.equal(getRelationshipGalaxyNodeAvatarSrc({ ...node, avatar: 'https://example.test/alice.png' }, true), null)
  assert.equal(getRelationshipGalaxyNodePlatformIdentity(node, true), 'a***e')
  assert.equal(
    getRelationshipGalaxyNodeDisplayName(
      { ...node, kind: 'owner', displayName: 'Private Owner Name' },
      { privacyMode: true, ownerLabel: 'Me' }
    ),
    'Me'
  )
})
