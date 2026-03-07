/**
 * NLP API client — replaces window.nlpApi
 *
 * Maps preload IPC calls to HTTP endpoints under /api/nlp and /api/sessions/:id/nlp.
 */

import { get, post } from './client'

// ─────────────────────────── types ───────────────────────────

export interface WordFrequencyItem {
  word: string
  count: number
  percentage: number
}

export interface WordFrequencyResult {
  words: WordFrequencyItem[]
  totalWords: number
  totalMessages: number
  uniqueWords: number
}

export type PosFilterMode = 'all' | 'meaningful' | 'custom'

export interface WordFrequencyParams {
  sessionId: string
  locale: 'zh-CN' | 'en-US'
  timeFilter?: { startTs?: number; endTs?: number }
  memberId?: number
  topN?: number
  minWordLength?: number
  minCount?: number
  posFilterMode?: PosFilterMode
  customPosTags?: string[]
  enableStopwords?: boolean
}

export interface PosTagInfo {
  tag: string
  name: string
  description: string
  meaningful: boolean
}

// ─────────────────────────── nlpApi ───────────────────────────

export const nlpApi = {
  getWordFrequency: (params: WordFrequencyParams) => {
    const { sessionId, ...rest } = params
    return post<WordFrequencyResult>(`/sessions/${sessionId}/nlp/word-frequency`, rest)
  },

  segmentText: (text: string, locale: 'zh-CN' | 'en-US', minLength?: number) =>
    post<string[]>('/nlp/segment', { text, locale, minLength }),

  getPosTags: () => get<PosTagInfo[]>('/nlp/pos-tags'),
}
