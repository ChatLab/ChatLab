import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDesensitizeRuleOverrides, getDefaultRulesForLocale, getRuleGroupsForLocale } from './builtin-rules'

test('groups built-in desensitize rules by global groups and current locale', () => {
  const groups = getRuleGroupsForLocale('zh-CN')
  const groupIds = groups.map((group) => group.id)

  assert.deepEqual(groupIds, ['credentials', 'global_contact', 'global_financial', 'global_network', 'region_cn'])
  assert.deepEqual(
    groups.find((group) => group.id === 'region_cn')?.rules.map((rule) => rule.id),
    ['cn_phone', 'cn_id_card', 'cn_bank_card', 'cn_landline']
  )
  assert.equal(
    groups.some((group) => group.id === 'region_us'),
    false
  )
})

test('enables all visible built-in desensitize rules by default', () => {
  const rules = getDefaultRulesForLocale('zh-CN')

  assert.ok(rules.length > 0)
  assert.equal(
    rules.every((rule) => rule.enabled),
    true
  )
})

test('applies explicit built-in rule overrides without storing rule bodies', () => {
  const rules = applyDesensitizeRuleOverrides(getDefaultRulesForLocale('zh-CN'), {
    api_key_prefix: false,
    cn_bank_card: true,
  })

  assert.equal(rules.find((rule) => rule.id === 'api_key_prefix')?.enabled, false)
  assert.equal(rules.find((rule) => rule.id === 'cn_bank_card')?.enabled, true)
})
