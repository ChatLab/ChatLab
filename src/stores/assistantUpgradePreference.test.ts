import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssistantUpgradeInfo } from '@openchatlab/shared-types'
import { isAssistantUpgradeSkipped } from './assistantUpgradePreference'

function createUpgradeInfo(latestVersion: number | null): AssistantUpgradeInfo {
  return {
    assistantId: 'general_cn',
    builtinId: 'general_cn',
    name: '通用分析助手',
    currentVersion: 1,
    latestVersion,
  }
}

test('skips only the recorded builtin assistant version', () => {
  const skippedVersions = { general_cn: 2 }

  assert.equal(isAssistantUpgradeSkipped(skippedVersions, createUpgradeInfo(2)), true)
  assert.equal(isAssistantUpgradeSkipped(skippedVersions, createUpgradeInfo(3)), false)
  assert.equal(isAssistantUpgradeSkipped(skippedVersions, createUpgradeInfo(null)), false)
})
