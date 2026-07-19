import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

test('keeps public format docs and converter skills on the current version', () => {
  const documents: Array<[URL, string?]> = [
    [new URL('../../docs/cn/standard/chatlab-format.md', import.meta.url), '## 版本历史'],
    [new URL('../../docs/en/standard/chatlab-format.md', import.meta.url), '## Version History'],
    [new URL('../../docs/tw/standard/chatlab-format.md', import.meta.url), '## 版本歷史'],
    [new URL('../../skills/chatlab-convert/references/chatlab-format.md', import.meta.url)],
    [new URL('../../skills/chatlab-convert-cn/references/chatlab-format.md', import.meta.url)],
  ]

  for (const [fileUrl, historyHeading] of documents) {
    const content = readFileSync(fileUrl, 'utf8')
    const currentSpec = historyHeading ? content.split(historyHeading, 1)[0] : content
    const declaredVersions = [...new Set(currentSpec.match(/\b\d+\.\d+\.\d+\b/g) ?? [])]
    assert.deepEqual(
      declaredVersions,
      [CHATLAB_FORMAT_VERSION],
      `Current format version is stale in ${fileUrl.pathname}`
    )
  }
})
