import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { filterAndSortMembers, formatMemberOption, mergeMemberPages, nextMemberSortOrder } from './member-select-utils'
import type { MemberWithStats } from '@/types/analysis'

function member(overrides: Partial<MemberWithStats>): MemberWithStats {
  return {
    id: 1,
    platformId: 'member_1',
    accountName: null,
    groupNickname: null,
    aliases: [],
    messageCount: 0,
    avatar: null,
    ...overrides,
  }
}

describe('member select utils', () => {
  it('formats the best display name and searchable secondary text', () => {
    const option = formatMemberOption(
      member({
        groupNickname: '群昵称',
        accountName: '账号名',
        platformId: 'platform_1',
        aliases: ['别名A', '别名B'],
        messageCount: 42,
      })
    )

    assert.equal(option.label, '群昵称')
    assert.equal(option.secondary, '别名A、别名B · 账号名 · platform_1')
    assert.equal(option.messageCount, 42)
  })

  it('deduplicates members when appending paginated results', () => {
    const firstPage = [member({ id: 1, groupNickname: 'A' }), member({ id: 2, groupNickname: 'B' })]
    const nextPage = [member({ id: 2, groupNickname: 'B updated' }), member({ id: 3, groupNickname: 'C' })]

    const merged = mergeMemberPages(firstPage, nextPage)

    assert.deepEqual(
      merged.map((item) => [item.id, item.groupNickname]),
      [
        [1, 'A'],
        [2, 'B updated'],
        [3, 'C'],
      ]
    )
  })

  it('filters every searchable member field and keeps tied counts in a deterministic order', () => {
    const members = [
      member({ id: 3, platformId: 'charlie-id', accountName: 'Charlie', aliases: ['摄影师'], messageCount: 10 }),
      member({ id: 1, platformId: 'alice-id', groupNickname: 'Alice', aliases: ['小爱'], messageCount: 10 }),
      member({ id: 2, platformId: 'bob-id', accountName: 'Bob', aliases: ['咖啡师'], messageCount: 5 }),
    ]

    assert.deepEqual(
      filterAndSortMembers(members, '', 'desc').map((item) => item.id),
      [1, 3, 2]
    )
    assert.deepEqual(
      filterAndSortMembers(members, '', 'asc').map((item) => item.id),
      [2, 1, 3]
    )
    assert.deepEqual(
      filterAndSortMembers(members, '', null).map((item) => item.id),
      [3, 1, 2],
      'default sorting should preserve the server order'
    )
    assert.deepEqual(
      filterAndSortMembers(members, '摄影', 'desc').map((item) => item.id),
      [3]
    )
    assert.deepEqual(
      filterAndSortMembers(members, 'ALICE-ID', 'desc').map((item) => item.id),
      [1]
    )
    assert.deepEqual(
      members.map((item) => item.id),
      [3, 1, 2],
      'sorting should not mutate the loaded member list'
    )
  })

  it('cycles message count sorting like the data management table', () => {
    assert.equal(nextMemberSortOrder('desc'), null)
    assert.equal(nextMemberSortOrder(null), 'asc')
    assert.equal(nextMemberSortOrder('asc'), 'desc')
  })
})
