/**
 * Run: pnpm test -- src/pages/people/contacts/contacts-virtual-rows.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildContactVirtualRows } from './contacts-virtual-rows'
import type { ContactListItem } from '@openchatlab/shared-types'

function contact(key: string, pool: ContactListItem['pool']): ContactListItem {
  return {
    key,
    platform: 'weixin',
    platformId: key,
    sessionScoped: false,
    displayName: key,
    aliases: [],
    avatar: null,
    isFriend: pool === 'friend',
    pool,
    score: 1,
    scoreBreakdown: {},
    lastInteractionTs: null,
  }
}

test('appends the groupmate section after loaded friend rows in one continuous virtual list', () => {
  const rows = buildContactVirtualRows({
    friends: [contact('friend-a', 'friend')],
    groupmates: [contact('groupmate-a', 'non_friend')],
    showGroupSection: true,
    friendLoadingMore: false,
    groupmateLoadingMore: false,
  })

  assert.deepEqual(
    rows.map((row) => row.key),
    ['section:friend', 'friend-a', 'section:non_friend', 'groupmate-a']
  )
})

test('keeps the groupmate section hidden until the friend section is ready to hand off', () => {
  const rows = buildContactVirtualRows({
    friends: [contact('friend-a', 'friend')],
    groupmates: [contact('groupmate-a', 'non_friend')],
    showGroupSection: false,
    friendLoadingMore: false,
    groupmateLoadingMore: false,
  })

  assert.deepEqual(
    rows.map((row) => row.key),
    ['section:friend', 'friend-a']
  )
})
