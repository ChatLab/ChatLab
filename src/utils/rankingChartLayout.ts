import { computed, inject, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import { getRankAvatarText, resolveRankAvatar, type RankAvatarMap } from './rankAvatars'

export type RankingWidthMode = 'standard' | 'wide' | 'full'

interface RankingLayoutConfig {
  contentClass: string
  gridLeft: number
  labelMaxLength: number
}

/** Extra Y-axis space for the 18px avatar plus gap before the rank prefix. */
export const RANK_AVATAR_AXIS_GUTTER = 28
const RANK_AXIS_AVATAR_SIZE = 18
const RANK_AXIS_LABEL_COLOR = '#4b5563'

export const RANKING_WIDTH_MODE_KEY: InjectionKey<Ref<RankingWidthMode>> = Symbol('ranking-width-mode')

export const RANKING_LAYOUTS: Record<RankingWidthMode, RankingLayoutConfig> = {
  standard: {
    contentClass: 'max-w-3xl',
    gridLeft: 110 + RANK_AVATAR_AXIS_GUTTER,
    labelMaxLength: 8,
  },
  wide: {
    contentClass: 'max-w-5xl',
    gridLeft: 180 + RANK_AVATAR_AXIS_GUTTER,
    labelMaxLength: 16,
  },
  full: {
    contentClass: 'max-w-none',
    gridLeft: 260 + RANK_AVATAR_AXIS_GUTTER,
    labelMaxLength: 28,
  },
}

export interface RankYAxisMember {
  name: string
  memberId?: number
  id?: string | number
  avatar?: string | null
}

export interface RankYAxisLabelConfig {
  data: string[]
  axisLabel: {
    fontSize: number
    color: string
    margin: number
    formatter: (value: string, index: number) => string
    rich: Record<string, Record<string, unknown>>
  }
}

export function formatRankPrefix(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return `${rank}.`
}

export function useRankingLayout(): ComputedRef<RankingLayoutConfig> {
  const mode = inject(RANKING_WIDTH_MODE_KEY, null)
  return computed(() => RANKING_LAYOUTS[mode?.value ?? 'standard'])
}

export function truncateRankName(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name
  return `${name.slice(0, maxLength)}…`
}

function avatarRichStyle(avatar: string | null): Record<string, unknown> {
  if (avatar) {
    return {
      width: RANK_AXIS_AVATAR_SIZE,
      height: RANK_AXIS_AVATAR_SIZE,
      borderRadius: RANK_AXIS_AVATAR_SIZE / 2,
      backgroundColor: { image: avatar },
      align: 'center',
      verticalAlign: 'middle',
    }
  }

  return {
    width: RANK_AXIS_AVATAR_SIZE,
    height: RANK_AXIS_AVATAR_SIZE,
    borderRadius: RANK_AXIS_AVATAR_SIZE / 2,
    backgroundColor: '#fce7f3',
    color: '#db2777',
    fontSize: 10,
    fontWeight: 600,
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: RANK_AXIS_AVATAR_SIZE,
  }
}

export function buildRankYAxis(
  reversedMembers: RankYAxisMember[],
  options: {
    totalCount: number
    labelMaxLength: number
    avatars: RankAvatarMap
  }
): RankYAxisLabelConfig {
  const names = reversedMembers.map((member) => truncateRankName(member.name, options.labelMaxLength))
  const rich: Record<string, Record<string, unknown>> = {
    rank: {
      fontSize: 12,
      color: RANK_AXIS_LABEL_COLOR,
      padding: [0, 4, 0, 4],
    },
    name: {
      fontSize: 12,
      color: RANK_AXIS_LABEL_COLOR,
    },
  }

  reversedMembers.forEach((member, index) => {
    const avatar = resolveRankAvatar(member.memberId ?? member.id, undefined, options.avatars)
    rich[`av${index}`] = avatarRichStyle(avatar)
  })

  return {
    data: names,
    axisLabel: {
      fontSize: 12,
      color: RANK_AXIS_LABEL_COLOR,
      margin: 8,
      formatter: (_value: string, index: number) => {
        const member = reversedMembers[index]
        if (!member) return ''
        const rank = options.totalCount - index
        const avatar = resolveRankAvatar(member.memberId ?? member.id, undefined, options.avatars)
        const avatarText = avatar ? '' : getRankAvatarText(member.name)
        return `{av${index}|${avatarText}}{rank|${formatRankPrefix(rank)}}{name|${names[index] ?? ''}}`
      },
      rich,
    },
  }
}
