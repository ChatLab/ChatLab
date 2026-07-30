import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseShuakamiQqV4 } from './shuakami-qq-exporter'
import { shuakamiQqPreprocessor } from './shuakami-qq-preprocessor'
import type { ParsedMember, ParsedMessage, ParsedMeta } from '../types'

async function collect(filePath: string): Promise<{
  meta?: ParsedMeta
  members: ParsedMember[]
  messages: ParsedMessage[]
}> {
  const result: { meta?: ParsedMeta; members: ParsedMember[]; messages: ParsedMessage[] } = {
    members: [],
    messages: [],
  }
  for await (const event of parseShuakamiQqV4({ filePath })) {
    if (event.type === 'meta') result.meta = event.data
    if (event.type === 'members') result.members.push(...event.data)
    if (event.type === 'messages') result.messages.push(...event.data)
  }
  return result
}

test('shuakami/qq-chat-exporter slim preprocessing preserves reply and nullish current-vs-legacy flag semantics', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chatlab-shuakami-qq-preprocessor-'))
  const filePath = join(directory, 'source.json')
  let slimPath: string | undefined
  try {
    writeFileSync(
      filePath,
      JSON.stringify({
        metadata: { name: 'QQChatExporter V6', version: '6.0.3' },
        chatInfo: { name: '', type: 'group', avatar: 'data:image/png;base64,GROUP' },
        statistics: { senders: [{ uid: 'u_100' }] },
        messages: [
          {
            messageId: '',
            timestamp: '2026-07-10T12:00:00.000Z',
            sender: { uin: '100', uid: 'u_100', name: 'Alice' },
            system: false,
            isSystemMessage: true,
            recalled: false,
            isRecalled: true,
            content: {
              text: 'ordinary reply',
              reply: { referencedMessageId: '' },
              resources: [],
              emojis: [],
              html: '<div>drop me</div>',
              raw: { drop: true },
            },
            rawMessage: { sendNickName: 'Alice QQ', sendMemberName: 'Alice Card' },
          },
          {
            messageId: 'null-reply',
            timestamp: '2026-07-10T12:01:00.000Z',
            sender: { uin: '100', uid: 'u_100', name: 'Alice' },
            content: { text: 'null reply', reply: { referencedMessageId: null } },
          },
        ],
        avatars: { '100': 'data:image/jpeg;base64,ALICE' },
      }),
      'utf-8'
    )

    slimPath = await shuakamiQqPreprocessor.preprocess(filePath)
    const [raw, slim] = await Promise.all([collect(filePath), collect(slimPath)])
    assert.deepEqual(slim, raw)
    assert.equal(slim.messages[0].platformMessageId, '')
    assert.equal(slim.messages[0].replyToMessageId, '')
    assert.equal(slim.messages[0].type, 0)
    assert.equal(slim.meta?.name, 'source')
    assert.equal((slim.messages[1] as unknown as { replyToMessageId: unknown }).replyToMessageId, null)
  } finally {
    if (slimPath) shuakamiQqPreprocessor.cleanup(slimPath)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('shuakami/qq-chat-exporter slim preprocessing uses the same 500,000-byte UTF-8 head window as the parser', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chatlab-shuakami-qq-preprocessor-head-'))
  const filePath = join(directory, 'source.json')
  let slimPath: string | undefined
  try {
    const document = JSON.stringify({
      metadata: { name: 'QQChatExporter V6', version: '6.0.3' },
      padding: '中'.repeat(170_000),
      chatInfo: { name: 'late metadata', type: 'private' },
      statistics: { senders: [{ uid: 'u_100' }] },
      messages: [],
    })
    const chatInfoCharacterOffset = document.indexOf('"chatInfo"')
    const chatInfoByteOffset = Buffer.byteLength(document.slice(0, chatInfoCharacterOffset))
    assert.ok(chatInfoByteOffset > 500_000)
    assert.ok(chatInfoByteOffset < 520_000)
    writeFileSync(filePath, document, 'utf-8')

    slimPath = await shuakamiQqPreprocessor.preprocess(filePath)
    const [raw, slim] = await Promise.all([collect(filePath), collect(slimPath)])
    assert.deepEqual(slim, raw)
    assert.deepEqual(raw.meta, {
      name: '未知群聊',
      platform: 'qq',
      type: 'group',
      groupAvatar: undefined,
    })
  } finally {
    if (slimPath) shuakamiQqPreprocessor.cleanup(slimPath)
    rmSync(directory, { recursive: true, force: true })
  }
})
