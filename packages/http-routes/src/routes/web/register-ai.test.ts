import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import type {
  AIChatManager,
  AssistantManager,
  CustomModelStore,
  CustomProviderStore,
  DatabaseManager,
  LLMConfigStore,
  SemanticIndexRuntime,
  SessionRuntimeAdapter,
  SkillManagerCore,
} from '@openchatlab/node-runtime'
import { registerAiRoutes, type AiRoutesContext } from './register-ai'

function baseContext(): AiRoutesContext {
  return {
    dbManager: {} as DatabaseManager,
    sessionAdapter: {} as SessionRuntimeAdapter,
    pathProvider: {} as PathProvider,
  }
}

test('registerAiRoutes reports the same required dependency list', () => {
  const app = Fastify()

  assert.throws(
    () => registerAiRoutes(app, baseContext(), { requireAi: true }),
    new Error(
      '[http-routes] requireAi is set but missing AI dependencies: ' +
        'aiDataDir, aiChatManager, assistantManager, skillManagerCore, llmConfigStore, ' +
        'customProviderStore, customModelStore, runAgentStream'
    )
  )
})

test('registerAiRoutes keeps static and graceful fallback routes without AI managers', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  registerAiRoutes(app, baseContext())
  await app.ready()

  const catalog = await app.inject({ method: 'GET', url: '/_web/ai/tools/catalog' })
  assert.equal(catalog.statusCode, 200)
  assert.ok(Array.isArray(catalog.json()))

  const assistants = await app.inject({ method: 'GET', url: '/_web/ai/assistants' })
  assert.equal(assistants.statusCode, 404)

  const semanticStatus = await app.inject({ method: 'GET', url: '/_web/ai/semantic-index/status' })
  assert.equal(semanticStatus.statusCode, 200)
  assert.deepEqual(semanticStatus.json(), { status: null })
})

test('registerAiRoutes accepts a complete required AI context', () => {
  const app = Fastify()
  const ctx: AiRoutesContext = {
    ...baseContext(),
    aiDataDir: '/tmp/chatlab-ai-route-test',
    aiChatManager: {} as AIChatManager,
    assistantManager: {} as AssistantManager,
    skillManagerCore: {} as SkillManagerCore,
    llmConfigStore: {} as LLMConfigStore,
    customProviderStore: {} as CustomProviderStore,
    customModelStore: {} as CustomModelStore,
    semanticIndexService: {} as SemanticIndexRuntime,
    runAgentStream: async () => {},
  }

  assert.doesNotThrow(() => registerAiRoutes(app, ctx, { requireAi: true }))
})
