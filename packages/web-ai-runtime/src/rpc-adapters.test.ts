import assert from 'node:assert/strict'
import { it } from 'node:test'

import { RpcConversationRepository, type WebRuntimeRpcPort } from './rpc-adapters'

it('forwards the cancellation signal when creating a conversation', async () => {
  const controller = new AbortController()
  let receivedSignal: AbortSignal | undefined
  const rpc: WebRuntimeRpcPort = {
    request: async (_type, _payload, options) => {
      receivedSignal = options?.signal
      return {
        id: 'conversation-1',
        sessionId: 'session-1',
        title: 'New conversation',
        createdAt: 1,
        updatedAt: 1,
      } as never
    },
  }
  const repository = new RpcConversationRepository(rpc)

  await repository.createConversation('session-1', 'New conversation', controller.signal)

  assert.equal(receivedSignal, controller.signal)
})
