import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { formatMemberOption, mergeMemberPages } from './member-select-utils'
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
})
