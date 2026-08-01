import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cleanText } from './text-utils'

describe('cleanText', () => {
  const cases = [
    [
      'removes chat media placeholders before punctuation cleanup',
      '今天发了[图片]和[视频]，还有[文件]',
      '今天发了 和 还有',
    ],
    ['removes English chat media placeholders', '[Image] [Video] [File] useful text', 'useful text'],
    ['removes bracketed chat emoji placeholders before tokenization', '今天[破涕为笑][微笑][呲牙]很好', '今天 很好'],
    ['removes unknown short bracketed emoji placeholders', '收到[旺柴]马上来', '收到 马上来'],
    ['removes mapped emoji placeholders with variation selectors', '送你[爱心][太阳]', '送你'],
    ['keeps ordinary non-bracketed words', '破涕为笑 微笑 呲牙', '破涕为笑 微笑 呲牙'],
    ['keeps non-CJK bracketed words as regular text', 'please check [report]', 'please check report'],
  ] as const

  for (const [name, input, expected] of cases) {
    it(name, () => {
      assert.equal(cleanText(input), expected)
    })
  }
})
