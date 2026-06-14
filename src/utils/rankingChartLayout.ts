import { computed, inject, type ComputedRef, type InjectionKey, type Ref } from 'vue'

export type RankingWidthMode = 'standard' | 'wide' | 'full'

interface RankingLayoutConfig {
  contentClass: string
  gridLeft: number
  labelMaxLength: number
}

export const RANKING_WIDTH_MODE_KEY: InjectionKey<Ref<RankingWidthMode>> = Symbol('ranking-width-mode')

export const RANKING_LAYOUTS: Record<RankingWidthMode, RankingLayoutConfig> = {
  standard: {
    contentClass: 'max-w-3xl',
    gridLeft: 110,
    labelMaxLength: 8,
  },
  wide: {
    contentClass: 'max-w-5xl',
    gridLeft: 180,
    labelMaxLength: 16,
  },
  full: {
    contentClass: 'max-w-none',
    gridLeft: 260,
    labelMaxLength: 28,
  },
}

export function useRankingLayout(): ComputedRef<RankingLayoutConfig> {
  const mode = inject(RANKING_WIDTH_MODE_KEY, null)
  return computed(() => RANKING_LAYOUTS[mode?.value ?? 'standard'])
}

export function truncateRankName(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name
  return `${name.slice(0, maxLength)}...`
}
