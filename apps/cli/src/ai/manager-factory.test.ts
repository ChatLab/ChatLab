import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { GENERAL_ASSISTANT_IDS } from '@openchatlab/shared-types'
import { getAssistantManager } from './manager-factory'
import { loadAssistantConfig } from './assistant-loader'

const tempDirs: string[] = []

function createTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  const dir = fs.mkdtempSync(path.join(baseDir, 'chatlab-cli-assistants-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('CLI assistant manager', () => {
  it('lazily initializes shared defaults when standalone chat loads an assistant', () => {
    const aiDataDir = createTempDir()

    const assistant = loadAssistantConfig(aiDataDir, 'general_en')

    assert.equal(assistant?.id, 'general_en')
    assert.ok(assistant?.systemPrompt)
    assert.equal(fs.existsSync(path.join(aiDataDir, 'assistants', 'general_en.md')), true)
  })

  it('initializes all shared defaults and can reset a customized default', () => {
    const manager = getAssistantManager(createTempDir())

    const initResult = manager.init()
    assert.equal(initResult.generalCreated, true)
    assert.deepEqual(
      manager
        .getAllAssistants()
        .map((assistant) => assistant.id)
        .sort(),
      [...GENERAL_ASSISTANT_IDS].sort()
    )

    const originalPrompt = manager.getAssistantConfig('general_cn')?.systemPrompt
    assert.ok(originalPrompt)
    assert.equal(manager.updateAssistant('general_cn', { systemPrompt: 'Customized prompt.' }).success, true)

    const resetResult = manager.resetAssistant('general_cn')
    assert.equal(resetResult.success, true)
    assert.equal(manager.getAssistantConfig('general_cn')?.systemPrompt, originalPrompt)
  })
})
