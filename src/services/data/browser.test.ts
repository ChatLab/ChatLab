import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  RpcRequestOptions,
  WebRuntimeTaskPayload,
  WebRuntimeTaskResult,
  WebRuntimeTaskType,
} from '@openchatlab/web-runtime'
import { abortAnalyticsRequests } from '../utils/http'
import { createBrowserDataAdapter } from './browser'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('BrowserDataAdapter', () => {
  it('maps catalog sessions and forwards session mutations through RPC', async () => {
    const requests: Array<{ type: WebRuntimeTaskType; payload: unknown }> = []
    const item = {
      id: 'session-one',
      name: 'One',
      platform: 'wechat',
      type: 'group',
      importedAt: 1,
      messageCount: 2,
      memberCount: 1,
      groupId: null,
      groupAvatar: null,
      ownerId: null,
      lastMessageTs: 2,
      formatId: 'chatlab',
    }
    const rpc = {
      async request<T extends WebRuntimeTaskType>(
        type: T,
        payload: WebRuntimeTaskPayload<T>,
        _options?: RpcRequestOptions
      ): Promise<WebRuntimeTaskResult<T>> {
        requests.push({ type, payload })
        const result =
          type === 'session.list'
            ? [item]
            : type === 'session.get'
              ? item
              : type === 'analysis.hourly'
                ? Array.from({ length: 24 }, (_, hour) => ({ hour, messageCount: hour === 8 ? 2 : 0 }))
                : type === 'analysis.daily'
                  ? [{ date: '2024-01-02', messageCount: 2 }]
                  : type === 'analysis.weekday'
                    ? Array.from({ length: 7 }, (_, index) => ({
                        weekday: index + 1,
                        messageCount: index === 1 ? 2 : 0,
                      }))
                    : type === 'analysis.timeRange'
                      ? { start: 1, end: 2 }
                      : type === 'analysis.availableYears'
                        ? [2024]
                        : type === 'analysis.members'
                          ? [
                              {
                                memberId: 1,
                                platformId: 'alice',
                                name: 'Alice',
                                avatar: null,
                                messageCount: 2,
                                percentage: 100,
                              },
                            ]
                          : type === 'analysis.messageTypes'
                            ? [
                                { type: 1, count: 2 },
                                { type: 0, count: 1 },
                              ]
                            : type === 'analysis.messageLengths'
                              ? { detail: [{ len: 1, count: 2 }], grouped: [{ range: '1-5', count: 2 }] }
                              : type === 'analysis.textStats'
                                ? { textCount: 2, avgLength: 3.5, maxLength: 5, shortCount: 2 }
                                : type === 'analysis.longMessages'
                                  ? 1
                                  : type === 'analysis.textPercentiles'
                                    ? { p25: 1, p50: 3, p75: 5, p90: 5 }
                                    : type === 'session.delete'
                                      ? { deleted: true }
                                      : { renamed: true }
        return result as WebRuntimeTaskResult<T>
      },
      dispose: () => undefined,
    }
    const adapter = createBrowserDataAdapter(rpc)

    const sessions = await adapter.getSessions()
    assert.deepEqual(sessions[0], {
      id: 'session-one',
      name: 'One',
      platform: 'wechat',
      type: 'group',
      importedAt: 1,
      messageCount: 2,
      memberCount: 1,
      dbPath: '/chatlab-sessions/session-one.db',
      groupId: null,
      groupAvatar: null,
      ownerId: null,
      ownerName: null,
      ownerStatus: 'missing',
      memberAvatar: null,
      lastMessageTs: 2,
      summaryCount: 0,
      aiConversationCount: 0,
    })
    assert.equal((await adapter.getSession('session-one'))?.id, 'session-one')
    assert.equal((await adapter.getHourlyActivity('session-one', { startTs: 1 }))[8].messageCount, 2)
    assert.deepEqual(await adapter.getDailyActivity('session-one', { startTs: 1 }), [
      { date: '2024-01-02', messageCount: 2 },
    ])
    assert.equal((await adapter.getWeekdayActivity('session-one', { endTs: 2 }))[1].messageCount, 2)
    assert.deepEqual(await adapter.getTimeRange('session-one'), { start: 1, end: 2 })
    assert.deepEqual(await adapter.getAvailableYears('session-one'), [2024])
    assert.equal((await adapter.getMemberActivity('session-one', { endTs: 2 }))[0].name, 'Alice')
    assert.deepEqual(await adapter.getMessageTypeDistribution('session-one', { startTs: 1, endTs: 2 }), [
      { type: 1, count: 2 },
      { type: 0, count: 1 },
    ])
    assert.deepEqual(await adapter.getMessageLengthDistribution('session-one', { startTs: 1 }), {
      detail: [{ len: 1, count: 2 }],
      grouped: [{ range: '1-5', count: 2 }],
    })
    assert.deepEqual(await adapter.getTextStats('session-one', { endTs: 2 }), {
      textCount: 2,
      avgLength: 3.5,
      maxLength: 5,
      shortCount: 2,
    })
    assert.equal(await adapter.getLongMessageCount('session-one', { startTs: 1 }, 30), 1)
    assert.deepEqual(await adapter.getTextLengthPercentiles('session-one', { endTs: 2 }), {
      p25: 1,
      p50: 3,
      p75: 5,
      p90: 5,
    })
    assert.equal(await adapter.renameSession('session-one', 'New name'), true)
    assert.equal(await adapter.deleteSession('session-one'), true)
    assert.deepEqual(requests, [
      { type: 'session.list', payload: undefined },
      { type: 'session.get', payload: { sessionId: 'session-one' } },
      { type: 'analysis.hourly', payload: { sessionId: 'session-one', filter: { startTs: 1 } } },
      { type: 'analysis.daily', payload: { sessionId: 'session-one', filter: { startTs: 1 } } },
      { type: 'analysis.weekday', payload: { sessionId: 'session-one', filter: { endTs: 2 } } },
      { type: 'analysis.timeRange', payload: { sessionId: 'session-one' } },
      { type: 'analysis.availableYears', payload: { sessionId: 'session-one' } },
      { type: 'analysis.members', payload: { sessionId: 'session-one', filter: { endTs: 2 } } },
      {
        type: 'analysis.messageTypes',
        payload: { sessionId: 'session-one', filter: { startTs: 1, endTs: 2 } },
      },
      { type: 'analysis.messageLengths', payload: { sessionId: 'session-one', filter: { startTs: 1 } } },
      { type: 'analysis.textStats', payload: { sessionId: 'session-one', filter: { endTs: 2 } } },
      {
        type: 'analysis.longMessages',
        payload: { sessionId: 'session-one', filter: { startTs: 1 }, minLength: 30 },
      },
      { type: 'analysis.textPercentiles', payload: { sessionId: 'session-one', filter: { endTs: 2 } } },
      { type: 'session.rename', payload: { sessionId: 'session-one', name: 'New name' } },
      { type: 'session.delete', payload: { sessionId: 'session-one' } },
    ])
  })

  it('forwards the complete Insights adapter surface through typed RPC tasks', async () => {
    const requests: Array<{ type: WebRuntimeTaskType; payload: unknown }> = []
    const rpc = {
      async request<T extends WebRuntimeTaskType>(
        type: T,
        payload: WebRuntimeTaskPayload<T>,
        _options?: RpcRequestOptions
      ): Promise<WebRuntimeTaskResult<T>> {
        requests.push({ type, payload })
        const results: Partial<Record<WebRuntimeTaskType, unknown>> = {
          'analysis.monthly': [{ month: 1, messageCount: 2 }],
          'analysis.yearly': [{ year: 2024, messageCount: 2 }],
          'analysis.memberMonthlyTrend': [{ month: '2024-01', memberId: 1, memberName: 'Alice', count: 2 }],
          'analysis.memberList': [
            {
              id: 1,
              platformId: 'alice',
              accountName: 'Alice',
              groupNickname: null,
              aliases: [],
              avatar: null,
              messageCount: 2,
              lastMessageTs: 2,
            },
          ],
          'analysis.mentions': { topMentioners: [], topMentioned: [], totalMentions: 0 },
          'analysis.mentionGraph': { nodes: [], links: [], maxLinkValue: 0 },
          'analysis.clusterGraph': {
            nodes: [],
            links: [],
            maxLinkValue: 0,
            communities: [],
            stats: { totalMembers: 0, totalMessages: 0, involvedMembers: 0, edgeCount: 0, communityCount: 0 },
          },
          'analysis.relationship': { hasSessionIndex: true },
          'analysis.journey': { range: null, hasSessionIndex: true, months: [], years: [] },
          'analysis.languagePreference': { members: [], sharedWords: [], similarityScore: 0 },
          'analysis.wordFrequency': { words: [], totalWords: 0, totalMessages: 0, uniqueWords: 0 },
        }
        return results[type] as WebRuntimeTaskResult<T>
      },
      dispose: () => undefined,
    }
    const adapter = createBrowserDataAdapter(rpc)

    assert.equal((await adapter.getMonthlyActivity('session-one'))[0].messageCount, 2)
    assert.equal((await adapter.getYearlyActivity('session-one'))[0].year, 2024)
    assert.equal((await adapter.getMemberMonthlyTrend('session-one'))[0].memberName, 'Alice')
    assert.equal((await adapter.getMembers('session-one'))[0].accountName, 'Alice')
    assert.equal((await adapter.getMentionAnalysis('session-one')).totalMentions, 0)
    assert.equal((await adapter.getMentionGraph('session-one')).links.length, 0)
    assert.equal((await adapter.getClusterGraph('session-one')).stats.edgeCount, 0)
    assert.equal((await adapter.getRelationshipStats('session-one')).hasSessionIndex, true)
    assert.equal((await adapter.getJourneyStats('session-one')).hasSessionIndex, true)
    assert.equal((await adapter.getLanguagePreferenceAnalysis('session-one', 'en-US')).members.length, 0)
    assert.equal((await adapter.getWordFrequency('session-one', { locale: 'en-US' })).totalWords, 0)

    assert.deepEqual(
      requests.map(({ type }) => type),
      [
        'analysis.monthly',
        'analysis.yearly',
        'analysis.memberMonthlyTrend',
        'analysis.memberList',
        'analysis.mentions',
        'analysis.mentionGraph',
        'analysis.clusterGraph',
        'analysis.relationship',
        'analysis.journey',
        'analysis.languagePreference',
        'analysis.wordFrequency',
      ]
    )
  })

  it('ignores stale Worker analysis results after the analytics epoch changes', async () => {
    const loads = [createDeferred<unknown>(), createDeferred<unknown>()]
    const requestOptions: Array<RpcRequestOptions | undefined> = []
    let loadIndex = 0
    const rpc = {
      request<T extends WebRuntimeTaskType>(
        type: T,
        _payload: WebRuntimeTaskPayload<T>,
        options?: RpcRequestOptions
      ): Promise<WebRuntimeTaskResult<T>> {
        assert.equal(type, 'analysis.hourly')
        requestOptions.push(options)
        return loads[loadIndex++]!.promise as Promise<WebRuntimeTaskResult<T>>
      },
      dispose: () => undefined,
    }
    const adapter = createBrowserDataAdapter(rpc)

    let staleSettled = false
    void adapter.getHourlyActivity('session-one', { startTs: 1 }).then(
      () => {
        staleSettled = true
      },
      () => {
        staleSettled = true
      }
    )

    abortAnalyticsRequests()
    const latest = adapter.getHourlyActivity('session-one', { startTs: 2 })

    assert.equal(requestOptions[0]?.signal?.aborted, true)
    assert.equal(requestOptions[1]?.signal?.aborted, false)

    loads[0]!.resolve([{ hour: 1, messageCount: 1 }])
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(staleSettled, false)

    loads[1]!.resolve([{ hour: 2, messageCount: 2 }])
    assert.deepEqual(await latest, [{ hour: 2, messageCount: 2 }])
  })

  it('rejects unsupported DataAdapter capabilities instead of returning fake data', async () => {
    const rpc = {
      request: () => Promise.reject(new Error('not used')),
      dispose: () => undefined,
    }
    const adapter = createBrowserDataAdapter(rpc)

    await assert.rejects(adapter.getContacts(), /getContacts is not available in Web WASM/)
    await assert.rejects(adapter.executeSQL('session-one', 'SELECT 1'), /executeSQL is not available/)
  })
})
