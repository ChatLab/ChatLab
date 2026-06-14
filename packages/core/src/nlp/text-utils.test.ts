import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cleanText } from './text-utils'

describe('cleanText', () => {
  it('removes chat media placeholders before punctuation cleanup', () => {
    assert.equal(cleanText('今天发了[图片]和[视频]，还有[文件]'), '今天发了 和 还有')
    assert.equal(cleanText('[Image] [Video] [File] useful text'), 'useful text')
  })
})
