import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { SkillManagerCore, type SkillManagerFs, type SkillManagerCoreDeps } from '../skill-manager-core'

function createMemoryFs(): SkillManagerFs & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    ensureDir: () => {
      /* no-op */
    },
    listFiles: (_dir, ext) =>
      Array.from(files.keys())
        .filter((f) => f.endsWith(ext))
        .map((f) => f.split('/').pop()!),
    readFile: (p) => {
      const content = files.get(p)
      if (!content) throw new Error(`File not found: ${p}`)
      return content
    },
    writeFile: (p, content) => files.set(p, content),
    deleteFile: (p) => files.delete(p),
    fileExists: (p) => files.has(p),
    joinPath: (...parts) => parts.join('/'),
  }
}

const SAMPLE_SKILL = `---
id: test_skill
name: Test Skill
description: A test skill
tags:
  - test
chatScope: all
tools: []
---
You are a test skill.`

const TOOL_SKILL = `---
id: tool_skill
name: Tool Skill
description: A skill that requires an analysis tool
tags:
  - test
chatScope: all
tools:
  - keyword_frequency
---
Use keyword frequency.`

function createManager(builtins?: Array<{ id: string; content: string }>) {
  const memFs = createMemoryFs()
  const deps: SkillManagerCoreDeps = {
    fs: memFs,
    skillsDir: '/data/skills',
    builtinRawSkills: builtins || [],
  }
  return { manager: new SkillManagerCore(deps), fs: memFs }
}

describe('SkillManagerCore', () => {
  let manager: SkillManagerCore

  beforeEach(() => {
    const ctx = createManager()
    manager = ctx.manager
  })

  it('initializes with empty catalog', () => {
    const result = manager.init()
    assert.equal(result.total, 0)
  })

  it('creates a skill from raw markdown', () => {
    manager.init()
    const result = manager.createSkill(SAMPLE_SKILL)
    assert.ok(result.success)
    assert.equal(result.id, 'test_skill')
    assert.equal(manager.getAllSkills().length, 1)
  })

  it('getSkillConfig returns full def', () => {
    manager.init()
    manager.createSkill(SAMPLE_SKILL)
    const def = manager.getSkillConfig('test_skill')
    assert.ok(def)
    assert.equal(def!.name, 'Test Skill')
    assert.equal(def!.description, 'A test skill')
  })

  it('updates a skill', () => {
    manager.init()
    manager.createSkill(SAMPLE_SKILL)
    const updatedMd = SAMPLE_SKILL.replace('Test Skill', 'Updated Skill')
    const result = manager.updateSkill('test_skill', updatedMd)
    assert.ok(result.success)
    assert.equal(manager.getSkillConfig('test_skill')!.name, 'Updated Skill')
  })

  it('deletes a skill', () => {
    manager.init()
    manager.createSkill(SAMPLE_SKILL)
    const result = manager.deleteSkill('test_skill')
    assert.ok(result.success)
    assert.equal(manager.getSkillConfig('test_skill'), null)
  })

  it('returns error for non-existent skill ops', () => {
    manager.init()
    assert.equal(manager.updateSkill('nope', 'x').success, false)
    assert.equal(manager.deleteSkill('nope').success, false)
  })

  it('imports from raw markdown (cloud)', () => {
    manager.init()
    const result = manager.importSkillFromMd(SAMPLE_SKILL)
    assert.ok(result.success)
    assert.equal(result.id, 'test_skill')
  })

  it('rejects duplicate cloud import', () => {
    manager.init()
    manager.importSkillFromMd(SAMPLE_SKILL)
    const result = manager.importSkillFromMd(SAMPLE_SKILL)
    assert.equal(result.success, false)
  })

  it('getSkillMenu returns null when no skills', () => {
    manager.init()
    assert.equal(manager.getSkillMenu('group'), null)
  })

  it('getSkillMenu returns menu text', () => {
    manager.init()
    manager.createSkill(SAMPLE_SKILL)
    const menu = manager.getSkillMenu('group')
    assert.ok(menu)
    assert.ok(menu!.includes('test_skill'))
    assert.ok(menu!.includes('Test Skill'))
  })

  it('getSkillMenu filters by chatScope', () => {
    manager.init()
    const groupOnly = SAMPLE_SKILL.replace('chatScope: all', 'chatScope: group')
    manager.createSkill(groupOnly)
    assert.ok(manager.getSkillMenu('group'))
    assert.equal(manager.getSkillMenu('private'), null)
  })

  it('getSkillMenu treats an empty allowedTools list as no analysis tools allowed', () => {
    manager.init()
    manager.createSkill(TOOL_SKILL)

    assert.equal(manager.getSkillMenu('group', []), null)
    assert.match(manager.getSkillMenu('group', ['keyword_frequency']) ?? '', /tool_skill/)
  })
})

describe('SkillManagerCore with builtins', () => {
  it('imports builtin skill', () => {
    const { manager } = createManager([{ id: 'builtin_1', content: SAMPLE_SKILL }])
    manager.init()
    const result = manager.importSkill('builtin_1')
    assert.ok(result.success)
    assert.equal(manager.getAllSkills().length, 1)
  })

  it('shows builtin catalog', () => {
    const { manager } = createManager([{ id: 'builtin_1', content: SAMPLE_SKILL }])
    manager.init()
    const catalog = manager.getBuiltinCatalog()
    assert.equal(catalog.length, 1)
    assert.equal(catalog[0].imported, false)
  })

  it('marks imported builtin in catalog', () => {
    const { manager } = createManager([{ id: 'builtin_1', content: SAMPLE_SKILL }])
    manager.init()
    manager.importSkill('builtin_1')
    const catalog = manager.getBuiltinCatalog()
    assert.equal(catalog[0].imported, true)
  })
})
