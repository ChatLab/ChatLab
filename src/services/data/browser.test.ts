import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  RpcRequestOptions,
  WebRuntimeTaskPayload,
  WebRuntimeTaskResult,
  WebRuntimeTaskType,
} from '@openchatlab/web-runtime'
import { createBrowserDataAdapter } from './browser'

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
    assert.equal((await adapter.getMemberActivity('session-one', { endTs: 2 }))[0].name, 'Alice')
    assert.deepEqual(await adapter.getMessageTypeDistribution('session-one', { startTs: 1, endTs: 2 }), [
      { type: 1, count: 2 },
      { type: 0, count: 1 },
    ])
    assert.equal(await adapter.renameSession('session-one', 'New name'), true)
    assert.equal(await adapter.deleteSession('session-one'), true)
    assert.deepEqual(requests, [
      { type: 'session.list', payload: undefined },
      { type: 'session.get', payload: { sessionId: 'session-one' } },
      { type: 'analysis.hourly', payload: { sessionId: 'session-one', filter: { startTs: 1 } } },
      { type: 'analysis.members', payload: { sessionId: 'session-one', filter: { endTs: 2 } } },
      {
        type: 'analysis.messageTypes',
        payload: { sessionId: 'session-one', filter: { startTs: 1, endTs: 2 } },
      },
      { type: 'session.rename', payload: { sessionId: 'session-one', name: 'New name' } },
      { type: 'session.delete', payload: { sessionId: 'session-one' } },
    ])
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
