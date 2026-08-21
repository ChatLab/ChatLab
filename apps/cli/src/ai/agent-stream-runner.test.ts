import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AIChatManager, AgentStreamChunk, DatabaseManager, LLMConfigStore } from '@openchatlab/node-runtime'
import { getChartCapabilityAllowedBuiltinTools } from '@openchatlab/node-runtime'
import { createCliRunAgentStream, getAllowedToolSet, getAvailableToolDefs } from './agent-stream-runner'

describe('CLI chart capability tool filtering', () => {
  it('does not expose uncategorized raw SQL in chart-only turns', () => {
    const allowedToolSet = new Set(getChartCapabilityAllowedBuiltinTools())

    const toolNames = getAvailableToolDefs(true, allowedToolSet).map((tool) => tool.name)

    assert.deepEqual(toolNames.sort(), ['get_schema', 'render_chart'])
    assert.ok(!toolNames.includes('execute_sql'))
  })

  it('keeps only chart core tools plus explicitly allowed analysis tools', () => {
    const allowedToolSet = new Set(getChartCapabilityAllowedBuiltinTools(['keyword_frequency', 'execute_sql']))

    const toolNames = getAvailableToolDefs(true, allowedToolSet).map((tool) => tool.name)

    assert.deepEqual(toolNames.sort(), ['get_schema', 'keyword_frequency', 'render_chart'])
    assert.ok(!toolNames.includes('execute_sql'))
  })

  it('can expose render_chart for auto skill turns with restrictive assistant tools', () => {
    const allowedToolSet = new Set(getChartCapabilityAllowedBuiltinTools(['keyword_frequency']))

    const toolNames = getAvailableToolDefs(false, allowedToolSet).map((tool) => tool.name)

    assert.ok(toolNames.includes('keyword_frequency'))
    assert.ok(toolNames.includes('render_chart'))
  })

  it('does not expose raw SQL when the assistant did not allow it', () => {
    const allowedToolSet = new Set(['keyword_frequency'])

    const toolNames = getAvailableToolDefs(false, allowedToolSet).map((tool) => tool.name)

    assert.ok(toolNames.includes('keyword_frequency'))
    assert.ok(!toolNames.includes('execute_sql'))
  })

  it('accepts legacy session tool names in assistant allowlists', () => {
    const allowedToolSet = getAllowedToolSet(false, ['get_session_summaries'])

    assert.ok(allowedToolSet instanceof Set)

    const toolNames = getAvailableToolDefs(false, allowedToolSet).map((tool) => tool.name)

    assert.ok(toolNames.includes('get_segment_summaries'))
    assert.ok(!toolNames.includes('get_session_summaries'))
  })

  it('preserves an empty assistant allowlist instead of treating it as unrestricted', () => {
    const allowedToolSet = getAllowedToolSet(false, [])

    assert.ok(allowedToolSet instanceof Set)
    assert.equal(allowedToolSet.size, 0)

    const toolNames = getAvailableToolDefs(false, allowedToolSet).map((tool) => tool.name)

    assert.ok(toolNames.includes('get_schema'))
    assert.ok(!toolNames.includes('keyword_frequency'))
    assert.ok(!toolNames.includes('execute_sql'))
  })
})

describe('CLI agent conversation target validation', () => {
  it('rejects a global conversation before the default session tool path can run', async () => {
    let databaseOpenCalls = 0
    const dbManager = {
      pathProvider: { getAiDataDir: () => '/tmp/chatlab-agent-runner-test' },
      open() {
        databaseOpenCalls++
        throw new Error('session database must not be opened')
      },
    } as unknown as DatabaseManager
    const aiChatManager = {
      getAIChat: () => ({
        id: 'global-chat-1',
        sessionId: '',
        kind: 'global',
        title: null,
        assistantId: 'default',
        createdAt: 1,
        updatedAt: 1,
      }),
    } as unknown as AIChatManager
    const llmConfigStore = {
      getDefaultAssistantConfig: () => null,
    } as unknown as LLMConfigStore
    const events: AgentStreamChunk[] = []
    const runAgentStream = createCliRunAgentStream(dbManager, aiChatManager, { llmConfigStore })

    await runAgentStream(
      {
        userMessage: '分析一下',
        aiChatId: 'global-chat-1',
        sessionId: 'private-session-1',
      },
      (event) => events.push(event),
      new AbortController().signal
    )

    assert.equal(databaseOpenCalls, 0)
    assert.deepEqual(
      events.map((event) => event.type),
      ['error', 'done']
    )
    assert.match(String(events[0]?.error && (events[0].error as { message?: string }).message), /does not match/)
  })
})
