import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  AIEntityRef,
  CrossChatContactLookupResult,
  CrossChatContactSessionsResult,
  CrossChatEntityResolution,
  CrossChatMessageContextResult,
  CrossChatMessageSource,
  CrossChatOverviewResult,
  CrossChatSearchResult,
} from '@openchatlab/shared-types'
import { ChatType } from '@openchatlab/shared-types'
import { AGENT_TOOL_REGISTRY, CROSS_CHAT_AGENT_TOOL_REGISTRY, MCP_TOOL_REGISTRY } from '../registry'
import type { CrossChatAnalysisToolService, CrossChatToolExecutionContext } from '../types'

function messageSource(
  sessionId: string,
  messageId: number,
  timestamp: number,
  content = `message-${messageId}`
): CrossChatMessageSource {
  return {
    sessionId,
    sessionName: `Session ${sessionId}`,
    sessionType: ChatType.PRIVATE,
    platform: 'test',
    lastMessageTs: timestamp,
    messageId,
    senderId: 2,
    senderName: 'Alice',
    senderPlatformId: 'alice',
    content,
    timestamp,
    messageType: 0,
  }
}

function createContext(overrides: Partial<CrossChatAnalysisToolService> = {}): CrossChatToolExecutionContext {
  const service: CrossChatAnalysisToolService = {
    lookupContact: (query: string): CrossChatContactLookupResult => ({
      query,
      status: 'not_found',
      cacheStatus: 'fresh',
      totalCandidates: 0,
      candidates: [],
    }),
    resolveEntities: async (_refs: AIEntityRef[]): Promise<CrossChatEntityResolution> => ({
      contacts: [],
      sessions: [],
      unresolved: [],
      coverage: {
        requestedEntities: 0,
        resolvedEntities: 0,
        candidateSessions: 0,
        resolvedSessions: 0,
        failedSessions: 0,
      },
    }),
    inspectContactSessions: async (): Promise<CrossChatContactSessionsResult> => ({
      algorithmVersion: 'test',
      contact: null,
      appliedRange: {
        startTs: null,
        endTs: null,
        dataEarliestMessageTs: null,
        dataLatestMessageTs: null,
      },
      summary: {
        scope: 'complete_result',
        matchedSessions: 0,
        privateSessions: 0,
        groupSessions: 0,
        spokeSessions: 0,
        rosterOnlySessions: 0,
        ownMessageCount: 0,
        firstOwnMessageTs: null,
        lastOwnMessageTs: null,
      },
      sessions: [],
      coverage: {
        candidateSessions: 0,
        scannedSessions: 0,
        matchedSessions: 0,
        returnedSessions: 0,
        failedSessions: 0,
        failedSessionIds: [],
        complete: true,
        nextCursor: null,
        truncated: false,
        truncatedReasons: [],
        contactCacheStatus: 'fresh',
      },
    }),
    searchMessages: async (): Promise<CrossChatSearchResult> => ({
      messages: [
        {
          sessionId: 'session-a',
          sessionName: 'Session A',
          sessionType: ChatType.PRIVATE,
          platform: 'test',
          lastMessageTs: 10,
          messageId: 7,
          senderId: 2,
          senderName: 'Alice',
          senderPlatformId: 'alice',
          content: 'private raw content',
          timestamp: 10,
          messageType: 0,
        },
      ],
      totalMatches: 1,
      appliedFilters: {
        startTs: null,
        endTs: null,
        recentDays: null,
        sender: 'all',
      },
      coverage: {
        candidateSessions: 1,
        scannedSessions: 1,
        matchedSessions: 1,
        failedSessions: 0,
        truncated: false,
        truncatedReasons: [],
      },
    }),
    getMessageContext: (): CrossChatMessageContextResult => ({
      source: {
        sessionId: 'session-a',
        sessionName: 'Session A',
        sessionType: ChatType.PRIVATE,
        platform: 'test',
        lastMessageTs: 10,
      },
      messages: [],
    }),
    getOverview: async (): Promise<CrossChatOverviewResult> => ({
      items: [],
      coverage: {
        candidateSessions: 0,
        analyzedSessions: 0,
        failedSessions: 0,
        truncated: false,
        truncatedReasons: [],
      },
    }),
    ...overrides,
  }
  return {
    locale: 'zh-CN',
    analysisService: service,
    preprocessMessagesBySession: (_sessionId, messages) =>
      messages.map((message) => ({ ...message, senderName: 'U1', content: '[redacted]' })),
  }
}

describe('cross-chat agent registry', () => {
  it('contains only the five dedicated tools and is isolated from session and MCP registries', () => {
    const names = CROSS_CHAT_AGENT_TOOL_REGISTRY.map((tool) => tool.name)
    assert.deepEqual(names, [
      'resolve_chat_entities',
      'search_messages_globally',
      'get_cross_chat_message_context',
      'get_cross_chat_overview',
      'inspect_contact_sessions',
    ])
    for (const name of names) {
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

  it('requires a stable contact key and forwards contact-session inspection options', async () => {
    let captured: Record<string, unknown> | undefined
    const context = createContext({
      inspectContactSessions: async (request) => {
        captured = request as unknown as Record<string, unknown>
        return createContext().analysisService.inspectContactSessions({ contactKey: 'unused' })
      },
    })
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'inspect_contact_sessions')
    assert.ok(tool)

    await tool.handler(
      {
        contact_key: 'test:alice',
        include_roster_only: false,
        page_size: 12,
        max_wall_time_ms: 5000,
      },
      context
    )
    assert.deepEqual(captured, {
      contactKey: 'test:alice',
      startTs: undefined,
      endTs: undefined,
      includeRosterOnly: false,
      cursor: undefined,
      pageSize: 12,
      maxWallTimeMs: 5000,
    })
    await assert.rejects(async () => tool.handler({ contact_key: '' }, context), /contact_key is required/)
  })

  it('resolves a unique contact name before continuing with stable scopes', async () => {
    let resolvedRefs: AIEntityRef[] = []
    const context = createContext({
      lookupContact: () => ({
        query: '小红',
        status: 'resolved',
        cacheStatus: 'fresh',
        totalCandidates: 1,
        candidates: [
          {
            contactKey: 'test:xiaohong',
            displayName: '小红',
            platform: 'test',
            aliases: [],
            sourceSessions: [{ id: 'private-xiaohong', name: '小红', type: ChatType.PRIVATE }],
          },
        ],
      }),
      resolveEntities: async (refs, options) => {
        resolvedRefs = refs
        assert.equal(options?.signal, context.abortSignal)
        return {
          contacts: [],
          sessions: [],
          unresolved: [],
          coverage: {
            requestedEntities: refs.length,
            resolvedEntities: refs.length,
            candidateSessions: 1,
            resolvedSessions: 1,
            failedSessions: 0,
          },
        }
      },
    } as Partial<CrossChatAnalysisToolService>)
    const controller = new AbortController()
    context.abortSignal = controller.signal
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'resolve_chat_entities')
    assert.ok(tool)

    const result = await tool.handler({ entities: [{ type: 'contact', displayName: '小红' }] }, context)
    assert.deepEqual(resolvedRefs, [{ type: 'contact', contactKey: 'test:xiaohong', displayName: '小红' }])
    assert.equal((result.data as { contactLookups: Array<{ status: string }> }).contactLookups[0]?.status, 'resolved')
  })

  it('returns ambiguous contact candidates without choosing one', async () => {
    let resolvedRefs: AIEntityRef[] = []
    const context = createContext({
      lookupContact: () => ({
        query: '小红',
        status: 'ambiguous',
        cacheStatus: 'fresh',
        totalCandidates: 2,
        candidates: [
          {
            contactKey: 'test:xiaohong-1',
            displayName: '小红',
            platform: 'test',
            aliases: ['小红 A'],
            sourceSessions: Array.from({ length: 5 }, (_, index) => ({
              id: `group-${index}`,
              name: `小红所在群 ${index}`,
              type: ChatType.GROUP,
            })),
          },
          {
            contactKey: 'test:xiaohong-2',
            displayName: '小红',
            platform: 'test',
            aliases: ['小红 B'],
            sourceSessions: [{ id: 'private-2', name: '小红 B', type: ChatType.PRIVATE }],
          },
        ],
      }),
      resolveEntities: async (refs) => {
        resolvedRefs = refs
        return {
          contacts: [],
          sessions: [],
          unresolved: [],
          coverage: {
            requestedEntities: refs.length,
            resolvedEntities: 0,
            candidateSessions: 0,
            resolvedSessions: 0,
            failedSessions: 0,
          },
        }
      },
    } as Partial<CrossChatAnalysisToolService>)
    context.maxToolResultTokens = 2_000
    context.countTokens = (text) => Math.ceil(text.length / 4)
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'resolve_chat_entities')
    assert.ok(tool)

    const result = await tool.handler({ entities: [{ type: 'contact', displayName: '小红' }] }, context)
    assert.deepEqual(resolvedRefs, [])
    assert.equal((result.data as { contactLookups: Array<{ status: string }> }).contactLookups[0]?.status, 'ambiguous')
    const modelData = JSON.parse(result.content) as {
      contactLookups: Array<{
        candidates: Array<{
          sourceSessionCount: number
          sourceSessionHints: unknown[]
          sourceSessionHintsTruncated: boolean
        }>
      }>
    }
    assert.equal(modelData.contactLookups[0]?.candidates[0]?.sourceSessionCount, 5)
    assert.equal(modelData.contactLookups[0]?.candidates[0]?.sourceSessionHints.length, 3)
    assert.equal(modelData.contactLookups[0]?.candidates[0]?.sourceSessionHintsTruncated, true)
  })

  it('budgets model-visible entity scopes without dropping full tool details', async () => {
    const resolvedSessions = Array.from({ length: 100 }, (_, index) => ({
      sessionId: `group-${index}`,
      sessionName: `工作交流群 ${index}`,
      sessionType: ChatType.GROUP,
      platform: 'test' as const,
      lastMessageTs: 1000 - index,
      memberId: index + 1,
      memberPlatformId: 'xiaohong',
      memberName: '小红',
    }))
    const sourceSessions = resolvedSessions.map((session) => ({
      id: session.sessionId,
      name: session.sessionName,
      type: session.sessionType,
    }))
    const context = createContext({
      lookupContact: () => ({
        query: '小红',
        status: 'resolved',
        cacheStatus: 'fresh',
        totalCandidates: 1,
        candidates: [
          {
            contactKey: 'test:xiaohong',
            displayName: '小红',
            platform: 'test',
            aliases: [],
            sourceSessions,
          },
        ],
      }),
      resolveEntities: async () => ({
        contacts: [
          {
            ref: { type: 'contact', contactKey: 'test:xiaohong', displayName: '小红' },
            status: 'resolved',
            cacheStatus: 'fresh',
            sessions: resolvedSessions,
            unresolvedSessionIds: [],
            failedSessionIds: [],
          },
        ],
        sessions: [],
        unresolved: [],
        coverage: {
          requestedEntities: 1,
          resolvedEntities: 1,
          candidateSessions: resolvedSessions.length,
          resolvedSessions: resolvedSessions.length,
          failedSessions: 0,
        },
      }),
    })
    const countTokens = (text: string) => Math.ceil(text.length / 4)
    context.maxToolResultTokens = 800
    context.countTokens = countTokens
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'resolve_chat_entities')
    assert.ok(tool)

    const result = await tool.handler({ entities: [{ type: 'contact', displayName: '小红' }] }, context)
    const modelData = JSON.parse(result.content) as {
      contacts: Array<{ sessionCount: number; returnedSessions: number; sessions: unknown[] }>
      coverage: { returnedSourceScopes: number; truncated: boolean; truncatedReasons: string[] }
      contactLookups: Array<{
        candidates: Array<{ sourceSessionCount: number; sourceSessions?: unknown[] }>
      }>
    }
    const details = result.data as {
      contacts: Array<{ sessions: unknown[] }>
      contactLookups: Array<{ candidates: Array<{ sourceSessions: unknown[] }> }>
    }

    assert.ok(countTokens(result.content) <= 800)
    assert.equal(modelData.coverage.truncated, true)
    assert.ok(modelData.coverage.truncatedReasons.includes('tool_result_budget'))
    assert.ok(modelData.coverage.returnedSourceScopes < resolvedSessions.length)
    assert.equal(modelData.contacts[0]?.sessionCount, resolvedSessions.length)
    assert.equal(modelData.contacts[0]?.returnedSessions, modelData.contacts[0]?.sessions.length)
    assert.equal(modelData.contactLookups[0]?.candidates[0]?.sourceSessionCount, sourceSessions.length)
    assert.equal(modelData.contactLookups[0]?.candidates[0]?.sourceSessions, undefined)
    assert.equal(details.contacts[0]?.sessions.length, resolvedSessions.length)
    assert.equal(details.contactLookups[0]?.candidates[0]?.sourceSessions.length, sourceSessions.length)
  })

  it('sanitizes each session before returning global search evidence', async () => {
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'search_messages_globally')
    assert.ok(tool)
    const result = await tool.handler({ keywords: ['private'] }, createContext())
    const data = result.data as {
      crossChatEvidence: { sources: Array<{ sessionId: string; messageId: number; snippet: string }> }
    }

    assert.equal(result.content.includes('private raw content'), false)
    assert.equal(result.content.includes('[redacted]'), true)
    assert.equal(result.content.includes('crossChatEvidence'), false)
    assert.deepEqual(data.crossChatEvidence.sources, [
      {
        sessionId: 'session-a',
        sessionName: 'Session A',
        sessionType: 'private',
        platform: 'test',
        messageId: 7,
        senderName: 'U1',
        timestamp: 10,
        snippet: '[redacted]',
      },
    ])
  })

  it('preserves the requested search ordering across per-session preprocessing', async () => {
    const context = createContext({
      searchMessages: async () => ({
        messages: [messageSource('a', 1, 1), messageSource('b', 1, 2), messageSource('a', 2, 3)],
        totalMatches: 3,
        appliedFilters: { startTs: null, endTs: null, recentDays: null, sender: 'all' },
        coverage: {
          candidateSessions: 2,
          scannedSessions: 2,
          matchedSessions: 2,
          failedSessions: 0,
          truncated: false,
          truncatedReasons: [],
        },
      }),
    })
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'search_messages_globally')
    assert.ok(tool)

    const result = await tool.handler({ keywords: ['message'], sort: 'asc' }, context)
    const messages = (result.data as { messages: Array<{ sessionId: string; messageId: number }> }).messages

    assert.deepEqual(
      messages.map((message) => [message.sessionId, message.messageId]),
      [
        ['a', 1],
        ['b', 1],
        ['a', 2],
      ]
    )
  })

  it('budgets the complete model-visible search payload without duplicating evidence snippets', async () => {
    const context = createContext({
      searchMessages: async () => ({
        messages: [messageSource('a', 1, 1, 'x'.repeat(500))],
        totalMatches: 1,
        appliedFilters: { startTs: null, endTs: null, recentDays: null, sender: 'all' },
        coverage: {
          candidateSessions: 1,
          scannedSessions: 1,
          matchedSessions: 1,
          failedSessions: 0,
          truncated: false,
          truncatedReasons: [],
        },
      }),
    })
    context.maxToolResultTokens = 300
    context.preprocessMessagesBySession = (_sessionId, messages) => messages
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'search_messages_globally')
    assert.ok(tool)

    const result = await tool.handler({ keywords: ['x'] }, context)
    const modelData = JSON.parse(result.content) as Record<string, unknown>
    const details = result.data as {
      returned: number
      crossChatEvidence: { sources: Array<{ snippet: string }> }
    }

    assert.ok(result.content.length <= 300 * 4)
    assert.equal('crossChatEvidence' in modelData, false)
    assert.equal(details.returned, 1)
    assert.equal(details.crossChatEvidence.sources[0]?.snippet, 'x'.repeat(500))
  })

  it('uses the injected tokenizer when budgeting Chinese search payloads', async () => {
    const context = createContext({
      searchMessages: async () => ({
        messages: [messageSource('a', 1, 1, '中文消息'.repeat(125))],
        totalMatches: 1,
        appliedFilters: { startTs: null, endTs: null, recentDays: null, sender: 'all' },
        coverage: {
          candidateSessions: 1,
          scannedSessions: 1,
          matchedSessions: 1,
          failedSessions: 0,
          truncated: false,
          truncatedReasons: [],
        },
      }),
    })
    context.maxToolResultTokens = 300
    const countTokens = (text: string) => {
      let tokens = 0
      for (const char of text) tokens += /[\u3400-\u9fff]/u.test(char) ? 1 : 0.25
      return Math.ceil(tokens)
    }
    context.countTokens = countTokens
    context.preprocessMessagesBySession = (_sessionId, messages) => messages
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'search_messages_globally')
    assert.ok(tool)

    const result = await tool.handler({ keywords: ['中文'] }, context)
    const details = result.data as {
      returned: number
      coverage: { truncatedReasons: string[] }
      crossChatEvidence: { sources: unknown[] }
    }

    assert.ok(countTokens(result.content) <= 300)
    assert.equal(details.returned, 0)
    assert.deepEqual(details.crossChatEvidence.sources, [])
    assert.ok(details.coverage.truncatedReasons.includes('evidence_budget'))
  })

  it('allows recent-message sampling only when explicit scopes are present', async () => {
    let captured: unknown
    const context = createContext({
      searchMessages: async (request) => {
        captured = request
        return {
          messages: [],
          totalMatches: 0,
          appliedFilters: {
            startTs: null,
            endTs: null,
            recentDays: null,
            sender: 'all',
          },
          coverage: {
            candidateSessions: 1,
            scannedSessions: 1,
            matchedSessions: 0,
            failedSessions: 0,
            truncated: false,
            truncatedReasons: [],
          },
        }
      },
    })
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'search_messages_globally')
    assert.ok(tool)
    await tool.handler({ scopes: [{ sessionId: 'session-a', memberIds: [2] }] }, context)
    assert.deepEqual(captured, {
      keywords: [],
      scopes: [{ sessionId: 'session-a', memberIds: [2], label: undefined }],
      startTs: undefined,
      endTs: undefined,
      recentDays: undefined,
      sender: 'all',
      matchMode: 'any',
      sort: 'desc',
      maxSessions: undefined,
      maxEvidence: undefined,
      maxWallTimeMs: undefined,
    })
  })

  it('forwards relative time and owner-only filters for global discovery', async () => {
    let captured: unknown
    const context = createContext({
      searchMessages: async (request) => {
        captured = request
        return {
          messages: [],
          totalMatches: 0,
          appliedFilters: {
            startTs: 100,
            endTs: null,
            recentDays: 90,
            sender: 'owner',
          },
          coverage: {
            candidateSessions: 1,
            scannedSessions: 1,
            matchedSessions: 0,
            failedSessions: 0,
            ownerResolution: {
              resolvedSessions: 1,
              missingOwnerSessions: 0,
              unresolvedOwnerSessions: 0,
            },
            truncated: false,
            truncatedReasons: [],
          },
        }
      },
    })
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'search_messages_globally')
    assert.ok(tool)
    await tool.handler({ keywords: ['买房'], recent_days: 90, sender: 'owner' }, context)

    assert.deepEqual(captured, {
      keywords: ['买房'],
      scopes: undefined,
      startTs: undefined,
      endTs: undefined,
      recentDays: 90,
      sender: 'owner',
      matchMode: 'any',
      sort: 'desc',
      maxSessions: undefined,
      maxEvidence: undefined,
      maxWallTimeMs: undefined,
    })
  })

  it('requires compound source identity for cross-chat context lookup', async () => {
    let captured: unknown
    const context = createContext({
      getMessageContext: (request) => {
        captured = request
        return {
          source: {
            sessionId: request.sessionId,
            sessionName: 'Session A',
            sessionType: ChatType.PRIVATE,
            platform: 'test',
            lastMessageTs: null,
          },
          messages: [],
        }
      },
    })
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'get_cross_chat_message_context')
    assert.ok(tool)
    await tool.handler({ session_id: 'session-a', message_id: 7, context_size: 3 }, context)
    assert.deepEqual(captured, { sessionId: 'session-a', messageId: 7, contextSize: 3 })
  })

  it('retains the requested context anchor under a small model result budget', async () => {
    const context = createContext({
      getMessageContext: () => ({
        source: {
          sessionId: 'session-a',
          sessionName: 'Session A',
          sessionType: ChatType.PRIVATE,
          platform: 'test',
          lastMessageTs: 101,
        },
        messages: Array.from({ length: 101 }, (_, index) =>
          messageSource('session-a', index + 1, index + 1, 'x'.repeat(500))
        ),
      }),
    })
    context.maxToolResultTokens = 1024
    context.preprocessMessagesBySession = (_sessionId, messages) => messages
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'get_cross_chat_message_context')
    assert.ok(tool)

    const result = await tool.handler({ session_id: 'session-a', message_id: 51, context_size: 50 }, context)
    const data = result.data as { truncated: boolean; messages: Array<{ messageId: number }> }
    const ids = data.messages.map((message) => message.messageId)

    assert.equal(data.truncated, true)
    assert.equal(ids.includes(51), true)
    assert.deepEqual(
      ids,
      [...ids].sort((left, right) => left - right)
    )
    assert.ok(result.content.length <= 1024 * 4)
  })
})
