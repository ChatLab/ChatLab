import assert from 'node:assert/strict'
import test from 'node:test'

test('falls back before data events when the native parser constructor rejects the format', async (t) => {
  await t.mock.module('./loader', {
    namedExports: {
      loadNativeParser() {
        return {
          NativeParser: class NativeParser {
            constructor() {
              throw new Error('kernel missing from older binary')
            }
          },
        }
      },
    },
  })

  const { createNativeFirstParser } = await import('./create-native-parser')
  const parser = createNativeFirstParser(
    {
      formatId: 'shuakami-qq-exporter',
      label: 'shuakami/qq-chat-exporter',
      mapMeta() {
        throw new Error('native mapper must not run')
      },
      mapMembers() {
        return []
      },
      mapMessage() {
        throw new Error('native mapper must not run')
      },
    },
    async function* fallback() {
      yield { type: 'done', data: { messageCount: 0, memberCount: 0 } }
    }
  )

  const logs: string[] = []
  const events: unknown[] = []
  for await (const event of parser({
    filePath: '/path/does/not/need/to/exist.json',
    onLog(_level, message) {
      logs.push(message)
    },
  })) {
    events.push(event)
  }

  assert.deepEqual(events, [{ type: 'done', data: { messageCount: 0, memberCount: 0 } }])
  assert.match(logs[0] ?? '', /Failed to create Rust parser.*kernel missing from older binary/)
})
