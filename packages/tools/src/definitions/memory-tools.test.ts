import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AIMemoryEntry, AIMemoryScope, AIEntityRef, CrossChatEntityResolution } from '@openchatlab/shared-types'
import { ChatType } from '@openchatlab/shared-types'
import { AGENT_TOOL_REGISTRY, CROSS_CHAT_AGENT_TOOL_REGISTRY, MCP_TOOL_REGISTRY } from '../registry'
import type { AIMemoryToolService, CrossChatAnalysisToolService, CrossChatToolExecutionContext } from '../types'
import { memoryForgetTool, memoryReadTool, memoryWriteTool } from './memory-tools'

class FakeMemoryService implements AIMemoryToolService {
  entries: AIMemoryEntry[] = []
  nextId = 1

  list(scope?: AIMemoryScope): AIMemoryEntry[] {
    const matches = scope
      ? this.entries.filter((entry) => entry.scopeType === scope.scopeType && entry.scopeId === scope.scopeId)
      : this.entries
    return [...matches].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
  }

  get(id: string): AIMemoryEntry | null {
    return this.entries.find((entry) => entry.id === id) ?? null
  }

  create(input: Parameters<AIMemoryToolService['create']>[0]): AIMemoryEntry {
    const entry: AIMemoryEntry = {
      ...input,
      id: `memory-${this.nextId++}`,
      sourceAIChatId: input.sourceAIChatId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      createdAt: this.nextId,
      updatedAt: this.nextId,
    }
    this.entries.push(entry)
    return entry
  }

  update(id: string, input: Parameters<AIMemoryToolService['update']>[1]): AIMemoryEntry {
    const current = this.get(id)
    if (!current) throw new Error('not found')
    const updated = { ...current, ...input, updatedAt: current.updatedAt + 10 }
    this.entries = this.entries.map((entry) => (entry.id === id ? updated : entry))
    return updated
  }

  forget(id: string): boolean {
    const before = this.entries.length
    this.entries = this.entries.filter((entry) => entry.id !== id)
    return this.entries.length < before
  }
}

function entityResolution(refs: AIEntityRef[]): CrossChatEntityResolution {
  const contacts = refs
    .filter((ref): ref is Extract<AIEntityRef, { type: 'contact' }> => ref.type === 'contact')
    .map((ref) => ({
      ref,
      status: ref.contactKey === 'contact-1' ? ('resolved' as const) : ('unresolved' as const),
      cacheStatus: 'fresh' as const,
      sessions: [],
      unresolvedSessionIds: [],
      failedSessionIds: [],
    }))
  const sessions = refs
    .filter((ref): ref is Extract<AIEntityRef, { type: 'session' }> => ref.type === 'session')
    .map((ref) => ({
      ref,
      status:
        ref.sessionId === 'group-1' && ref.sessionType === ChatType.GROUP
          ? ('resolved' as const)
          : ('unresolved' as const),
      session:
        ref.sessionId === 'group-1' && ref.sessionType === ChatType.GROUP
          ? {
              sessionId: ref.sessionId,
              sessionName: ref.displayName,
              sessionType: ChatType.GROUP,
              platform: 'test',
              lastMessageTs: null,
            }
          : undefined,
    }))
  const resolvedEntities =
    contacts.filter((item) => item.status === 'resolved').length +
    sessions.filter((item) => item.status === 'resolved').length
  return {
    contacts,
    sessions,
    unresolved: [],
    coverage: {
      requestedEntities: refs.length,
      resolvedEntities,
      candidateSessions: 0,
      resolvedSessions: sessions.filter((item) => item.status === 'resolved').length,
      failedSessions: 0,
    },
  }
}

function createContext(
  options: { allowProactiveMemory?: boolean; entityRefs?: AIEntityRef[] } = {}
): CrossChatToolExecutionContext {
  const analysisService = {
    resolveEntities: async (refs: AIEntityRef[]) => entityResolution(refs),
  } as unknown as CrossChatAnalysisToolService
  return {
    locale: 'zh-CN',
    entityRefs: options.entityRefs,
    analysisService,
    memoryService: new FakeMemoryService(),
    aiChatId: 'global-chat-1',
    allowProactiveMemory: options.allowProactiveMemory ?? true,
    preprocessMessagesBySession: (_sessionId, messages) => messages,
    preprocessSummariesBySession: (_sessionId, summaries) => summaries,
    preprocessModelLabel: (value) => value,
  }
}

describe('global memory tool registry', () => {
  it('registers all three tools only in the global Agent registry', () => {
    const names = [memoryReadTool.name, memoryWriteTool.name, memoryForgetTool.name]
    assert.deepEqual(names, ['memory_read', 'memory_write', 'memory_forget'])
    for (const name of names) {
      assert.equal(
        CROSS_CHAT_AGENT_TOOL_REGISTRY.some((tool) => tool.name === name),
        true
      )
      assert.equal(
        AGENT_TOOL_REGISTRY.some((tool) => tool.name === name),
        false
      )
      assert.equal(
        MCP_TOOL_REGISTRY.some((tool) => tool.name === name),
        false
      )
    }
  })
})

describe('global memory tools', () => {
  it('writes user memory with runtime-owned source metadata and updates only the same scope', async () => {
    const context = createContext()
    const created = await memoryWriteTool.handler(
      {
        scope_type: 'contact',
        scope_id: 'contact-1',
        content: '  用户说这是大学同学  ',
        source_type: 'user',
      },
      context
    )
    const createdEntry = created.data as AIMemoryEntry
    assert.equal(createdEntry.content, '用户说这是大学同学')
    assert.equal(createdEntry.sourceAIChatId, 'global-chat-1')

    const updated = await memoryWriteTool.handler(
      {
        id: createdEntry.id,
        scope_type: 'contact',
        scope_id: 'contact-1',
        content: '用户纠正为高中同学',
        source_type: 'user',
      },
      context
    )
    assert.equal((updated.data as AIMemoryEntry).content, '用户纠正为高中同学')

    await assert.rejects(
      async () =>
        memoryWriteTool.handler(
          {
            id: createdEntry.id,
            scope_type: 'group',
            scope_id: 'group-1',
            content: '错误搬迁',
            source_type: 'user',
          },
          context
        ),
      /scope/i
    )
  })

  it('blocks proactive AI writes when disabled but keeps explicit user writes available', async () => {
    const context = createContext({ allowProactiveMemory: false })
    await assert.rejects(
      async () =>
        memoryWriteTool.handler({ scope_type: 'global', content: 'AI inference', source_type: 'ai' }, context),
      /disabled/i
    )

    const result = await memoryWriteTool.handler(
      { scope_type: 'global', content: '用户明确要求记住', source_type: 'user' },
      context
    )
    assert.equal((result.data as AIMemoryEntry).sourceType, 'user')
  })

  it('requires resolvable stable ids for entity scopes', async () => {
    const context = createContext()
    await assert.rejects(
      async () => memoryReadTool.handler({ scope_type: 'contact', scope_id: 'Alice' }, context),
      /stable contact/i
    )
    await assert.rejects(
      async () =>
        memoryWriteTool.handler(
          { scope_type: 'group', scope_id: 'missing-group', content: 'x', source_type: 'user' },
          context
        ),
      /stable group/i
    )
  })

  it('does not reuse a stale entity scope when the current turn selects another entity', async () => {
    const context = createContext({
      entityRefs: [{ type: 'contact', contactKey: 'contact-1', displayName: 'Current contact' }],
    })

    await assert.rejects(
      async () => memoryReadTool.handler({ scope_type: 'contact', scope_id: 'contact-2' }, context),
      /current turn/i
    )
    await assert.rejects(
      async () =>
        memoryWriteTool.handler(
          { scope_type: 'group', scope_id: 'group-1', content: 'stale group', source_type: 'user' },
          context
        ),
      /current turn/i
    )

    const current = await memoryReadTool.handler({ scope_type: 'contact', scope_id: 'contact-1' }, context)
    assert.deepEqual((current.data as { entries: AIMemoryEntry[] }).entries, [])
  })

  it('returns bounded reads with AI verification guidance and forgets by stable id', async () => {
    const context = createContext()
    const memoryService = context.memoryService as FakeMemoryService
    for (let index = 0; index < 3; index += 1) {
      memoryService.create({
        scopeType: 'global',
        scopeId: null,
        content: `memory-${index}`,
        sourceType: index === 2 ? 'ai' : 'user',
      })
    }

    const read = await memoryReadTool.handler({ scope_type: 'global', limit: 2 }, context)
    assert.equal((read.data as { entries: AIMemoryEntry[] }).entries.length, 2)
    assert.equal((read.data as { truncated: boolean }).truncated, true)
    assert.match(read.content, /重新查询原始聊天证据/)

    const id = (read.data as { entries: AIMemoryEntry[] }).entries[0]!.id
    const forgotten = await memoryForgetTool.handler({ id }, context)
    assert.deepEqual(forgotten.data, { id, deleted: true })
    assert.equal(memoryService.get(id), null)
  })
})
