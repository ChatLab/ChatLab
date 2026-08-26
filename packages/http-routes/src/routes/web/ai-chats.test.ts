import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import { AIChatManager } from '@openchatlab/node-runtime'
import { registerAiChatRoutes } from './ai-chats'

const sqliteNativeBinding = process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING

test('global AI chat routes keep global history separate and persist entity references', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-global-ai-routes-'))
  const manager = sqliteNativeBinding
    ? new AIChatManager(dir, { nativeBinding: sqliteNativeBinding })
    : new AIChatManager(dir)
  const app = Fastify()
  registerAiChatRoutes(app, { aiChatManager: manager })

  t.after(async () => {
    await app.close()
    manager.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const sessionResponse = await app.inject({
    method: 'POST',
    url: '/_web/ai/chats',
    payload: { sessionId: 'session-1', title: 'Session chat', assistantId: 'general_cn' },
  })
  assert.equal(sessionResponse.statusCode, 200)

  const globalResponse = await app.inject({
    method: 'POST',
    url: '/_web/ai/global-chats',
    payload: { title: 'Global chat', assistantId: 'general_cn' },
  })
  assert.equal(globalResponse.statusCode, 200)
  const globalChat = globalResponse.json<{ id: string; kind: string }>()
  assert.equal(globalChat.kind, 'global')

  const refs = [
    { type: 'contact' as const, contactKey: 'qq:10001', displayName: 'Alice' },
    {
      type: 'session' as const,
      sessionId: 'group-1',
      displayName: 'Project Group',
      sessionType: 'group' as const,
    },
  ]
  const messagePairResponse = await app.inject({
    method: 'POST',
    url: `/_web/ai/chats/${globalChat.id}/message-pair`,
    payload: {
      userMessage: { content: 'Compare them', entityRefs: refs },
      assistantMessage: { content: 'I will compare them' },
    },
  })
  assert.equal(messagePairResponse.statusCode, 200)
  const messagePair = messagePairResponse.json<{
    userMessage: { id: string; entityRefs: unknown[] }
    assistantMessage: { parentId: string; entityRefs?: unknown[] }
  }>()
  assert.deepEqual(messagePair.userMessage.entityRefs, refs)
  assert.equal(messagePair.assistantMessage.parentId, messagePair.userMessage.id)
  assert.equal(messagePair.assistantMessage.entityRefs, undefined)

  const messageList = await app.inject({
    method: 'GET',
    url: `/_web/ai/chats/${globalChat.id}/messages`,
  })
  assert.equal(messageList.json<Array<{ entityRefs?: unknown[] }>>()[1]?.entityRefs, undefined)

  const replacementRefs = [
    {
      type: 'session' as const,
      sessionId: 'group-2',
      displayName: 'New Group',
      sessionType: 'group' as const,
    },
  ]
  const userMessageId = messagePair.userMessage.id
  const replaceResponse = await app.inject({
    method: 'PUT',
    url: `/_web/ai/messages/${userMessageId}/content`,
    payload: { content: 'Compare the new group', entityRefs: replacementRefs },
  })
  assert.equal(replaceResponse.statusCode, 200)

  const replacedMessageList = await app.inject({
    method: 'GET',
    url: `/_web/ai/chats/${globalChat.id}/messages`,
  })
  assert.deepEqual(replacedMessageList.json<Array<{ entityRefs?: unknown[] }>>()[0]?.entityRefs, replacementRefs)

  const clearResponse = await app.inject({
    method: 'PUT',
    url: `/_web/ai/messages/${userMessageId}/content`,
    payload: { content: 'Compare without named entities' },
  })
  assert.equal(clearResponse.statusCode, 200)

  const clearedMessageList = await app.inject({
    method: 'GET',
    url: `/_web/ai/chats/${globalChat.id}/messages`,
  })
  assert.equal(clearedMessageList.json<Array<{ entityRefs?: unknown[] }>>()[0]?.entityRefs, undefined)

  const globalList = await app.inject({ method: 'GET', url: '/_web/ai/global-chats' })
  assert.deepEqual(
    globalList.json<Array<{ id: string }>>().map((chat) => chat.id),
    [globalChat.id]
  )

  const sessionList = await app.inject({ method: 'GET', url: '/_web/ai/chats?sessionId=session-1' })
  assert.equal(sessionList.json<Array<{ kind: string }>>()[0]?.kind, 'session')
  assert.equal(
    sessionList.json<Array<{ id: string }>>().some((chat) => chat.id === globalChat.id),
    false
  )
})
