import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'

import { parseWeFlowJson } from './weflow'

describe('WeFlow browser-safe JSON parser', () => {
  it('parses messages and only reports intermediate progress at cooperative yield points', async () => {
    const progress: Array<{ progress: number; messagesProcessed: number }> = []
    const content = JSON.stringify({
      weflow: { version: '1.0.0' },
      session: { wxid: 'group@chatroom', displayName: 'Project Team', type: '群聊' },
      messages: Array.from({ length: 5 }, (_, index) => ({
        localId: index + 1,
        createTime: 1704164645 + index,
        type: '文本消息',
        content: `message ${index}`,
        isSend: index === 0 ? 1 : 0,
        senderUsername: `member-${index % 2}`,
        senderDisplayName: `Member ${index % 2}`,
      })),
    })

    const result = await parseWeFlowJson(content, 'project.json', {
      yieldEvery: 2,
      onProgress: (value) => progress.push(value),
    })

    assert.deepEqual(result.meta, {
      name: 'Project Team',
      platform: KNOWN_PLATFORMS.WECHAT,
      type: ChatType.GROUP,
      groupId: 'group@chatroom',
      groupAvatar: undefined,
      ownerId: 'member-0',
    })
    assert.equal(result.messages.length, 5)
    assert.equal(result.messages[0]?.type, MessageType.TEXT)
    assert.deepEqual(
      progress.map((value) => value.messagesProcessed),
      [2, 4, 5]
    )
    assert.equal(progress.at(-1)?.progress, 1)
  })

  it('does not treat export-local IDs as stable message IDs', async () => {
    const content = JSON.stringify({
      weflow: { version: '1.0.0' },
      session: { wxid: 'group@chatroom', displayName: 'Project Team', type: '群聊' },
      messages: [
        {
          localId: 1,
          createTime: 1704164645,
          type: '文本消息',
          content: 'old message',
          senderUsername: 'member-1',
          senderDisplayName: 'Member 1',
        },
        {
          localId: 1,
          platformMessageId: 'server-2',
          createTime: 1767225600,
          type: '文本消息',
          content: 'new message',
          senderUsername: 'member-2',
          senderDisplayName: 'Member 2',
        },
        {
          localId: 2,
          platformMessageId: '0',
          createTime: 1767225601,
          type: '文本消息',
          content: 'message without a stable ID',
          senderUsername: 'member-2',
          senderDisplayName: 'Member 2',
        },
      ],
    })

    const result = await parseWeFlowJson(content, 'project.json')

    assert.deepEqual(
      result.messages.map((message) => message.platformMessageId),
      [undefined, 'server-2', undefined]
    )
  })
})
