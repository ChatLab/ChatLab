import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  AIEntityRef,
  CrossChatContactLookupResult,
  CrossChatContactSessionsResult,
  CrossChatEntityResolution,
  CrossChatGroupSessionsRankingResult,
  CrossChatGlobalActivitySummaryResult,
  CrossChatMessageContextResult,
  CrossChatMessageSource,
  CrossChatOverviewResult,
  CrossChatPrivateContactsRankingResult,
  CrossChatRecentSessionResult,
  CrossChatSearchResult,
  CrossChatSharedInteractionsResult,
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

function contactSessionsResult(sessionCount: number, sessionName = 'Work group'): CrossChatContactSessionsResult {
  return {
    algorithmVersion: 'test',
    contact: {
      contactKey: 'test:alice',
      displayName: 'Alice',
      platform: 'test',
      sessionScoped: false,
    },
    appliedRange: {
      startTs: null,
      endTs: null,
      dataEarliestMessageTs: 100,
      dataLatestMessageTs: 200,
    },
    summary: {
      scope: 'current_batch',
      matchedSessions: sessionCount,
      privateSessions: 0,
      groupSessions: sessionCount,
      spokeSessions: sessionCount,
      rosterOnlySessions: 0,
      ownMessageCount: sessionCount * 10,
      firstOwnMessageTs: 100,
      lastOwnMessageTs: 200,
    },
    sessions: Array.from({ length: sessionCount }, (_, index) => ({
      sessionId: `group-${index}`,
      sessionName,
      sessionType: ChatType.GROUP,
      platform: 'test',
      lastMessageTs: 200,
      memberId: index + 1,
      memberName: 'Alice',
      presence: 'spoke',
      presenceObservedInRange: true,
      ownMessageCount: 10,
      sessionMessageCount: 100,
      messageShare: 0.1,
      firstOwnMessageTs: 100,
      lastOwnMessageTs: 200,
      activeDays: 2,
      memberCount: 20,
      sessionFirstMessageTs: 90,
    })),
    coverage: {
      candidateSessions: 20,
      scannedSessions: sessionCount,
      matchedSessions: sessionCount,
      returnedSessions: sessionCount,
      failedSessions: 0,
      failedSessionIds: [],
      complete: false,
      nextCursor: 'next-page',
      truncated: true,
      truncatedReasons: ['page_size'],
      contactCacheStatus: 'fresh',
    },
  }
}

function recentSessionResult(): CrossChatRecentSessionResult {
  return {
    source: {
      sessionId: 'session-a',
      sessionName: 'Session A',
      sessionType: ChatType.PRIVATE,
      platform: 'test',
      lastMessageTs: 10,
    },
    messages: [messageSource('session-a', 7, 10, 'private raw content')],
    summaries: [
      {
        segmentId: 3,
        startTs: 8,
        endTs: 10,
        messageCount: 2,
        participants: ['Alice'],
        summary: 'Recent topic summary',
      },
    ],
    coverage: {
      totalMessages: 100,
      returnedMessages: 1,
      returnedSummaries: 1,
      hasEarlierMessages: true,
    },
  }
}

function privateContactsRankingResult(): CrossChatPrivateContactsRankingResult {
  return {
    algorithmVersion: 'test',
    rankBy: 'message_count',
    appliedRange: {
      startTs: null,
      endTs: null,
      dataEarliestMessageTs: 100,
      dataLatestMessageTs: 200,
      currentTs: 300,
    },
    items: [
      {
        rank: 1,
        contactKey: 'test:alice',
        displayName: 'Alice',
        platform: 'test',
        totalMessages: 20,
        ownerMessages: 9,
        contactMessages: 11,
        activeDays: 3,
        firstMessageTs: 100,
        lastMessageTs: 200,
        sessionIds: ['private-alice'],
      },
    ],
    coverage: {
      candidateSessions: 1,
      scannedSessions: 1,
      analyzedSessions: 1,
      excludedSessions: 0,
      missingOwnerSessions: 0,
      unresolvedOwnerSessions: 0,
      missingContactSessions: 0,
      ambiguousContactSessions: 0,
      failedSessions: 0,
      failedSessionIds: [],
      complete: true,
      truncated: false,
      truncatedReasons: [],
    },
  }
}

function groupSessionsRankingResult(): CrossChatGroupSessionsRankingResult {
  return {
    algorithmVersion: 'test',
    mode: 'owner_activity',
    appliedRange: {
      startTs: null,
      endTs: null,
      dataEarliestMessageTs: 100,
      dataLatestMessageTs: 200,
      currentTs: 300,
    },
    items: [
      {
        rank: 1,
        sessionId: 'group-a',
        sessionName: 'Group A',
        sessionType: ChatType.GROUP,
        platform: 'test',
        totalMessages: 100,
        ownerMessages: 20,
        ownerMessageShare: 0.2,
        ownerActiveDays: 5,
        activeMembers: 10,
        activeDays: 7,
        firstMessageTs: 100,
        lastMessageTs: 200,
        ownerStatus: 'resolved',
      },
    ],
    coverage: {
      candidateSessions: 1,
      scannedSessions: 1,
      analyzedSessions: 1,
      excludedSessions: 0,
      missingOwnerSessions: 0,
      unresolvedOwnerSessions: 0,
      failedSessions: 0,
      failedSessionIds: [],
      complete: true,
      truncated: false,
      truncatedReasons: [],
    },
  }
}

function globalActivitySummaryResult(
  dataState: CrossChatGlobalActivitySummaryResult['dataState'] = 'fresh',
  dailyActivityCount = 1
) {
  return {
    mode: 'year',
    dataState,
    summary: {
      range: { mode: 'year', year: 2026, startTs: 1, endTs: 2 },
      availableDataYears: [2026],
      latestDataYear: 2026,
      metrics: {
        sentMessageCount: 100,
        activeDayCount: 10,
        directContactCount: 5,
        averageMessagesPerDay: 10,
        averageDirectContactsPerDay: 1,
      },
      monthlyActivity: [{ month: '2026-01', messageCount: 100 }],
      monthlyDirectContacts: [{ month: '2026-01', contactCount: 5 }],
      dailyActivity: Array.from({ length: dailyActivityCount }, (_, index) => ({
        date: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
        messageCount: index + 1,
      })),
      messageTypes: [{ type: 0, count: 100 }],
      textLength: { textMessageCount: 100, median: 5, p90: 20, buckets: [] },
      coverage: {
        totalSessions: 2,
        analyzedSessions: 2,
        missingOwnerSessions: 0,
        unresolvedOwnerSessions: 0,
        failedSessions: 0,
      },
      cache: { status: dataState === 'stale' ? 'stale' : 'fresh', computedAt: 300, signature: 'secret' },
      task: {
        id: null,
        status: 'idle',
        startedAt: null,
        finishedAt: null,
        processedSessions: 0,
        totalSessions: 0,
      },
    },
  } satisfies CrossChatGlobalActivitySummaryResult
}

function sharedInteractionsResult(anchorsTruncated: boolean): CrossChatSharedInteractionsResult {
  return {
    algorithmVersion: 'test',
    proximityAlgorithmVersion: 'test',
    participants: [],
    appliedRange: {
      startTs: null,
      endTs: null,
      dataEarliestMessageTs: 100,
      dataLatestMessageTs: 200,
    },
    summary: {
      scope: 'complete_result',
      commonSessions: 1,
      commonPrivateSessions: 0,
      commonGroupSessions: 1,
      sessionsWithDirectReplies: 0,
      sessionsWithProximitySignals: 1,
    },
    sessions: [
      {
        sessionId: 'group-shared',
        sessionName: 'Shared group',
        sessionType: ChatType.GROUP,
        platform: 'test',
        lastMessageTs: 200,
        memberCount: 5,
        participants: [],
        overlapRange: { startTs: 100, endTs: 200 },
        allParticipantsCoActiveDays: 1,
        pairs: [
          {
            sourceParticipantIndex: 0,
            targetParticipantIndex: 1,
            directReplyCount: 0,
            repliesFromSourceToTarget: 0,
            repliesFromTargetToSource: 0,
            lastDirectReplyTs: null,
            coOccurrenceCount: 1,
            coOccurrenceRawScore: 1,
            lastProximityTs: 200,
            coActiveDays: 1,
            anchors: [],
            anchorsTruncated,
          },
        ],
        priorityReasons: ['has_proximity'],
        proximityStatus: 'complete',
      },
    ],
    coverage: {
      candidateSessions: 1,
      scannedSessions: 1,
      matchedSessions: 1,
      returnedSessions: 1,
      failedSessions: 0,
      failedSessionIds: [],
      complete: true,
      nextCursor: null,
      truncated: false,
      truncatedReasons: [],
      unresolvedParticipantIndexes: [],
      identityCollisionSessions: 0,
    },
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
    inspectSharedInteractions: async (): Promise<CrossChatSharedInteractionsResult> => ({
      algorithmVersion: 'test',
      proximityAlgorithmVersion: 'test',
      participants: [],
      appliedRange: {
        startTs: null,
        endTs: null,
        dataEarliestMessageTs: null,
        dataLatestMessageTs: null,
      },
      summary: {
        scope: 'complete_result',
        commonSessions: 0,
        commonPrivateSessions: 0,
        commonGroupSessions: 0,
        sessionsWithDirectReplies: 0,
        sessionsWithProximitySignals: 0,
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
        unresolvedParticipantIndexes: [],
        identityCollisionSessions: 0,
      },
    }),
    readRecentSession: (): CrossChatRecentSessionResult => recentSessionResult(),
    rankPrivateContacts: async (): Promise<CrossChatPrivateContactsRankingResult> => privateContactsRankingResult(),
    rankGroupSessions: async (): Promise<CrossChatGroupSessionsRankingResult> => groupSessionsRankingResult(),
    getGlobalActivitySummary: (): CrossChatGlobalActivitySummaryResult => globalActivitySummaryResult(),
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
      appliedRange: {
        startTs: null,
        endTs: null,
        dataEarliestMessageTs: null,
        dataLatestMessageTs: null,
        currentTs: 1_790_000_000,
      },
      items: [],
      coverage: {
        candidateSessions: 0,
        analyzedSessions: 0,
        excludedSessions: 0,
        missingOwnerSessions: 0,
        unresolvedOwnerSessions: 0,
        failedSessions: 0,
        failedSessionIds: [],
        complete: true,
        truncated: false,
        truncatedReasons: [],
      },
    }),
    ...overrides,
  }
  return {
    locale: 'zh-CN',
    analysisService: service,
    memoryService: {} as CrossChatToolExecutionContext['memoryService'],
    aiChatId: 'global-chat-test',
    allowProactiveMemory: true,
    preprocessMessagesBySession: (_sessionId, messages) =>
      messages.map((message) => ({ ...message, senderName: 'U1', content: '[redacted]' })),
    preprocessSummariesBySession: (_sessionId, summaries) => summaries,
    preprocessModelLabel: (value) => value,
  }
}

describe('cross-chat agent registry', () => {
  it('contains only the thirteen dedicated tools and is isolated from session and MCP registries', () => {
    const names = CROSS_CHAT_AGENT_TOOL_REGISTRY.map((tool) => tool.name)
    assert.deepEqual(names, [
      'resolve_chat_entities',
      'read_recent_session',
      'search_messages_globally',
      'get_cross_chat_message_context',
      'get_cross_chat_overview',
      'rank_private_contacts',
      'rank_group_sessions',
      'get_global_activity_summary',
      'inspect_contact_sessions',
      'inspect_shared_interactions',
      'memory_read',
      'memory_write',
      'memory_forget',
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

  it('passes exact time and rank options to deterministic private-contact ranking', async () => {
    let captured: Parameters<CrossChatAnalysisToolService['rankPrivateContacts']>[0] | undefined
    const context = createContext({
      rankPrivateContacts: async (request) => {
        captured = request
        return privateContactsRankingResult()
      },
    })
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'rank_private_contacts')
    assert.ok(tool)

    const result = await tool.handler(
      {
        start_time: '2026-01-01 00:00',
        end_time: '2026-08-23 12:00',
        rank_by: 'active_days',
        limit: 5,
      },
      context
    )

    assert.equal(captured?.rankBy, 'active_days')
    assert.equal(captured?.limit, 5)
    assert.equal(typeof captured?.startTs, 'number')
    assert.equal(typeof captured?.endTs, 'number')
    assert.deepEqual(result.data, privateContactsRankingResult())
  })

  it('forwards exact overview ranges while keeping execution budgets internal', async () => {
    let captured: Parameters<CrossChatAnalysisToolService['getOverview']>[0] | undefined
    const context = createContext({
      getOverview: async (request) => {
        captured = request
        return {
          appliedRange: {
            startTs: request.startTs ?? null,
            endTs: request.endTs ?? null,
            dataEarliestMessageTs: 100,
            dataLatestMessageTs: 200,
            currentTs: 1_790_000_000,
          },
          items: [],
          coverage: {
            candidateSessions: 1,
            analyzedSessions: 1,
            excludedSessions: 0,
            missingOwnerSessions: 0,
            unresolvedOwnerSessions: 0,
            failedSessions: 0,
            failedSessionIds: [],
            complete: true,
            truncated: false,
            truncatedReasons: [],
          },
        }
      },
    })
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'get_cross_chat_overview')
    assert.ok(tool)
    assert.equal(tool.inputSchema.properties?.max_sessions, undefined)
    assert.equal(tool.inputSchema.properties?.max_wall_time_ms, undefined)

    const result = await tool.handler(
      {
        scopes: [{ sessionId: 'session-a', memberIds: [2], label: 'Alice' }],
        start_time: '2026-01-01 00:00',
        end_time: '2026-08-23 12:00',
        max_sessions: 1,
        max_wall_time_ms: 1,
      },
      context
    )

    assert.equal(typeof captured?.startTs, 'number')
    assert.equal(typeof captured?.endTs, 'number')
    assert.equal(captured?.maxSessions, undefined)
    assert.equal(captured?.maxWallTimeMs, undefined)
    assert.deepEqual((result.data as CrossChatOverviewResult).appliedRange, {
      startTs: captured?.startTs ?? null,
      endTs: captured?.endTs ?? null,
      dataEarliestMessageTs: 100,
      dataLatestMessageTs: 200,
      currentTs: 1_790_000_000,
    })
  })

  it('keeps a multi-group overview within the injected tool token budget', async () => {
    const overview: CrossChatOverviewResult = {
      appliedRange: {
        startTs: 100,
        endTs: 200,
        dataEarliestMessageTs: 100,
        dataLatestMessageTs: 200,
        currentTs: 300,
      },
      items: Array.from({ length: 24 }, (_, sessionIndex) => ({
        sessionId: `group-${sessionIndex}-abcdefghijklmnop`,
        sessionName: `Project collaboration group ${sessionIndex}`,
        sessionType: ChatType.GROUP,
        platform: 'test',
        label: `Project collaboration group ${sessionIndex}`,
        memberActivities: [],
        totalMessages: 10_000 + sessionIndex,
        activeDays: 200,
        activeMembers: 80,
        firstMessageTs: 100,
        lastMessageTs: 200,
        ownerStatus: 'resolved',
        ownerMessages: 1_000,
        ownerActiveDays: 150,
        topMembers: Array.from({ length: 5 }, (_, memberIndex) => ({
          memberId: memberIndex + 1,
          platformId: `wxid-${sessionIndex}-${memberIndex}-abcdefghijklmnop`,
          memberName: `Member ${memberIndex} from project group ${sessionIndex}`,
          messageCount: 2_000 - memberIndex,
          activeDays: 120,
          firstMessageTs: 100,
          lastMessageTs: 200,
        })),
      })),
      coverage: {
        candidateSessions: 24,
        analyzedSessions: 24,
        excludedSessions: 0,
        missingOwnerSessions: 0,
        unresolvedOwnerSessions: 0,
        failedSessions: 0,
        failedSessionIds: [],
        complete: true,
        truncated: false,
        truncatedReasons: [],
      },
    }
    const context = createContext({ getOverview: async () => overview })
    let tokenizerCalls = 0
    const countTokens = (text: string) => {
      tokenizerCalls++
      return Math.ceil(Array.from(text).length / 4)
    }
    context.maxToolResultTokens = 4_096
    context.countTokens = countTokens
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'get_cross_chat_overview')
    assert.ok(tool)

    const result = await tool.handler(
      { scopes: overview.items.map((item) => ({ sessionId: item.sessionId })) },
      context
    )
    const content = JSON.parse(result.content)

    assert.ok(tokenizerCalls > 0)
    assert.ok(countTokens(result.content) <= context.maxToolResultTokens)
    assert.equal(content.selection.sessionItemsTotal, 24)
    assert.equal(content.selection.sessionItemsReturned, 24)
    assert.equal(content.selection.topMembersTotal, 120)
    assert.ok(content.selection.topMembersReturned < 120)
    assert.equal(content.selection.toolResultTruncated, true)
    assert.ok(content.selection.truncatedReasons.includes('top_members_budget'))
    assert.equal((result.data as CrossChatOverviewResult).items.length, 24)
    assert.equal((result.data as CrossChatOverviewResult).items[0]?.topMembers.length, 5)
  })

  it('requires an explicit group-ranking mode and forwards the exact range', async () => {
    let captured: Parameters<CrossChatAnalysisToolService['rankGroupSessions']>[0] | undefined
    const context = createContext({
      rankGroupSessions: async (request) => {
        captured = request
        return groupSessionsRankingResult()
      },
    })
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'rank_group_sessions')
    assert.ok(tool)
    assert.deepEqual(tool.inputSchema.required, ['mode'])

    await tool.handler({ mode: 'total_activity', recent_days: 30, limit: 8 }, context)

    assert.equal(captured?.mode, 'total_activity')
    assert.equal(captured?.recentDays, 30)
    assert.equal(captured?.limit, 8)
    await assert.rejects(async () => tool.handler({ mode: 'unknown' }, context), /mode must be/)
  })

  it('preprocesses model-visible names in rankings and overview while retaining local details', async () => {
    const context = createContext({
      getOverview: async () => ({
        appliedRange: {
          startTs: null,
          endTs: null,
          dataEarliestMessageTs: 100,
          dataLatestMessageTs: 200,
          currentTs: 300,
        },
        items: [
          {
            sessionId: 'group-a',
            sessionName: 'Secret Group',
            sessionType: ChatType.GROUP,
            platform: 'test',
            lastMessageTs: 200,
            label: 'Selected Alice',
            memberIds: [2],
            memberNames: ['Alice'],
            memberActivities: [
              {
                memberId: 2,
                platformId: 'user-2',
                memberName: 'Alice',
                messageCount: 20,
                activeDays: 3,
                firstMessageTs: 100,
                lastMessageTs: 200,
              },
            ],
            totalMessages: 20,
            activeDays: 3,
            activeMembers: 1,
            firstMessageTs: 100,
            ownerStatus: 'resolved',
            ownerMessages: 5,
            ownerActiveDays: 2,
            topMembers: [
              {
                memberId: 3,
                platformId: 'user-3',
                memberName: 'Bob',
                messageCount: 30,
                activeDays: 4,
                firstMessageTs: 100,
                lastMessageTs: 200,
              },
            ],
          },
        ],
        coverage: {
          candidateSessions: 1,
          analyzedSessions: 1,
          excludedSessions: 0,
          missingOwnerSessions: 0,
          unresolvedOwnerSessions: 0,
          failedSessions: 0,
          failedSessionIds: [],
          complete: true,
          truncated: false,
          truncatedReasons: [],
        },
      }),
    })
    context.preprocessModelLabel = (_value, pseudonym) => pseudonym

    const privateTool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'rank_private_contacts')
    const groupTool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'rank_group_sessions')
    const overviewTool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'get_cross_chat_overview')
    assert.ok(privateTool)
    assert.ok(groupTool)
    assert.ok(overviewTool)

    const privateResult = await privateTool.handler({}, context)
    const groupResult = await groupTool.handler({ mode: 'owner_activity' }, context)
    const overviewResult = await overviewTool.handler({ scopes: [{ sessionId: 'group-a' }] }, context)
    const privateContent = JSON.parse(privateResult.content)
    const groupContent = JSON.parse(groupResult.content)
    const overviewContent = JSON.parse(overviewResult.content)

    assert.equal(privateContent.items[0].displayName, 'Contact1')
    assert.equal(groupContent.items[0].sessionName, 'Group1')
    assert.equal(overviewContent.items[0].sessionName, 'Session1')
    assert.equal(overviewContent.items[0].label, 'Session1')
    assert.equal(overviewContent.items[0].memberActivities[0].memberName, 'U2@group-a')
    assert.equal(overviewContent.items[0].topMembers[0].memberName, 'U3@group-a')
    assert.equal((privateResult.data as CrossChatPrivateContactsRankingResult).items[0].displayName, 'Alice')
    assert.equal((groupResult.data as CrossChatGroupSessionsRankingResult).items[0].sessionName, 'Group A')
  })

  it('reads the cached global activity summary without exposing cache signatures', async () => {
    let captured: Parameters<CrossChatAnalysisToolService['getGlobalActivitySummary']>[0] | undefined
    const context = createContext({
      getGlobalActivitySummary: (request) => {
        captured = request
        return globalActivitySummaryResult('stale')
      },
    })
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'get_global_activity_summary')
    assert.ok(tool)

    const result = await tool.handler({ mode: 'year', year: 2026 }, context)
    const content = JSON.parse(result.content)

    assert.deepEqual(captured, { mode: 'year', year: 2026 })
    assert.equal(content.dataState, 'stale')
    assert.equal(content.metrics.sentMessageCount, 100)
    assert.equal(content.cache.computedAt, 300)
    assert.equal(content.cache.signature, undefined)
    assert.deepEqual(result.data, globalActivitySummaryResult('stale'))
  })

  it('keeps a full-year activity summary within the injected tool token budget', async () => {
    const fullSummary = globalActivitySummaryResult('fresh', 366)
    const context = createContext({ getGlobalActivitySummary: () => fullSummary })
    const countTokens = (text: string) => Math.ceil(Array.from(text).length / 4)
    context.maxToolResultTokens = 1_000
    context.countTokens = countTokens
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'get_global_activity_summary')
    assert.ok(tool)

    const result = await tool.handler({ mode: 'year', year: 2024 }, context)
    const content = JSON.parse(result.content)

    assert.ok(countTokens(result.content) <= context.maxToolResultTokens)
    assert.equal(content.metrics.sentMessageCount, 100)
    assert.equal(content.selection.dailyActivityTotal, 366)
    assert.ok(content.selection.dailyActivityReturned < 366)
    assert.equal(content.selection.toolResultTruncated, true)
    assert.ok(content.selection.truncatedReasons.includes('daily_activity_budget'))
    assert.equal((result.data as CrossChatGlobalActivitySummaryResult).summary.dailyActivity.length, 366)
  })

  it('reads one resolved session through the bounded recap path and preserves evidence', async () => {
    let capturedSessionId: string | undefined
    const context = createContext({
      readRecentSession: (sessionId) => {
        capturedSessionId = sessionId
        return recentSessionResult()
      },
    })
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'read_recent_session')
    assert.ok(tool)
    assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}), ['session_id'])

    const result = await tool.handler({ session_id: 'session-a' }, context)
    const content = JSON.parse(result.content)

    assert.equal(capturedSessionId, 'session-a')
    assert.equal(content.selection.strategy, 'latest_session_slice')
    assert.equal(content.selection.hasEarlierMessages, true)
    assert.equal(content.messages[0].content, '[redacted]')
    assert.equal(content.summaries[0].summary, 'Recent topic summary')
    const details = result.data as { crossChatEvidence: { sources: Array<{ snippet: string }> } }
    assert.equal(details.crossChatEvidence.sources[0]?.snippet, '[redacted]')
  })

  it('uses only privacy-processed summaries in recent session tool content', async () => {
    const context = createContext({
      readRecentSession: () => {
        const result = recentSessionResult()
        return {
          ...result,
          summaries: [
            ...result.summaries,
            {
              ...result.summaries[0],
              segmentId: 4,
              participants: ['Bob'],
              summary: 'Filtered summary',
            },
          ],
        }
      },
    })
    context.preprocessSummariesBySession = (sessionId, summaries) => {
      assert.equal(sessionId, 'session-a')
      return summaries.slice(0, 1).map((summary) => ({
        ...summary,
        participants: ['U1@session-a'],
        summary: summary.summary.replace('Recent topic summary', '[safe summary]'),
      }))
    }
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'read_recent_session')
    assert.ok(tool)

    const result = await tool.handler({ session_id: 'session-a' }, context)
    const content = JSON.parse(result.content)

    assert.equal(content.selection.returnedSummaries, 1)
    assert.equal(content.summaries[0].summary, '[safe summary]')
    assert.deepEqual(content.summaries[0].participants, ['U1@session-a'])
    assert.equal(result.content.includes('Recent topic summary'), false)
    assert.equal(result.content.includes('Filtered summary'), false)
    assert.equal(result.content.includes('Alice'), false)
    assert.equal(result.content.includes('Bob'), false)
  })

  it('preprocesses recent-session labels only in model-visible content', async () => {
    const context = createContext()
    context.preprocessModelLabel = (_value, pseudonym) => pseudonym
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'read_recent_session')
    assert.ok(tool)

    const result = await tool.handler({ session_id: 'session-a' }, context)
    const content = JSON.parse(result.content)

    assert.equal(content.source.sessionName, 'Session1')
    assert.equal(content.messages[0].sessionName, 'Session1')
    assert.equal(result.content.includes('Session A'), false)
    const details = result.data as {
      source: { sessionName: string }
      messages: Array<{ sessionName: string }>
      crossChatEvidence: { sources: Array<{ sessionName: string }> }
    }
    assert.equal(details.source.sessionName, 'Session A')
    assert.equal(details.messages[0]?.sessionName, 'Session session-a')
    assert.equal(details.crossChatEvidence.sources[0]?.sessionName, 'Session session-a')
  })

  it('keeps latest private-chat recaps outside the default thirty-day window', () => {
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'search_messages_globally')
    assert.ok(tool)
    assert.match(tool.description, /latest available private-chat recap/i)
    assert.match(tool.description, /omit recent_days/i)
    assert.match(tool.inputSchema.properties?.recent_days?.description ?? '', /latest available private-chat recap/i)
  })

  it('forwards exact shared-interaction participants without accepting display names', async () => {
    let captured: Record<string, unknown> | undefined
    const context = createContext({
      inspectSharedInteractions: async (request) => {
        captured = request as unknown as Record<string, unknown>
        return createContext().analysisService.inspectSharedInteractions({ participants: [] })
      },
    })
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'inspect_shared_interactions')
    assert.ok(tool)

    await tool.handler(
      {
        participants: [{ type: 'owner' }, { type: 'contact', contact_key: 'test:alice' }],
        recent_days: 90,
        page_size: 8,
        max_anchors_per_pair: 3,
      },
      context
    )
    assert.deepEqual(captured, {
      participants: [{ type: 'owner' }, { type: 'contact', contactKey: 'test:alice' }],
      startTs: undefined,
      endTs: undefined,
      recentDays: 90,
      cursor: undefined,
      pageSize: 8,
      maxAnchorsPerPair: 3,
      maxWallTimeMs: undefined,
    })
    await assert.rejects(
      async () => tool.handler({ participants: [{ type: 'contact', display_name: 'Alice' }] }, context),
      /participant.contact_key is required/
    )
  })

  it('clamps shared anchor limits before budget estimation', async () => {
    const requests: Array<Record<string, unknown>> = []
    const context = createContext({
      inspectSharedInteractions: async (request) => {
        requests.push(request as unknown as Record<string, unknown>)
        return createContext().analysisService.inspectSharedInteractions({ participants: [] })
      },
    })
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'inspect_shared_interactions')
    assert.ok(tool)
    assert.equal(tool.inputSchema.properties.max_anchors_per_pair?.minimum, 0)
    assert.equal(tool.inputSchema.properties.max_anchors_per_pair?.maximum, 8)

    await tool.handler(
      {
        participants: [{ type: 'owner' }, { type: 'contact', contact_key: 'test:alice' }],
        max_anchors_per_pair: 1e100,
      },
      context
    )
    context.maxToolResultTokens = 1_000_000
    await tool.handler(
      {
        participants: [{ type: 'owner' }, { type: 'contact', contact_key: 'test:alice' }],
        max_anchors_per_pair: 9,
      },
      context
    )

    assert.deepEqual(
      requests.map((request) => request.maxAnchorsPerPair),
      [8, 8]
    )
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
        recent_days: 90,
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
      recentDays: 90,
      includeRosterOnly: false,
      cursor: undefined,
      pageSize: 12,
      maxWallTimeMs: 5000,
    })
    await assert.rejects(async () => tool.handler({ contact_key: '' }, context), /contact_key is required/)
  })

  it('keeps contact inspection within the model token budget without dropping full tool details', async () => {
    let capturedPageSize: number | undefined
    const longSessionName = '超长群聊名称'.repeat(500)
    let tokenCountCalls = 0
    const countTokens = (text: string) => {
      tokenCountCalls++
      return Math.ceil(Array.from(text).length / 4)
    }
    const context = createContext({
      inspectContactSessions: async (request) => {
        capturedPageSize = request.pageSize
        return contactSessionsResult(request.pageSize ?? 12, longSessionName)
      },
    })
    context.maxToolResultTokens = 1_000
    context.countTokens = countTokens
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'inspect_contact_sessions')
    assert.ok(tool)

    const result = await tool.handler({ contact_key: 'test:alice', page_size: 12 }, context)
    const data = result.data as CrossChatContactSessionsResult
    const modelData = JSON.parse(result.content) as { sessions?: Array<{ sessionName?: string }> }

    assert.ok(capturedPageSize && capturedPageSize < 12)
    assert.equal(data.sessions.length, capturedPageSize)
    assert.equal(data.sessions[0]?.sessionName, longSessionName)
    assert.notEqual(modelData.sessions?.[0]?.sessionName, longSessionName)
    assert.ok(data.coverage.truncatedReasons.includes('tool_result_budget'))
    assert.ok(countTokens(result.content) <= context.maxToolResultTokens)
    assert.ok(tokenCountCalls > 0)
  })

  it('does not report shared-interaction truncation when a reduced budget still returns all data', async () => {
    let sharedRequest: Record<string, unknown> | undefined
    const sharedContext = createContext({
      inspectSharedInteractions: async (request) => {
        sharedRequest = request as unknown as Record<string, unknown>
        return createContext().analysisService.inspectSharedInteractions({ participants: [] })
      },
    })
    sharedContext.maxToolResultTokens = 2_500
    const sharedTool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'inspect_shared_interactions')
    assert.ok(sharedTool)

    const sharedResult = await sharedTool.handler(
      {
        participants: [
          { type: 'owner' },
          { type: 'contact', contact_key: 'test:a' },
          { type: 'contact', contact_key: 'test:b' },
          { type: 'contact', contact_key: 'test:c' },
          { type: 'contact', contact_key: 'test:d' },
        ],
        page_size: 20,
        max_anchors_per_pair: 4,
      },
      sharedContext
    )
    assert.equal(sharedRequest?.pageSize, 1)
    assert.equal(sharedRequest?.maxAnchorsPerPair, 2)
    assert.equal((sharedResult.data as CrossChatSharedInteractionsResult).coverage.truncated, false)
    assert.deepEqual((sharedResult.data as CrossChatSharedInteractionsResult).coverage.truncatedReasons, [])
  })

  it('keeps shared interactions within the model token budget without dropping full tool details', async () => {
    const longSessionName = '超长共同群聊名称'.repeat(500)
    let tokenCountCalls = 0
    const countTokens = (text: string) => {
      tokenCountCalls++
      return Math.ceil(Array.from(text).length / 4)
    }
    const sharedContext = createContext({
      inspectSharedInteractions: async () => {
        const result = sharedInteractionsResult(false)
        result.sessions[0].sessionName = longSessionName
        return result
      },
    })
    sharedContext.maxToolResultTokens = 1_000
    sharedContext.countTokens = countTokens
    const sharedTool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'inspect_shared_interactions')
    assert.ok(sharedTool)

    const result = await sharedTool.handler(
      {
        participants: [{ type: 'owner' }, { type: 'contact', contact_key: 'test:a' }],
      },
      sharedContext
    )
    const data = result.data as CrossChatSharedInteractionsResult
    const modelData = JSON.parse(result.content) as { sessions?: Array<{ sessionName?: string }> }

    assert.equal(data.sessions[0]?.sessionName, longSessionName)
    assert.notEqual(modelData.sessions?.[0]?.sessionName, longSessionName)
    assert.ok(data.coverage.truncatedReasons.includes('tool_result_budget'))
    assert.ok(countTokens(result.content) <= sharedContext.maxToolResultTokens)
    assert.ok(tokenCountCalls > 0)
  })

  it('reports the tool budget when reduced anchor capacity actually omits evidence', async () => {
    const sharedContext = createContext({
      inspectSharedInteractions: async () => sharedInteractionsResult(true),
    })
    sharedContext.maxToolResultTokens = 2_500
    const sharedTool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'inspect_shared_interactions')
    assert.ok(sharedTool)

    const result = await sharedTool.handler(
      {
        participants: [
          { type: 'owner' },
          { type: 'contact', contact_key: 'test:a' },
          { type: 'contact', contact_key: 'test:b' },
          { type: 'contact', contact_key: 'test:c' },
          { type: 'contact', contact_key: 'test:d' },
        ],
        page_size: 20,
        max_anchors_per_pair: 4,
      },
      sharedContext
    )

    assert.deepEqual((result.data as CrossChatSharedInteractionsResult).coverage.truncatedReasons, [
      'tool_result_budget',
    ])
  })

  it('reports the tool budget when a reduced shared-interaction page leaves continuation', async () => {
    const sharedContext = createContext({
      inspectSharedInteractions: async () => {
        const result = sharedInteractionsResult(false)
        return {
          ...result,
          summary: { ...result.summary, scope: 'current_batch' },
          coverage: {
            ...result.coverage,
            complete: false,
            nextCursor: 'next-page',
            truncated: true,
            truncatedReasons: ['page_size'],
          },
        }
      },
    })
    sharedContext.maxToolResultTokens = 2_500
    const sharedTool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'inspect_shared_interactions')
    assert.ok(sharedTool)

    const result = await sharedTool.handler(
      {
        participants: [
          { type: 'owner' },
          { type: 'contact', contact_key: 'test:a' },
          { type: 'contact', contact_key: 'test:b' },
          { type: 'contact', contact_key: 'test:c' },
          { type: 'contact', contact_key: 'test:d' },
        ],
        page_size: 20,
        max_anchors_per_pair: 4,
      },
      sharedContext
    )

    assert.deepEqual((result.data as CrossChatSharedInteractionsResult).coverage.truncatedReasons, [
      'page_size',
      'tool_result_budget',
    ])
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
    const modelData = JSON.parse(result.content) as {
      returned: number
      selection: {
        matchedMessages: number
        contextMessages: number
        privateMessages: number
        groupMessages: number
      }
    }
    const data = result.data as {
      crossChatEvidence: { sources: Array<{ sessionId: string; messageId: number; snippet: string }> }
    }

    assert.equal(result.content.includes('private raw content'), false)
    assert.equal(result.content.includes('[redacted]'), true)
    assert.equal(result.content.includes('crossChatEvidence'), false)
    assert.equal(modelData.returned, 1)
    assert.deepEqual(modelData.selection, {
      matchedMessages: 1,
      contextMessages: 0,
      privateMessages: 1,
      groupMessages: 0,
    })
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

  it('budgets a thousand search messages with logarithmic tokenizer calls', async () => {
    const messages = Array.from({ length: 1_000 }, (_, index) =>
      messageSource('a', index + 1, index + 1, `第 ${index + 1} 条消息：${'聊天内容'.repeat(20)}`)
    )
    const context = createContext({
      searchMessages: async () => ({
        messages,
        totalMatches: messages.length,
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
    let tokenCountCalls = 0
    context.maxToolResultTokens = 20_000
    context.countTokens = (text) => {
      tokenCountCalls++
      return Math.ceil(text.length / 4)
    }
    context.preprocessMessagesBySession = (_sessionId, sessionMessages) => sessionMessages
    const tool = CROSS_CHAT_AGENT_TOOL_REGISTRY.find((item) => item.name === 'search_messages_globally')
    assert.ok(tool)

    const result = await tool.handler({ keywords: ['聊天'] }, context)
    const modelData = JSON.parse(result.content) as { returned: number; coverage: { truncated: boolean } }

    assert.ok(modelData.returned > 0)
    assert.ok(modelData.returned < messages.length)
    assert.equal(modelData.coverage.truncated, true)
    assert.ok(tokenCountCalls <= 11, `expected at most 11 tokenizer calls, got ${tokenCountCalls}`)
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
    })
  })

  it('keeps evidence and execution budgets out of the model-visible search contract', async () => {
    let captured: unknown
    const context = createContext({
      searchMessages: async (request) => {
        captured = request
        return {
          messages: [],
          totalMatches: 0,
          appliedFilters: { startTs: null, endTs: null, recentDays: null, sender: 'all' },
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

    assert.equal(tool.inputSchema.properties?.max_evidence, undefined)
    assert.equal(tool.inputSchema.properties?.max_sessions, undefined)
    assert.equal(tool.inputSchema.properties?.max_wall_time_ms, undefined)
    await tool.handler(
      {
        keywords: ['activity'],
        max_evidence: 1,
        max_sessions: 1,
        max_wall_time_ms: 1,
      },
      context
    )
    assert.equal('maxEvidence' in (captured as Record<string, unknown>), false)
    assert.equal('maxSessions' in (captured as Record<string, unknown>), false)
    assert.equal('maxWallTimeMs' in (captured as Record<string, unknown>), false)
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
            recentDays: 30,
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
    await tool.handler({ keywords: ['买房'], recent_days: 30, sender: 'owner' }, context)

    assert.deepEqual(captured, {
      keywords: ['买房'],
      scopes: undefined,
      startTs: undefined,
      endTs: undefined,
      recentDays: 30,
      sender: 'owner',
      matchMode: 'any',
      sort: 'desc',
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
