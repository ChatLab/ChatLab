import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldEnsureDesensitizeRulesBeforeSerialize } from './aiPreprocessConfig'

describe('AI preprocess config serialization guards', () => {
  it('requires built-in rules before serializing an enabled empty desensitize config', () => {
    assert.equal(
      shouldEnsureDesensitizeRulesBeforeSerialize({
        desensitize: true,
        desensitizeRules: [],
      }),
      true
    )
  })

  it('requires built-in rules before serializing enabled custom-only desensitize rules', () => {
    assert.equal(
      shouldEnsureDesensitizeRulesBeforeSerialize({
        desensitize: true,
        desensitizeRules: [
          {
            id: 'custom_staff_id',
            label: 'Staff ID',
            pattern: 'EMP-\\d+',
            replacement: '[Staff ID]',
            enabled: true,
            builtin: false,
            locales: [],
          },
        ],
      }),
      true
    )
  })

  it('does not require built-in rules when enabled rules already include a built-in rule', () => {
    assert.equal(
      shouldEnsureDesensitizeRulesBeforeSerialize({
        desensitize: true,
        desensitizeRules: [
          {
            id: 'email',
            label: 'desensitize.rules.email',
            pattern: '[^@\\s]+@[^@\\s]+',
            replacement: '[Email]',
            enabled: true,
            builtin: true,
            locales: [],
          },
        ],
      }),
      false
    )
  })

  it('does not require built-in rules when masking is disabled', () => {
    assert.equal(
      shouldEnsureDesensitizeRulesBeforeSerialize({
        desensitize: false,
        desensitizeRules: [],
      }),
      false
    )
  })
})
