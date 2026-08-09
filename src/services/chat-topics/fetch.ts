import { fetchWithAuth } from '../utils/http'
import type { ChatTopicDay, ChatTopicPreflight, ChatTopicRun, ChatTopicsAdapter } from './types'

export class FetchChatTopicsAdapter implements ChatTopicsAdapter {
  preflight(sessionId: string, request: Parameters<ChatTopicsAdapter['preflight']>[1]) {
    return requestJson<ChatTopicPreflight>(`/_web/sessions/${encodeURIComponent(sessionId)}/topics/preflight`, {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  start(sessionId: string, request: Parameters<ChatTopicsAdapter['start']>[1]) {
    return requestJson<ChatTopicRun>(`/_web/sessions/${encodeURIComponent(sessionId)}/topics/runs`, {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  generateDay(sessionId: string, dayKey: string, timezone: string, locale?: string) {
    return requestJson<ChatTopicRun>(
      `/_web/sessions/${encodeURIComponent(sessionId)}/topics/days/${encodeURIComponent(dayKey)}/generate`,
      { method: 'POST', body: JSON.stringify({ timezone, locale }) }
    )
  }

  getLatestRun(sessionId: string) {
    return requestJson<ChatTopicRun | null>(`/_web/sessions/${encodeURIComponent(sessionId)}/topics/runs/latest`)
  }

  getRun(sessionId: string, runId: string) {
    return requestJson<ChatTopicRun>(
      `/_web/sessions/${encodeURIComponent(sessionId)}/topics/runs/${encodeURIComponent(runId)}`
    )
  }

  pause(sessionId: string, runId: string) {
    return this.runAction(sessionId, runId, 'pause')
  }

  resume(sessionId: string, runId: string) {
    return this.runAction(sessionId, runId, 'resume')
  }

  cancel(sessionId: string, runId: string) {
    return this.runAction(sessionId, runId, 'cancel')
  }

  getDay(sessionId: string, dayKey: string, timezone: string) {
    return requestJson<ChatTopicDay | null>(
      `/_web/sessions/${encodeURIComponent(sessionId)}/topics/days/${encodeURIComponent(dayKey)}?timezone=${encodeURIComponent(timezone)}`
    )
  }

  async deleteDay(sessionId: string, dayKey: string): Promise<boolean> {
    const result = await requestJson<{ success: boolean }>(
      `/_web/sessions/${encodeURIComponent(sessionId)}/topics/days/${encodeURIComponent(dayKey)}`,
      { method: 'DELETE' }
    )
    return result.success
  }

  private runAction(sessionId: string, runId: string, action: 'pause' | 'resume' | 'cancel') {
    return requestJson<ChatTopicRun>(
      `/_web/sessions/${encodeURIComponent(sessionId)}/topics/runs/${encodeURIComponent(runId)}/${action}`,
      { method: 'POST' }
    )
  }
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetchWithAuth(url, { ...init, headers })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
    throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}
