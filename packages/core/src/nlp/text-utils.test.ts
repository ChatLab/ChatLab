import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanText,
  isMediaPlaceholderContent,
  isSystemMessageContent,
  stripVoiceTranscriptionPrefix,
} from './text-utils'

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
    ['removes exact bracketed Douyin emoji codes', '太累了[躺平]，一起[强壮]', '太累了 一起'],
    ['removes full-width bracketed emoji codes', '【微笑】收到', '收到'],
    ['removes non-CJK Douyin emoji codes as emoji', '真的[V5]呀[666]', '真的 呀'],
    ['removes collected Douyin emoji codes in mixed text', '发一个[kisskiss]给你', '发一个 给你'],
    ['removes UniEmoji platform emoji codes', 'B站[doge][滑稽]和[yeah]', 'B站 和'],
    ['removes short latin platform emoji codes', '收到[emm]', '收到'],
    ['keeps ordinary non-bracketed words', '破涕为笑 微笑 呲牙', '破涕为笑 微笑 呲牙'],
    ['keeps non-CJK bracketed words as regular text', 'please check [report]', 'please check report'],
  ] as const

  for (const [name, input, expected] of cases) {
    it(name, () => {
      assert.equal(cleanText(input), expected)
    })
  }

  it('removes duration-bearing voice labels while retaining the transcription', () => {
    assert.equal(cleanText('[语音 3秒] 这是测试语音内容。'), '这是测试语音内容')
    assert.equal(stripVoiceTranscriptionPrefix('[语音 3秒] 这是测试语音内容。'), '这是测试语音内容。')
  })

  it('recognizes duration-bearing media-only content as a placeholder', () => {
    assert.equal(isMediaPlaceholderContent('[语音 3秒]'), true)
    assert.equal(isMediaPlaceholderContent('[语音 3秒] 有转写内容'), false)
  })

  it('recognizes explicit system markers without treating bracketed emoji labels as system text', () => {
    const cases = [
      ['[系统] 对方赞了你分享的 图文', true],
      ['【系统消息】你赞了对方分享的视频', true],
      ['[System Message] shared a post', true],
      ['[分享内容]', true],
      ['【分享内容】', true],
      ['[强壮]', false],
      ['[躺平]', false],
      ['[分享]', false],
      ['我说“[系统]”这个词', false],
    ] as const

    for (const [input, expected] of cases) {
      assert.equal(isSystemMessageContent(input), expected, input)
    }
  })
})
