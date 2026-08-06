export const INSIGHT_CARD_THEME_IDS = [
  'default',
  'sunset',
  'galaxy',
  'mist',
  'moonlight',
  'berry',
  'sunshine',
  'aurora',
] as const

export type InsightCardThemeId = (typeof INSIGHT_CARD_THEME_IDS)[number]

export interface InsightCardTheme {
  id: InsightCardThemeId
  startColor: string
  endColor: string
}

export const DEFAULT_INSIGHT_CARD_THEME: InsightCardThemeId = 'default'

export const INSIGHT_CARD_THEMES: readonly InsightCardTheme[] = [
  { id: 'default', startColor: '#60a5fa', endColor: '#f472b6' },
  { id: 'sunset', startColor: '#fb923c', endColor: '#fb7185' },
  { id: 'galaxy', startColor: '#818cf8', endColor: '#c084fc' },
  { id: 'mist', startColor: '#22d3ee', endColor: '#60a5fa' },
  { id: 'moonlight', startColor: '#22c55e', endColor: '#14b8a6' },
  { id: 'berry', startColor: '#fb7185', endColor: '#a78bfa' },
  { id: 'sunshine', startColor: '#f59e0b', endColor: '#facc15' },
  { id: 'aurora', startColor: '#34d399', endColor: '#818cf8' },
]

export function getInsightCardTheme(id: InsightCardThemeId): InsightCardTheme {
  return INSIGHT_CARD_THEMES.find((theme) => theme.id === id) ?? INSIGHT_CARD_THEMES[0]
}
