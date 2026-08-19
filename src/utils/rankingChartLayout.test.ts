/**
 * Run: pnpm test -- src/utils/rankingChartLayout.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRankAvatarMap } from './rankAvatars'
import {
  RANKING_LAYOUTS,
  RANK_AVATAR_AXIS_GUTTER,
  buildRankYAxis,
  formatRankPrefix,
  truncateRankName,
} from './rankingChartLayout'

test('ranking layouts reserve Y-axis space for avatars', () => {
  assert.equal(RANKING_LAYOUTS.standard.gridLeft, 110 + RANK_AVATAR_AXIS_GUTTER)
  assert.equal(RANKING_LAYOUTS.wide.gridLeft, 180 + RANK_AVATAR_AXIS_GUTTER)
  assert.equal(RANKING_LAYOUTS.full.gridLeft, 260 + RANK_AVATAR_AXIS_GUTTER)
})

test('formatRankPrefix keeps medals for the top three', () => {
  assert.deepEqual([1, 2, 3, 4, 10].map(formatRankPrefix), ['🥇', '🥈', '🥉', '4.', '10.'])
})

test('buildRankYAxis paints avatars and fallback initials on reversed rows', () => {
  const avatars = buildRankAvatarMap([
    { id: 1, avatar: 'https://alice.png' },
    { id: 2, avatar: null },
  ])
  const axis = buildRankYAxis(
    [
      { memberId: 2, name: '非常长的群昵称会被截断' },
      { id: '1', name: 'Alice' },
    ],
    {
      totalCount: 2,
      labelMaxLength: 8,
      avatars,
    }
  )

  assert.deepEqual(axis.data, [truncateRankName('非常长的群昵称会被截断', 8), 'Alice'])
  assert.equal(axis.axisLabel.formatter('', 0), `{av0|非}{rank|🥈}{name|${axis.data[0]}}`)
  assert.equal(axis.axisLabel.formatter('', 1), '{av1|}{rank|🥇}{name|Alice}')
  assert.deepEqual(axis.axisLabel.rich.av1?.backgroundColor, { image: 'https://alice.png' })
  assert.equal(axis.axisLabel.rich.av0?.backgroundColor, '#fce7f3')
})

test('buildRankYAxis ignores raw member photos and only uses the prepared map', () => {
  const axis = buildRankYAxis([{ memberId: 1, name: 'Alice', avatar: 'https://square.png' }], {
    totalCount: 1,
    labelMaxLength: 8,
    avatars: buildRankAvatarMap([{ id: 1, avatar: 'data:image/png;base64,CIRCLE' }]),
  })

  assert.deepEqual(axis.axisLabel.rich.av0?.backgroundColor, { image: 'data:image/png;base64,CIRCLE' })
})
