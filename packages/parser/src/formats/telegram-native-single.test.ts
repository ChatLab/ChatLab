import assert from 'node:assert/strict'
import fs, { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { mock, test } from 'node:test'

import type { ParseEvent } from '../types'
import { parser_ } from './telegram-native-single'

test('continues parsing Telegram messages after emitting a batch before the source finishes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-telegram-stream-'))
  const filePath = join(dir, 'result.json')
  writeFileSync(filePath, '{}', 'utf-8')

  const source = new PassThrough()
  const createReadStream = mock.method(
    fs,
    'createReadStream',
    () => source as unknown as ReturnType<typeof fs.createReadStream>
  )
  syncBuiltinESMExports()

  t.after(() => {
    createReadStream.mock.restore()
    syncBuiltinESMExports()
    source.destroy()
    rmSync(dir, { recursive: true, force: true })
  })

  const generator = parser_.parse({ filePath, batchSize: 2 })
  assert.equal((await generator.next()).value?.type, 'progress')

  const firstBatchPromise = nextEventOfType(generator, 'messages')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(createReadStream.mock.callCount(), 1)

  const messages = [createMessage(1), createMessage(2)]
  source.write(
    `{"name":"Project Team","type":"private_group","id":4242,"messages":[${messages
      .map((message) => JSON.stringify(message))
      .join(',')}`
  )

  const firstBatch = await firstBatchPromise
  assert.equal(source.readableEnded, false)
  assert.deepEqual(
    firstBatch.data.map((message) => message.platformMessageId),
    ['1', '2']
  )

  source.end(`,${JSON.stringify(createMessage(3))}]}`)
  const remainingMessageIds: Array<string | undefined> = []
  let doneMessageCount: number | undefined
  for await (const event of generator) {
    if (event.type === 'error') throw event.data
    if (event.type === 'messages') {
      remainingMessageIds.push(...event.data.map((message) => message.platformMessageId))
    }
    if (event.type === 'done') doneMessageCount = event.data.messageCount
  }

  assert.deepEqual(remainingMessageIds, ['3'])
  assert.equal(doneMessageCount, 3)
})

function createMessage(id: number) {
  return {
    id,
    type: 'message',
    date: '2024-01-02T03:04:05',
    date_unixtime: String(1_704_164_645 + id),
    from: 'Alice',
    from_id: 'user10001',
    text: `message ${id}`,
  }
}

async function nextEventOfType<T extends ParseEvent['type']>(
  generator: AsyncGenerator<ParseEvent, void, unknown>,
  type: T
): Promise<Extract<ParseEvent, { type: T }>> {
  for (;;) {
    const result = await generator.next()
    if (result.done) throw new Error(`Parser finished before emitting ${type}`)
    if (result.value.type === 'error') throw result.value.data
    if (result.value.type === type) return result.value as Extract<ParseEvent, { type: T }>
  }
}
