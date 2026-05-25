/**
 * Remote LLM API operations (platform-agnostic).
 *
 * - fetchRemoteModels: list available models from a provider's API
 * - validateApiKey: send a minimal completion request to verify key validity
 */

import { BUILTIN_PROVIDERS } from '@openchatlab/core'
import { completeSimple } from '@earendil-works/pi-ai'
import { buildPiModel, normalizeOpenAICompatibleBaseUrl, type PiModelConfig } from './llm-builder'
import type { Model as PiModel, Api as PiApi } from '@earendil-works/pi-ai'

export interface RemoteModel {
  id: string
  name: string
  ownedBy?: string
  contextWindow?: number
}

export interface FetchRemoteModelsResult {
  success: boolean
  models?: RemoteModel[]
  error?: string
}

export interface RemoteApiOptions {
  /** Extra headers for outgoing requests (e.g. User-Agent). */
  headers?: Record<string, string>
  /** Optional logger. */
  onLog?: (level: 'info' | 'error', tag: string, message: string, data?: unknown) => void
}

export async function fetchRemoteModels(
  provider: string,
  apiKey: string,
  baseUrl?: string,
  apiFormat?: string,
  options?: RemoteApiOptions
): Promise<FetchRemoteModelsResult> {
  const effectiveApiFormat = apiFormat || 'openai-completions'

  if (effectiveApiFormat === 'anthropic-messages') {
    return { success: false, error: 'Anthropic does not support model listing via API' }
  }

  const providerDef = BUILTIN_PROVIDERS.find((p) => p.id === provider)
  const rawBaseUrl = baseUrl || providerDef?.defaultBaseUrl || ''
  if (!rawBaseUrl) {
    return { success: false, error: 'No base URL provided' }
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 15000)

  try {
    let url: string
    const headers: Record<string, string> = { ...options?.headers }

    if (effectiveApiFormat === 'google-generative-ai') {
      const trimmed = rawBaseUrl.replace(/\/+$/, '').replace(/\/v1(beta)?$/, '')
      url = `${trimmed}/v1beta/models?key=${apiKey}`
    } else {
      const resolved = normalizeOpenAICompatibleBaseUrl(rawBaseUrl)
      url = `${resolved}/models`
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    options?.onLog?.('info', 'LLM', 'Fetching remote models', {
      url: url.replace(/key=[^&]+/, 'key=***'),
      provider,
    })

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: abortController.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return { success: false, error: `HTTP ${response.status}: ${body.slice(0, 200)}` }
    }

    const json = await response.json()

    let models: RemoteModel[]

    if (effectiveApiFormat === 'google-generative-ai') {
      const geminiModels = (json.models || []) as Array<{
        name?: string
        displayName?: string
        inputTokenLimit?: number
      }>
      models = geminiModels.map((m) => {
        const id = (m.name || '').replace(/^models\//, '')
        return {
          id,
          name: m.displayName || id,
          ownedBy: 'google',
          contextWindow: m.inputTokenLimit || undefined,
        }
      })
    } else {
      const data = (json.data || []) as Array<{
        id?: string
        owned_by?: string
        context_length?: number
      }>
      models = data
        .filter((m) => m.id)
        .map((m) => ({
          id: m.id!,
          name: m.id!,
          ownedBy: m.owned_by,
          contextWindow: m.context_length || undefined,
        }))
    }

    options?.onLog?.('info', 'LLM', `Fetched ${models.length} remote models`, { provider })
    return { success: true, models }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('aborted') || message.includes('AbortError')) {
      return { success: false, error: 'Request timed out (15s)' }
    }
    return { success: false, error: message }
  } finally {
    clearTimeout(timeout)
  }
}

export async function validateApiKey(
  provider: string,
  apiKey: string,
  baseUrl?: string,
  model?: string,
  apiFormat?: string,
  options?: RemoteApiOptions
): Promise<{ success: boolean; error?: string }> {
  const providerDef = BUILTIN_PROVIDERS.find((p) => p.id === provider)
  const defaultModel = providerDef?.modelIds?.[0]

  const config: PiModelConfig = {
    provider,
    model: model || defaultModel,
    baseUrl,
    apiFormat,
  }
  const piModel: PiModel<PiApi> = buildPiModel(config, { headers: options?.headers })

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 15000)

  try {
    const result = await completeSimple(
      piModel,
      { messages: [{ role: 'user', content: 'Hi', timestamp: Date.now() }] as any },
      { apiKey, maxTokens: 1, signal: abortController.signal }
    )
    if (result.stopReason === 'error' || result.stopReason === 'aborted') {
      return { success: false, error: result.errorMessage || 'Connection failed' }
    }
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('aborted') || message.includes('AbortError')) {
      return { success: false, error: 'Request timed out (15s)' }
    }
    return { success: false, error: message }
  } finally {
    clearTimeout(timeout)
  }
}
