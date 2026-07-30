import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveLanguageBootstrap, resolvePostLanguageBootstrap } from './onboardingFlow'

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

test('已接受旧版协议的用户应优先确认当前协议，不检查更新日志', () => {
  assert.deepEqual(resolvePostLanguageBootstrap(true), {
    shouldOpenAgreement: true,
    shouldCheckChangelog: false,
  })
})

test('已接受当前协议的用户才可以检查更新日志', () => {
  assert.deepEqual(resolvePostLanguageBootstrap(false), {
    shouldOpenAgreement: false,
    shouldCheckChangelog: true,
  })
})
