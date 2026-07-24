import assert from 'node:assert/strict'
import test from 'node:test'
import { detectSystemLocale } from './types'

test('detects supported locales from the browser language preference order', () => {
  assert.equal(detectSystemLocale(['zh-Hant-HK', 'en-US']), 'zh-TW')
  assert.equal(detectSystemLocale(['zh-HK']), 'zh-TW')
  assert.equal(detectSystemLocale(['zh-CN']), 'zh-CN')
  assert.equal(detectSystemLocale(['ja-JP']), 'ja-JP')
  assert.equal(detectSystemLocale(['en-GB']), 'en-US')
})

test('uses the first supported browser language and falls back to English', () => {
  assert.equal(detectSystemLocale(['fr-FR', 'ja-JP', 'en-US']), 'ja-JP')
  assert.equal(detectSystemLocale(['fr-FR']), 'en-US')
  assert.equal(detectSystemLocale([]), 'en-US')
})
