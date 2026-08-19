/**
 * Run: pnpm test -- src/utils/rankAvatars.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachRankAvatars,
  buildRankAvatarIndex,
  buildRankAvatarMap,
  buildRankAvatarNameMap,
  chartSafeAvatarSrc,
  clipAvatarToCircle,
  getRankAvatarText,
  resolveRankAvatar,
} from './rankAvatars'

test('buildRankAvatarMap keeps ids and drops empty avatars', () => {
  const map = buildRankAvatarMap([
    { id: 1, avatar: 'https://a.png' },
    { id: 2, avatar: '  ' },
    { id: 3, avatar: null },
    { id: 4 },
  ])

  assert.equal(map.get(1), 'https://a.png')
  assert.equal(map.get(2), null)
  assert.equal(map.get(3), null)
  assert.equal(map.get(4), null)
  assert.equal(map.get(99), undefined)
})

test('resolveRankAvatar prefers explicit avatar then the member map', () => {
  const avatars = buildRankAvatarMap([
    { id: 1, avatar: 'https://from-map.png' },
    { id: 2, avatar: null },
  ])

  const cases: Array<{
    memberId: number | string | undefined
    explicit: string | null | undefined
    expected: string | null
  }> = [
    { memberId: 1, explicit: 'https://explicit.png', expected: 'https://explicit.png' },
    { memberId: 1, explicit: '  ', expected: 'https://from-map.png' },
    { memberId: '1', explicit: null, expected: 'https://from-map.png' },
    { memberId: 2, explicit: undefined, expected: null },
    { memberId: 9, explicit: undefined, expected: null },
    { memberId: '', explicit: undefined, expected: null },
    { memberId: undefined, explicit: undefined, expected: null },
    { memberId: 'abc', explicit: undefined, expected: null },
  ]

  for (const row of cases) {
    assert.equal(resolveRankAvatar(row.memberId, row.explicit, avatars), row.expected)
  }
})

test('getRankAvatarText uses the first visible character', () => {
  assert.equal(getRankAvatarText('Alice'), 'A')
  assert.equal(getRankAvatarText('  张三'), '张')
  assert.equal(getRankAvatarText('   '), '?')
  assert.equal(getRankAvatarText(''), '?')
})

test('attachRankAvatars copies avatar onto ranking rows by member id', () => {
  const avatars = buildRankAvatarMap([{ id: 7, avatar: 'data:image/png;base64,abc' }])
  const attached = attachRankAvatars(
    [
      { memberId: 7, name: 'Ada' },
      { memberId: 8, name: 'Bob', avatar: 'https://bob.png' },
    ],
    (item) => item.memberId,
    avatars
  )

  assert.equal(attached[0]?.avatar, 'data:image/png;base64,abc')
  assert.equal(attached[1]?.avatar, 'https://bob.png')
})

test('chart avatars wait for a circular bitmap so ECharts never paints a square photo', () => {
  const cache = new Map([['https://a.png', 'data:image/png;base64,CIRCLE']])
  assert.equal(chartSafeAvatarSrc(null, cache), null)
  assert.equal(chartSafeAvatarSrc('https://missing.png', cache), null)
  assert.equal(chartSafeAvatarSrc('https://a.png', cache), 'data:image/png;base64,CIRCLE')
})

test('clipAvatarToCircle does not run without a DOM image loader', async () => {
  assert.equal(await clipAvatarToCircle('https://a.png'), null)
})

test('buildRankAvatarNameMap indexes nicknames and prefers a real photo', () => {
  const byName = buildRankAvatarNameMap([
    { groupNickname: 'Ada', accountName: 'ada', platformId: 'u1', avatar: null },
    { groupNickname: 'Ada', accountName: 'ada-2', platformId: 'u2', avatar: 'https://ada.png' },
    { groupNickname: null, accountName: 'Bob', platformId: 'u3', aliases: ['鲍勃'], avatar: 'https://bob.png' },
  ])

  assert.equal(byName.get('Ada'), 'https://ada.png')
  assert.equal(byName.get('ada'), null)
  assert.equal(byName.get('Bob'), 'https://bob.png')
  assert.equal(byName.get('鲍勃'), 'https://bob.png')
})

test('resolveRankAvatar falls back to originator name when member id is missing', () => {
  const index = buildRankAvatarIndex([
    { id: 1, groupNickname: 'Ada', accountName: 'ada', platformId: 'u1', avatar: 'https://ada.png' },
  ])

  assert.equal(
    resolveRankAvatar(undefined, undefined, index.byId, { name: 'Ada', byName: index.byName }),
    'https://ada.png'
  )
  assert.equal(resolveRankAvatar(1, undefined, index.byId, { name: 'Other', byName: index.byName }), 'https://ada.png')
  assert.equal(resolveRankAvatar(undefined, undefined, index.byId, { name: 'Missing', byName: index.byName }), null)
})
