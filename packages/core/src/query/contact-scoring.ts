import type { ContactScoreBreakdown } from '@openchatlab/shared-types'

export const MIN_PRIVATE_SESSIONS_FOR_CONTACTS = 10
export const MIN_NON_FRIEND_INTERACTIONS_FOR_VISIBLE = 5

const FRIEND_SCORE_WEIGHTS = {
  privateMessage: 0.55,
  privateRegularity: 0.25,
  commonGroup: 0.2,
}

const NON_FRIEND_SCORE_WEIGHTS = {
  coOccurrence: 0.5,
  commonGroup: 0.25,
  replyInteraction: 0.25,
}

export interface FriendScoreInput {
  privateMessageCount: number
  activeMonths: readonly string[]
  commonGroupCount: number
}

export interface NonFriendScoreInput {
  coOccurrenceRawScore: number
  commonGroupCount: number
  replyInteractionCount: number
  coOccurrenceCount?: number
  repliesFromOwnerToContact?: number
  repliesFromContactToOwner?: number
}

export interface FriendScoreComponents {
  privateMessageScore: number
  privateRegularityScore: number
  commonGroupScore: number
  privateMessageCount?: number
  activePrivateMonths?: number
  commonGroupCount?: number
}

export interface NonFriendScoreComponents {
  coOccurrenceScore: number
  commonGroupScore: number
  replyInteractionScore: number
  commonGroupCount?: number
  coOccurrenceCount?: number
  coOccurrenceRawScore?: number
  replyInteractionCount?: number
  repliesFromOwnerToContact?: number
  repliesFromContactToOwner?: number
}

export interface ContactScoringResult {
  score: number
  scoreBreakdown: ContactScoreBreakdown
}

export interface NonFriendSignalInput {
  coOccurrenceCount: number
  replyInteractionCount: number
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function nonNegative(value: number | null | undefined): number {
  return Number.isFinite(value) && value !== null && value !== undefined ? Math.max(0, value) : 0
}

function parseMonthIndex(month: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return null

  const year = Number.parseInt(match[1], 10)
  const monthNumber = Number.parseInt(match[2], 10)
  if (!Number.isFinite(year) || monthNumber < 1 || monthNumber > 12) return null

  return year * 12 + monthNumber - 1
}

function getActiveMonthIndexes(activeMonths: readonly string[]): number[] {
  return [...new Set(activeMonths.map(parseMonthIndex).filter((month): month is number => month !== null))].sort(
    (a, b) => a - b
  )
}

export function rankPercentiles<T>(items: readonly T[], valueSelector: (item: T) => number): Map<T, number> {
  const result = new Map<T, number>()
  if (items.length === 0) return result

  const values = items.map((item) => ({ item, value: nonNegative(valueSelector(item)) }))
  const min = Math.min(...values.map((entry) => entry.value))
  const max = Math.max(...values.map((entry) => entry.value))

  if (min === max) {
    const percentile = max > 0 ? 1 : 0
    for (const entry of values) result.set(entry.item, percentile)
    return result
  }

  const sorted = [...values].sort((a, b) => a.value - b.value)
  let index = 0
  while (index < sorted.length) {
    let end = index
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[index].value) end++
    const percentile = (index + end) / 2 / (sorted.length - 1)
    for (let i = index; i <= end; i++) result.set(sorted[i].item, percentile)
    index = end + 1
  }

  return result
}

export function computePrivateRegularity(activeMonths: readonly string[]): number {
  const monthIndexes = getActiveMonthIndexes(activeMonths)
  if (monthIndexes.length === 0) return 0

  const activeCount = monthIndexes.length
  const spanMonths = monthIndexes[monthIndexes.length - 1] - monthIndexes[0] + 1

  // 定期性衡量持续规律：活跃月越多越高，跨度很大但只零星出现会被均匀度压低。
  return activeCount * (activeCount / spanMonths)
}

export function computeFriendScore(components: FriendScoreComponents): ContactScoringResult {
  const privateMessageScore = clamp01(components.privateMessageScore)
  const privateRegularityScore = clamp01(components.privateRegularityScore)
  const commonGroupScore = clamp01(components.commonGroupScore)
  const score =
    FRIEND_SCORE_WEIGHTS.privateMessage * privateMessageScore +
    FRIEND_SCORE_WEIGHTS.privateRegularity * privateRegularityScore +
    FRIEND_SCORE_WEIGHTS.commonGroup * commonGroupScore

  return {
    score,
    scoreBreakdown: {
      privateMessageScore,
      privateRegularityScore,
      commonGroupScore,
      privateMessageCount: components.privateMessageCount,
      activePrivateMonths: components.activePrivateMonths,
      commonGroupCount: components.commonGroupCount,
    },
  }
}

export function computeFriendScores<T extends FriendScoreInput>(items: readonly T[]): Map<T, ContactScoringResult> {
  const messageScores = rankPercentiles(items, (item) => Math.log1p(nonNegative(item.privateMessageCount)))
  const regularityByItem = new Map(items.map((item) => [item, computePrivateRegularity(item.activeMonths)]))
  const regularityScores = rankPercentiles(items, (item) => regularityByItem.get(item) ?? 0)
  const groupScores = rankPercentiles(items, (item) => nonNegative(item.commonGroupCount))
  const result = new Map<T, ContactScoringResult>()

  for (const item of items) {
    result.set(
      item,
      computeFriendScore({
        privateMessageScore: messageScores.get(item) ?? 0,
        privateRegularityScore: regularityScores.get(item) ?? 0,
        commonGroupScore: groupScores.get(item) ?? 0,
        privateMessageCount: nonNegative(item.privateMessageCount),
        activePrivateMonths: getActiveMonthIndexes(item.activeMonths).length,
        commonGroupCount: nonNegative(item.commonGroupCount),
      })
    )
  }

  return result
}

export function computeNonFriendScore(components: NonFriendScoreComponents): ContactScoringResult {
  const coOccurrenceScore = clamp01(components.coOccurrenceScore)
  const commonGroupScore = clamp01(components.commonGroupScore)
  const replyInteractionScore = clamp01(components.replyInteractionScore)
  const score =
    NON_FRIEND_SCORE_WEIGHTS.coOccurrence * coOccurrenceScore +
    NON_FRIEND_SCORE_WEIGHTS.commonGroup * commonGroupScore +
    NON_FRIEND_SCORE_WEIGHTS.replyInteraction * replyInteractionScore

  return {
    score,
    scoreBreakdown: {
      coOccurrenceScore,
      commonGroupScore,
      replyInteractionScore,
      commonGroupCount: components.commonGroupCount,
      coOccurrenceCount: components.coOccurrenceCount,
      coOccurrenceRawScore: components.coOccurrenceRawScore,
      replyInteractionCount: components.replyInteractionCount,
      repliesFromOwnerToContact: components.repliesFromOwnerToContact,
      repliesFromContactToOwner: components.repliesFromContactToOwner,
    },
  }
}

export function computeNonFriendScores<T extends NonFriendScoreInput>(
  items: readonly T[]
): Map<T, ContactScoringResult> {
  const coOccurrenceScores = rankPercentiles(items, (item) => nonNegative(item.coOccurrenceRawScore))
  const groupScores = rankPercentiles(items, (item) => nonNegative(item.commonGroupCount))
  const replyScores = rankPercentiles(items, (item) => nonNegative(item.replyInteractionCount))
  const result = new Map<T, ContactScoringResult>()

  for (const item of items) {
    result.set(
      item,
      computeNonFriendScore({
        coOccurrenceScore: coOccurrenceScores.get(item) ?? 0,
        commonGroupScore: groupScores.get(item) ?? 0,
        replyInteractionScore: replyScores.get(item) ?? 0,
        commonGroupCount: nonNegative(item.commonGroupCount),
        coOccurrenceCount: nonNegative(item.coOccurrenceCount),
        coOccurrenceRawScore: nonNegative(item.coOccurrenceRawScore),
        replyInteractionCount: nonNegative(item.replyInteractionCount),
        repliesFromOwnerToContact: nonNegative(item.repliesFromOwnerToContact),
        repliesFromContactToOwner: nonNegative(item.repliesFromContactToOwner),
      })
    )
  }

  return result
}

export function isLowSignalNonFriend(input: NonFriendSignalInput): boolean {
  const totalInteractions = nonNegative(input.coOccurrenceCount) + nonNegative(input.replyInteractionCount)
  return totalInteractions < MIN_NON_FRIEND_INTERACTIONS_FOR_VISIBLE
}
