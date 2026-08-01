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

function completeContext(): AiRoutesContext {
  return {
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
}

test('registerAiRoutes identifies each missing required dependency', () => {
  const requiredDependencies = [
    'aiDataDir',
    'aiChatManager',
    'assistantManager',
    'skillManagerCore',
    'llmConfigStore',
    'customProviderStore',
    'customModelStore',
    'runAgentStream',
  ] as const satisfies ReadonlyArray<keyof AiRoutesContext>

  for (const dependency of requiredDependencies) {
    const app = Fastify()
    const context = completeContext()
    delete context[dependency]

    assert.throws(() => registerAiRoutes(app, context, { requireAi: true }), new RegExp(dependency))
  }
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

  assert.doesNotThrow(() => registerAiRoutes(app, completeContext(), { requireAi: true }))
})
