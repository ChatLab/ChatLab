import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getDefaultGeneralAssistantId, isGeneralAssistantId } from './index'

describe('default general assistant rules', () => {
  it('maps supported locales to their default assistants', () => {
    assert.equal(getDefaultGeneralAssistantId('zh-CN'), 'general_cn')
    assert.equal(getDefaultGeneralAssistantId('zh-TW'), 'general_tw')
    assert.equal(getDefaultGeneralAssistantId('en-US'), 'general_en')
    assert.equal(getDefaultGeneralAssistantId('ja-JP'), 'general_ja')
    assert.equal(getDefaultGeneralAssistantId(), 'general_cn')
  })

  it('recognizes only built-in general assistant ids', () => {
    assert.equal(isGeneralAssistantId('general_cn'), true)
    assert.equal(isGeneralAssistantId('custom_assistant'), false)
  })
})
