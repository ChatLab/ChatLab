import assert from 'node:assert/strict'
import test from 'node:test'

test('probes kernel ids so an older loadable native binary is not treated as format-capable', async (t) => {
  class OlderNativeParser {
    constructor(formatId: string) {
      if (formatId !== 'chatlab' && formatId !== 'shuakami-qq-exporter') {
        throw new Error(`unsupported format: ${formatId}`)
      }
    }
  }

  await t.mock.module('@openchatlab/parser-native', {
    namedExports: { NativeParser: OlderNativeParser },
  })

  const { isNativeFormatAvailable } = await import('./loader')
  assert.equal(isNativeFormatAvailable('chatlab'), true)
  assert.equal(isNativeFormatAvailable('qq-shuakami'), true)
  assert.equal(isNativeFormatAvailable('shuakami-qq-exporter'), true)
  assert.equal(isNativeFormatAvailable('discord-tyrrrz'), false)

  const saved = process.env.CHATLAB_DISABLE_NATIVE_PERF
  try {
    process.env.CHATLAB_DISABLE_NATIVE_PERF = '1'
    assert.equal(isNativeFormatAvailable('chatlab'), false)
  } finally {
    if (saved === undefined) delete process.env.CHATLAB_DISABLE_NATIVE_PERF
    else process.env.CHATLAB_DISABLE_NATIVE_PERF = saved
  }
})
