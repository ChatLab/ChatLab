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
  const messageResponse = await app.inject({
    method: 'POST',
    url: `/_web/ai/chats/${globalChat.id}/messages`,
    payload: { role: 'user', content: 'Compare them', entityRefs: refs },
  })
  assert.equal(messageResponse.statusCode, 200)
  assert.deepEqual(messageResponse.json<{ entityRefs: unknown[] }>().entityRefs, refs)

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
