import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SkillManager } from '../skill-manager'

const SAMPLE_SKILL = `---
id: legacy_skill
name: Legacy Skill
description: Loaded through the legacy SkillManager API
tags:
  - test
chatScope: group
tools:
  - keyword_frequency
---
You are a legacy skill.`

const tempDirs: string[] = []

function createTempAiDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-skill-manager-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('SkillManager legacy adapter', () => {
  it('creates the skills directory during initialization', () => {
    const aiDataDir = createTempAiDataDir()
    const manager = new SkillManager(aiDataDir)

    const result = manager.init()

    assert.equal(result.total, 0)
    assert.equal(existsSync(join(aiDataDir, 'skills')), true)
  })

  it('keeps the existing runtime query API while delegating to the core manager', () => {
    const aiDataDir = createTempAiDataDir()
    const skillsDir = join(aiDataDir, 'skills')
    const manager = new SkillManager(aiDataDir)
    manager.init()
    writeFileSync(join(skillsDir, 'legacy_skill.md'), SAMPLE_SKILL, 'utf-8')
    manager.init()

    const menu = manager.getSkillMenu('group', ['keyword_frequency'])

    assert.ok(menu)
    assert.match(menu, /legacy_skill/)
    assert.equal(manager.getSkillConfig('legacy_skill')?.name, 'Legacy Skill')
    assert.equal(manager.getAllSkills().length, 1)
    assert.equal(manager.getSkillMenu('private', ['keyword_frequency']), null)
  })
})
