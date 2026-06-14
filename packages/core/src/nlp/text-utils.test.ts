import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanText } from './text-utils'

test('cleanText removes bracketed chat emoji placeholders before tokenization', () => {
  assert.equal(cleanText('今天[破涕为笑][微笑][呲牙]很好'), '今天 很好')
})

test('cleanText removes unknown short bracketed emoji placeholders', () => {
  assert.equal(cleanText('收到[旺柴]马上来'), '收到 马上来')
})

test('cleanText removes mapped emoji placeholders with variation selectors', () => {
  assert.equal(cleanText('送你[爱心][太阳]'), '送你')
})

test('cleanText keeps ordinary non-bracketed words', () => {
  assert.equal(cleanText('破涕为笑 微笑 呲牙'), '破涕为笑 微笑 呲牙')
})

test('cleanText keeps non-CJK bracketed words as regular text', () => {
  assert.equal(cleanText('please check [report]'), 'please check report')
})
