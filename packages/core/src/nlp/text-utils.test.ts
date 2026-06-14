import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cleanText } from './text-utils'

describe('cleanText', () => {
  it('removes chat media placeholders before punctuation cleanup', () => {
    assert.equal(cleanText('今天发了[图片]和[视频]，还有[文件]'), '今天发了 和 还有')
    assert.equal(cleanText('[Image] [Video] [File] useful text'), 'useful text')
  })

  it('removes bracketed chat emoji placeholders before tokenization', () => {
    assert.equal(cleanText('今天[破涕为笑][微笑][呲牙]很好'), '今天 很好')
  })

  it('removes unknown short bracketed emoji placeholders', () => {
    assert.equal(cleanText('收到[旺柴]马上来'), '收到 马上来')
  })

  it('removes mapped emoji placeholders with variation selectors', () => {
    assert.equal(cleanText('送你[爱心][太阳]'), '送你')
  })

  it('keeps ordinary non-bracketed words', () => {
    assert.equal(cleanText('破涕为笑 微笑 呲牙'), '破涕为笑 微笑 呲牙')
  })

  it('keeps non-CJK bracketed words as regular text', () => {
    assert.equal(cleanText('please check [report]'), 'please check report')
  })
})
