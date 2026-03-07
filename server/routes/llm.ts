/**
 * LLM configuration API routes (US-010)
 *
 * Endpoints:
 *   GET  /api/llm/providers          - List all supported providers
 *   GET  /api/llm/configs            - List all configs (API keys masked)
 *   GET  /api/llm/configs/:id        - Get single config (API key masked)
 *   POST /api/llm/configs            - Create a new config
 *   PUT  /api/llm/configs/:id        - Update an existing config
 *   DELETE /api/llm/configs/:id      - Delete a config
 *   PUT  /api/llm/configs/:id/activate - Set config as active
 *   POST /api/llm/validate           - Validate an API key
 *   GET  /api/llm/has-config         - Check if any active config exists
 */

import { Router } from 'express'
import {
  PROVIDERS,
  getAllConfigs,
  getConfigById,
  addConfig,
  updateConfig,
  deleteConfig,
  setActiveConfig,
  hasActiveConfig,
  loadConfigStore,
  validateApiKey,
} from '../ai/llm/index.js'
import type { LLMProvider } from '../ai/llm/types.js'

const router = Router()

/**
 * Mask an API key for safe display (show first 4 and last 4 chars).
 */
function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}****${key.slice(-4)}`
}

// GET /api/llm/providers
router.get('/providers', (_req, res) => {
  res.json(PROVIDERS)
})

// GET /api/llm/has-config
router.get('/has-config', (_req, res) => {
  res.json({ hasConfig: hasActiveConfig() })
})

// GET /api/llm/configs
router.get('/configs', (_req, res) => {
  const store = loadConfigStore()
  const configs = store.configs.map((c) => ({
    ...c,
    apiKey: maskApiKey(c.apiKey),
  }))
  res.json({
    configs,
    activeConfigId: store.activeConfigId,
  })
})

// GET /api/llm/configs/:id
router.get('/configs/:id', (req, res) => {
  const config = getConfigById(req.params.id)
  if (!config) {
    res.status(404).json({ error: 'Config not found' })
    return
  }
  res.json({ ...config, apiKey: maskApiKey(config.apiKey) })
})

// POST /api/llm/configs
router.post('/configs', (req, res) => {
  const { name, provider, apiKey, model, baseUrl, maxTokens, disableThinking, isReasoningModel } = req.body

  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (!provider || typeof provider !== 'string') {
    res.status(400).json({ error: 'provider is required' })
    return
  }

  // Validate provider is a known value
  const validProviders: LLMProvider[] = [
    'deepseek', 'qwen', 'minimax', 'glm', 'kimi', 'gemini', 'doubao', 'openai-compatible',
  ]
  if (!validProviders.includes(provider as LLMProvider)) {
    res.status(400).json({ error: `Invalid provider: ${provider}` })
    return
  }

  const result = addConfig({
    name,
    provider: provider as LLMProvider,
    apiKey: apiKey || '',
    model,
    baseUrl,
    maxTokens,
    disableThinking,
    isReasoningModel,
  })

  if (!result.success) {
    res.status(400).json({ error: result.error })
    return
  }

  res.status(201).json(result.config)
})

// PUT /api/llm/configs/:id
router.put('/configs/:id', (req, res) => {
  const { name, provider, apiKey, model, baseUrl, maxTokens, disableThinking, isReasoningModel } = req.body

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = name
  if (provider !== undefined) updates.provider = provider
  if (apiKey !== undefined) updates.apiKey = apiKey
  if (model !== undefined) updates.model = model
  if (baseUrl !== undefined) updates.baseUrl = baseUrl
  if (maxTokens !== undefined) updates.maxTokens = maxTokens
  if (disableThinking !== undefined) updates.disableThinking = disableThinking
  if (isReasoningModel !== undefined) updates.isReasoningModel = isReasoningModel

  const result = updateConfig(req.params.id, updates)

  if (!result.success) {
    res.status(404).json({ error: result.error })
    return
  }

  res.json({ success: true })
})

// DELETE /api/llm/configs/:id
router.delete('/configs/:id', (req, res) => {
  const result = deleteConfig(req.params.id)

  if (!result.success) {
    res.status(404).json({ error: result.error })
    return
  }

  res.json({ success: true })
})

// PUT /api/llm/configs/:id/activate
router.put('/configs/:id/activate', (req, res) => {
  const result = setActiveConfig(req.params.id)

  if (!result.success) {
    res.status(404).json({ error: result.error })
    return
  }

  res.json({ success: true })
})

// POST /api/llm/validate
router.post('/validate', async (req, res) => {
  const { provider, apiKey, baseUrl, model } = req.body

  if (!provider || !apiKey) {
    res.status(400).json({ error: 'provider and apiKey are required' })
    return
  }

  const result = await validateApiKey(provider, apiKey, baseUrl, model)
  res.json(result)
})

export default router
