/**
 * Shared summary service.
 *
 * Encapsulates LLM config loading, SummaryDeps construction,
 * and summary generation loop — shared across CLI Web and Electron.
 */

import {
  getChatSessionSummary,
  saveChatSessionSummary,
  getChatSessionList,
  getSessionMessages,
} from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'
import {
  generateSessionSummary,
  checkSessionsCanGenerateSummary,
  type SummaryDeps,
  completeSimple,
  type PiTextContent,
} from '../ai'
import type { SessionRuntimeAdapter } from './adapters'

export interface LlmConfig {
  apiKey: string
}

export interface SummaryServiceDeps {
  getLlmConfig(): LlmConfig | null
  buildPiModel(config: LlmConfig): ReturnType<typeof import('../ai').buildPiModel>
}

function buildSummaryDeps(db: DatabaseAdapter, llmConfig: LlmConfig, deps: SummaryServiceDeps): SummaryDeps {
  const piModel = deps.buildPiModel(llmConfig)
  return {
    loadMessages(chatSessionId, limit = 500) {
      const data = getSessionMessages(db, chatSessionId, limit)
      if (!data) return null
      return data.messages.map((m) => ({ senderName: m.senderName, content: m.content }))
    },
    saveSummary(chatSessionId, summary) {
      saveChatSessionSummary(db, chatSessionId, summary)
    },
    getSummary(chatSessionId) {
      return getChatSessionSummary(db, chatSessionId)
    },
    async llmComplete(systemPrompt, userPrompt, options) {
      const result = await completeSimple(
        piModel,
        {
          systemPrompt,
          messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }], timestamp: Date.now() }] as any,
        },
        { apiKey: llmConfig.apiKey, maxTokens: options?.maxTokens, temperature: options?.temperature }
      )
      return result.content
        .filter((item): item is PiTextContent => item.type === 'text')
        .map((item) => item.text)
        .join('')
    },
    t: (key: string) => key,
  }
}

export async function generateSummary(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  chatSessionId: number,
  serviceDeps: SummaryServiceDeps,
  options?: { locale?: string; forceRegenerate?: boolean }
) {
  const llmConfig = serviceDeps.getLlmConfig()
  if (!llmConfig) {
    return { success: false as const, error: 'No LLM configuration available' }
  }

  const db = adapter.ensureWritable(sessionId)
  const deps = buildSummaryDeps(db, llmConfig, serviceDeps)
  return generateSessionSummary(deps, chatSessionId, options)
}

export async function generateAllSummaries(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  serviceDeps: SummaryServiceDeps,
  options?: { locale?: string; forceRegenerate?: boolean }
) {
  const llmConfig = serviceDeps.getLlmConfig()
  if (!llmConfig) {
    return { success: 0, failed: 0, total: 0, error: 'No LLM configuration available' }
  }

  const db = adapter.ensureWritable(sessionId)
  const chatSessions = getChatSessionList(db)
  const deps = buildSummaryDeps(db, llmConfig, serviceDeps)

  let success = 0
  let failed = 0

  for (const cs of chatSessions) {
    const result = await generateSessionSummary(deps, cs.id, options)
    if (result.success) success++
    else failed++
  }

  return { success, failed, total: chatSessions.length }
}

export function checkCanGenerate(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  chatSessionIds: number[]
): Record<number, { canGenerate: boolean; reason?: string }> {
  const db = adapter.ensureReadonly(sessionId)
  const deps: Pick<SummaryDeps, 'loadMessages' | 't'> = {
    loadMessages(chatSessionId, limit = 500) {
      const data = getSessionMessages(db, chatSessionId, limit)
      if (!data) return null
      return data.messages.map((m) => ({ senderName: m.senderName, content: m.content }))
    },
    t: (key: string) => key,
  }
  const resultMap = checkSessionsCanGenerateSummary(deps, chatSessionIds)
  const result: Record<number, { canGenerate: boolean; reason?: string }> = {}
  for (const [id, info] of resultMap) {
    result[id] = info
  }
  return result
}
