import assert from 'node:assert/strict'
import test from 'node:test'

import { generateMessageKey } from './tempDb'

test('空字符串内容在写库归一化前后应生成同一个去重 key', () => {
  const timestamp = 1710000000
  const senderPlatformId = 'user-1'
  const parsedContent = ''

  const keyBeforePersist = generateMessageKey(timestamp, senderPlatformId, parsedContent)
  const keyAfterPersist = generateMessageKey(timestamp, senderPlatformId, parsedContent || null)

  assert.equal(keyAfterPersist, keyBeforePersist)
})
