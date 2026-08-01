import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHATLAB_FORMAT_VERSION,
  CHATLAB_SUPPORTED_FORMAT_VERSIONS,
  isSupportedChatLabFormatVersion,
} from './chatlab-format'

test('keeps the current version in the supported format versions', () => {
  assert.equal(CHATLAB_SUPPORTED_FORMAT_VERSIONS.at(-1), CHATLAB_FORMAT_VERSION)
  assert.equal(isSupportedChatLabFormatVersion('0.0.1'), true)
  assert.equal(isSupportedChatLabFormatVersion(CHATLAB_FORMAT_VERSION), true)
  assert.equal(isSupportedChatLabFormatVersion('9.9.9'), false)
})
