import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as nodeRuntime from '../packages/node-runtime/src/index'
import { runServerAgent } from '../apps/cli/src/ai/agent'
import { AIChatManager } from '../packages/node-runtime/src/ai/chats'
import { runCrossChatAgent } from '../packages/node-runtime/src/ai/cross-chat-agent'
import type { AgentStreamChunk } from '../packages/node-runtime/src/ai/agent/event-handler'
import { buildPiModel } from '../packages/node-runtime/src/ai/llm-builder'
import { createAiTranslate } from '../packages/node-runtime/src/ai/i18n'
import type { LLMConfigStore } from '../packages/node-runtime/src/ai/llm-config-store'

// Exercise the real Pi SSE parser and all Node entry points, without a real provider or user data.
test('session and global agents surface truncated output instead of reporting successful completion', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-agent-output-limit-'))
  const manager = new AIChatManager(dir, { nativeBinding: process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING })
  const config = {
    provider: 'deepseek' as const,
    model: 'deepseek-v4-flash',
    baseUrl: 'https://provider.invalid/v1',
    apiKey: 'test-placeholder',
  }
  try {
    // Desktop sources load as CommonJS in tsx; keep the shared ESM runtime unchanged.
    await t.mock.module('../packages/node-runtime/src/index', { namedExports: nodeRuntime })
    // Isolate Desktop host services while keeping its Agent and stream runner real.
    await t.mock.module('../apps/desktop/main/ai/chats', {
      namedExports: {
        getManager: () => manager,
        getHistoryForAgent: manager.getHistoryForAgent.bind(manager),
        setPendingDebugContext: manager.setPendingDebugContext.bind(manager),
      },
    })
    await t.mock.module('../apps/desktop/main/ai/llm', {
      namedExports: { buildPiModel, findModelDefinition: () => null, getProviderInfo: () => null },
    })
    await t.mock.module('../apps/desktop/main/ai/logger', {
      namedExports: {
        aiLogger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
          debug: () => undefined,
        },
        isDebugMode: () => false,
      },
    })
    await t.mock.module('../apps/desktop/main/i18n', { namedExports: { t: createAiTranslate('en-US') } })
    await t.mock.module('../apps/desktop/main/ai/tools', {
      namedExports: { getAllTools: async () => [], createActivateSkillTool: () => undefined },
    })
    await t.mock.module('../apps/desktop/main/ai/assistant/manager', {
      namedExports: { getAssistantConfig: () => null },
    })
    await t.mock.module('../apps/desktop/main/ai/skills/manager', {
      namedExports: { getSkillConfig: () => null, getSkillMenu: () => '' },
    })
    await t.mock.module('../apps/desktop/main/worker/workerManager', {
      namedExports: { getChatOverview: async () => null },
    })
    await t.mock.module('../apps/desktop/main/ai/cross-chat-tool-adapter', {
      namedExports: { createElectronCrossChatTools: () => [] },
    })
    const { createElectronRunAgentStream } = await import('../apps/desktop/main/ai/agent-stream-runner')
    const runDesktopAgent = createElectronRunAgentStream({
      getDefaultAssistantConfig: () => config,
    } as LLMConfigStore)

    for (const kind of ['session', 'global', 'desktop session'] as const) {
      for (const scenario of [
        { name: 'thinking only', text: '', finishReason: 'length' },
        { name: 'partial answer', text: 'The conclusion is', finishReason: 'length' },
        { name: 'complete answer', text: 'The conclusion is complete.', finishReason: 'stop' },
      ]) {
        await t.test(`${kind}: ${scenario.name}`, async (t) => {
          t.mock.method(globalThis, 'fetch', async () => {
            const chunks = [
              { delta: { role: 'assistant', reasoning_content: 'Checking the evidence.' }, finish_reason: null },
              { delta: { content: scenario.text }, finish_reason: null },
              { delta: {}, finish_reason: scenario.finishReason },
            ].map((choice) => ({
              id: 'test-completion',
              object: 'chat.completion.chunk',
              created: 1,
              model: config.model,
              choices: [{ index: 0, ...choice }],
              ...(choice.finish_reason
                ? {
                    usage: {
                      prompt_tokens: 100,
                      completion_tokens: 25,
                      total_tokens: 125,
                      prompt_tokens_details: { cached_tokens: 20 },
                    },
                  }
                : {}),
            }))
            return new Response(
              chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
              {
                headers: { 'Content-Type': 'text/event-stream' },
              }
            )
          })
          const chat =
            kind === 'global'
              ? manager.createGlobalAIChat('Output limit', 'general_en')
              : manager.createAIChat('session-1', 'Output limit', 'general_en')
          const events: AgentStreamChunk[] = []
          const common = {
            userMessage: 'Explain what a chat assistant is. Do not query any data.',
            aiChatId: chat.id,
            historyLeafMessageId: null,
            locale: 'en-US',
            aiChatManager: manager,
            onEvent: (event: AgentStreamChunk) => events.push(event),
          }
          if (kind === 'global') {
            await runCrossChatAgent({
              ...common,
              piModel: buildPiModel(config),
              apiKey: config.apiKey,
              tools: [],
              memoryService: { list: () => [] },
            })
          } else if (kind === 'desktop session') {
            await runDesktopAgent(
              { ...common, sessionId: 'session-1', chatType: 'private' },
              common.onEvent,
              new AbortController().signal
            )
          } else {
            await runServerAgent({ ...common, llmConfig: config })
          }

          assert.equal(
            events
              .filter((event) => event.type === 'content')
              .map((event) => event.content)
              .join(''),
            scenario.text
          )
          assert.ok(events.some((event) => event.type === 'think' && event.content === 'Checking the evidence.'))
          const errors = events.filter((event) => event.type === 'error')
          const truncated = scenario.finishReason === 'length'
          assert.equal(errors.length, truncated ? 1 : 0)
          if (truncated) assert.match((errors[0].error as { message: string }).message, /output limit/i)
          assert.deepEqual(
            events
              .filter((event) => event.type === 'status')
              .map((event) => event.status?.phase)
              .filter((phase) => phase === 'completed' || phase === 'error' || phase === 'aborted'),
            [truncated ? 'error' : 'completed']
          )
          assert.equal(events.filter((event) => event.type === 'done').length, 1)
          assert.equal(events.at(-1)?.type, 'done')
          const doneUsage = events.at(-1)?.usage
          const expectedUsage = {
            promptTokens: 80,
            completionTokens: 25,
            totalTokens: 125,
            cacheReadTokens: 20,
            cacheWriteTokens: 0,
          }
          assert.deepEqual(doneUsage, expectedUsage)
          manager.addMessagePair(
            chat.id,
            { content: common.userMessage },
            { content: scenario.text, tokenUsage: doneUsage }
          )
          assert.deepEqual(manager.getAIChatTokenUsage(chat.id), expectedUsage)
        })
      }
    }
  } finally {
    manager.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
