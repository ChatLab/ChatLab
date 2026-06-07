import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveLanguageBootstrap } from './onboardingFlow'

test('新用户没有保存语言时应先打开语言选择，不继续后续弹窗流程', () => {
  assert.deepEqual(resolveLanguageBootstrap(''), {
    shouldOpenLanguageModal: true,
    shouldContinue: false,
  })
})

test('已有保存语言时应跳过语言选择并继续后续弹窗流程', () => {
  assert.deepEqual(resolveLanguageBootstrap('zh-CN'), {
    shouldOpenLanguageModal: false,
    shouldContinue: true,
  })
})
