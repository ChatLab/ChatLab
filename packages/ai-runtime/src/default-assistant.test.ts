import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getDefaultAssistantPrompt } from './default-assistant'

describe('default assistant prompt', () => {
  it('requires current tool evidence for chat-record claims in every locale', () => {
    const expectations = [
      ['zh-CN', '必须先调用合适的数据工具'],
      ['zh-TW', '必須先呼叫合適的資料工具'],
      ['en-US', 'must first call an appropriate data tool'],
      ['ja-JP', '適切なデータツールを先に呼び出す'],
    ] as const

    for (const [locale, requirement] of expectations) {
      const prompt = getDefaultAssistantPrompt(locale)
      assert.match(prompt, new RegExp(requirement), locale)
    }
  })
})
