/**
 * NLP Web API — /_web/nlp/ routes
 *
 * 提供词频统计、词性标签、词库管理等 NLP 功能的 HTTP 接口，
 * 供 CLI serve Web 前端使用（对齐 Electron preload 的 window.nlpApi）。
 *
 * 业务逻辑全部来自 @openchatlab/core（类型/数据）和
 * @openchatlab/node-runtime（分词引擎/词频计算/词库管理）。
 */

import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import type { DatabaseManager } from '@openchatlab/node-runtime'
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

function ensureDb(dbManager: DatabaseManager, sessionId: string) {
  const db = dbManager.open(sessionId)
  if (!db) {
    throw Object.assign(new Error(`Session not found: ${sessionId}`), { statusCode: 404 })
  }
  return db
}

export function registerNlpRoutes(server: FastifyInstance, dbManager: DatabaseManager): void {
  const pathProvider = (dbManager as any)['pathProvider']
  if (pathProvider) {
    const nlpDir = path.join(pathProvider.getSystemDir(), 'nlp')
    initNlpDir(nlpDir)
    ensureDefaultDict(nlpDir).catch((err) => console.warn('[NLP] Auto-download zh-CN dict failed:', err))
  }

  server.get('/_web/nlp/pos-tags', async () => {
    return POS_TAG_DEFINITIONS
  })

  server.get('/_web/nlp/dicts', async () => {
    const nlpDir = resolveNlpDir(dbManager)
    return getDictList(nlpDir)
  })

  server.get<{ Params: { id: string } }>('/_web/nlp/dicts/:id/status', async (request) => {
    const nlpDir = resolveNlpDir(dbManager)
    return isDictDownloaded(nlpDir, request.params.id)
  })

  server.post<{ Params: { id: string } }>('/_web/nlp/dicts/:id/download', async (request) => {
    const nlpDir = resolveNlpDir(dbManager)
    return downloadDict(nlpDir, request.params.id)
  })

  server.delete<{ Params: { id: string } }>('/_web/nlp/dicts/:id', async (request) => {
    const nlpDir = resolveNlpDir(dbManager)
    return deleteDict(nlpDir, request.params.id)
  })

  server.post<{ Body: WordFrequencyParams }>('/_web/nlp/word-frequency', async (request) => {
    const params = request.body
    const db = ensureDb(dbManager, params.sessionId)
    return computeWordFrequency(db, params)
  })

  server.post<{ Body: { text: string; locale: SupportedLocale; minLength?: number } }>(
    '/_web/nlp/segment',
    async (request) => {
      const { text, locale, minLength } = request.body
      return segmentText(text, locale, minLength)
    }
  )
}

function resolveNlpDir(dbManager: DatabaseManager): string {
  const pathProvider = (dbManager as any)['pathProvider']
  return path.join(pathProvider.getSystemDir(), 'nlp')
}
