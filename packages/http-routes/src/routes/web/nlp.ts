/**
 * NLP Web API — /_web/nlp/ routes
 *
 * Word frequency, POS tags, dictionary management.
 * Business logic from @openchatlab/core and @openchatlab/node-runtime.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import { withAnalyticsCache } from './analytics-cache'
import type { WordFrequencyParams, SupportedLocale } from '@openchatlab/core'
import { POS_TAG_DEFINITIONS } from '@openchatlab/core'
import {
  initNlpDir,
  computeWordFrequency,
  segmentText,
  getDictList,
  isDictDownloaded,
  downloadDict,
  deleteDict,
  ensureDefaultDict,
} from '@openchatlab/node-runtime'

export function registerNlpRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const nlpDir = path.join(ctx.pathProvider.getSystemDir(), 'nlp')
  initNlpDir(nlpDir)
  ensureDefaultDict(nlpDir).catch((err) => console.warn('[NLP] Auto-download zh-CN dict failed:', err))

  server.get('/_web/nlp/pos-tags', async () => {
    return POS_TAG_DEFINITIONS
  })

  server.get('/_web/nlp/dicts', async () => {
    return getDictList(nlpDir)
  })

  server.get<{ Params: { id: string } }>('/_web/nlp/dicts/:id/status', async (request) => {
    return isDictDownloaded(nlpDir, request.params.id)
  })

  server.post<{ Params: { id: string } }>('/_web/nlp/dicts/:id/download', async (request) => {
    return downloadDict(nlpDir, request.params.id)
  })

  server.delete<{ Params: { id: string } }>('/_web/nlp/dicts/:id', async (request) => {
    return deleteDict(nlpDir, request.params.id)
  })

  server.post<{ Body: WordFrequencyParams }>('/_web/nlp/word-frequency', async (request) => {
    const params = request.body
    const db = ctx.dbManager.open(params.sessionId)
    if (!db) {
      throw Object.assign(new Error(`Session not found: ${params.sessionId}`), { statusCode: 404 })
    }
    const { sessionId, ...keyParams } = params
    const effectiveDictId = !params.dictType || params.dictType === 'default' ? 'zh-CN' : String(params.dictType)
    const dictFilePath = path.join(nlpDir, `${effectiveDictId}.dict`)
    let dictVersion: string
    try {
      const st = fs.statSync(dictFilePath)
      dictVersion = `${Math.floor(st.mtimeMs)}:${st.size}`
    } catch {
      dictVersion = '-'
    }
    return withAnalyticsCache(ctx, sessionId, 'nlp.word-frequency', keyParams, () => computeWordFrequency(db, params), {
      extraVersion: `dict:${dictVersion}`,
    })
  })

  server.post<{ Body: { text: string; locale: SupportedLocale; minLength?: number } }>(
    '/_web/nlp/segment',
    async (request) => {
      const { text, locale, minLength } = request.body
      return segmentText(text, locale, minLength)
    }
  )
}
