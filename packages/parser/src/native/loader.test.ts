import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

test('treats a loadable native module without NativeParser as unavailable', async () => {
  await mock.module('@openchatlab/parser-native', {
    namedExports: {
      WeflowParser: class WeflowParser {},
    },
  })

  const { getNativeParserStatus, isNativeFormatAvailable, loadNativeParser } = await import('./loader')

  assert.equal(loadNativeParser(), null)
  assert.deepEqual(getNativeParserStatus(), {
    available: false,
    disabled: false,
    error: 'Native parser module missing NativeParser export',
  })
  assert.equal(isNativeFormatAvailable('shuakami-qq-exporter'), false)
})
