import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { AssistantManager, type AssistantManagerFs, type AssistantManagerDeps } from '../assistant-manager'
import { parseAssistantFile, serializeAssistant } from '../assistant-parser'
import type { AssistantConfig } from '../types'

function createMemoryFs(): AssistantManagerFs & { files: Map<string, string> } {
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

const SAMPLE_BUILTIN = `---
id: general_cn
name: 通用助手
presetQuestions:
  - 你好
---
你是一个通用助手。`

const SAMPLE_BUILTIN_V2 = `---
id: general_cn
name: 通用助手
builtinVersion: 2
presetQuestions:
  - 你好
---
你是更自然的分析搭档。`

const hashContent = (content: string) => createHash('sha256').update(content).digest('hex')

function getConfigDigest(config: AssistantConfig): string {
  return hashContent(
    JSON.stringify({
      name: config.name,
      systemPrompt: config.systemPrompt,
      presetQuestions: config.presetQuestions,
      allowedBuiltinTools: config.allowedBuiltinTools ?? [],
      applicableChatTypes: config.applicableChatTypes ?? [],
      supportedLocales: config.supportedLocales ?? [],
    })
  )
}

function createManager(opts?: {
  builtins?: Array<{ id: string; content: string }>
  generalIds?: string[]
  legacyBuiltinDigests?: Record<string, string[]>
  fs?: ReturnType<typeof createMemoryFs>
}): {
  manager: AssistantManager
  fs: ReturnType<typeof createMemoryFs>
} {
  const memFs = opts?.fs ?? createMemoryFs()
  let idCounter = 0
  const deps: AssistantManagerDeps = {
    fs: memFs,
    assistantsDir: '/data/assistants',
    builtinRawConfigs: opts?.builtins || [{ id: 'general_cn', content: SAMPLE_BUILTIN }],
    generalIds: opts?.generalIds || ['general_cn'],
    contentHash: hashContent,
    legacyBuiltinDigests: opts?.legacyBuiltinDigests,
    generateId: () => `custom_${++idCounter}`,
  }
  return { manager: new AssistantManager(deps), fs: memFs }
}

function createCustomizedLegacyUpgradeManager(): ReturnType<typeof createManager> {
  const legacyConfig = parseAssistantFile(SAMPLE_BUILTIN, 'general_cn.md')!
  const fs = createMemoryFs()
  fs.files.set(
    '/data/assistants/general_cn.md',
    serializeAssistant({ ...legacyConfig, builtinId: 'general_cn', systemPrompt: '保留我的自定义提示词。' })
  )
  return createManager({
    fs,
    builtins: [{ id: 'general_cn', content: SAMPLE_BUILTIN_V2 }],
    legacyBuiltinDigests: { general_cn: [getConfigDigest(legacyConfig)] },
  })
}

describe('AssistantManager', () => {
  let manager: AssistantManager
  let memFs: ReturnType<typeof createMemoryFs>

  beforeEach(() => {
    const ctx = createManager()
    manager = ctx.manager
    memFs = ctx.fs
  })

  it('initializes and creates general assistants', () => {
    const result = manager.init()
    assert.ok(result.generalCreated)
    assert.equal(result.generalUpdated, false)
    assert.equal(result.total, 1)
    assert.ok(memFs.files.has('/data/assistants/general_cn.md'))
    assert.ok(manager.getAssistantConfig('general_cn')?.builtinDigest)
  })

  it('does not recreate general if already exists', () => {
    manager.init()
    const result2 = manager.init()
    assert.equal(result2.generalCreated, false)
    assert.equal(result2.generalUpdated, false)
  })

  it('backs up a custom assistant before reserving a newly introduced general id', () => {
    const fs = createMemoryFs()
    fs.files.set(
      '/data/assistants/general_tw.md',
      serializeAssistant({
        id: 'general_tw',
        name: 'My Traditional Chinese Assistant',
        systemPrompt: 'Keep this custom prompt.',
        presetQuestions: ['Custom question'],
      })
    )
    const traditionalChineseBuiltin = SAMPLE_BUILTIN.replaceAll('general_cn', 'general_tw')
    const ctx = createManager({
      fs,
      builtins: [{ id: 'general_tw', content: traditionalChineseBuiltin }],
      generalIds: ['general_tw'],
    })

    const result = ctx.manager.init()

    assert.equal(result.generalCreated, true)
    assert.equal(ctx.manager.getAssistantConfig('general_tw')?.builtinId, 'general_tw')
    assert.equal(ctx.manager.getAssistantConfig('general_tw')?.systemPrompt, '你是一个通用助手。')
    assert.equal(ctx.manager.getAssistantConfig('custom_1')?.systemPrompt, 'Keep this custom prompt.')
    assert.equal(ctx.manager.getAssistantConfig('custom_1')?.builtinId, undefined)
    assert.equal(ctx.manager.deleteAssistant('custom_1').success, true)
  })

  it('keeps the custom assistant backup if writing the reserved default fails', () => {
    const fs = createMemoryFs()
    const reservedPath = '/data/assistants/general_tw.md'
    fs.files.set(
      reservedPath,
      serializeAssistant({
        id: 'general_tw',
        name: 'My Traditional Chinese Assistant',
        systemPrompt: 'Keep this custom prompt.',
        presetQuestions: [],
      })
    )
    const writeFile = fs.writeFile
    fs.writeFile = (filePath, content) => {
      if (filePath === reservedPath) throw new Error('Default write failed')
      writeFile(filePath, content)
    }
    const ctx = createManager({
      fs,
      builtins: [{ id: 'general_tw', content: SAMPLE_BUILTIN.replaceAll('general_cn', 'general_tw') }],
      generalIds: ['general_tw'],
    })

    const result = ctx.manager.init()

    assert.equal(result.generalCreated, false)
    assert.equal(ctx.manager.getAssistantConfig('general_tw')?.systemPrompt, 'Keep this custom prompt.')
    assert.equal(ctx.manager.getAssistantConfig('custom_1')?.systemPrompt, 'Keep this custom prompt.')
  })

  it('upgrades an unmodified legacy general assistant', () => {
    const legacyConfig = parseAssistantFile(SAMPLE_BUILTIN, 'general_cn.md')!
    const nextBuiltin = `---
id: general_cn
name: 通用助手
builtinVersion: 2
presetQuestions:
  - 你好
---
你是更自然的分析搭档。`
    const fs = createMemoryFs()
    fs.files.set('/data/assistants/general_cn.md', serializeAssistant({ ...legacyConfig, builtinId: 'general_cn' }))
    const ctx = createManager({
      fs,
      builtins: [{ id: 'general_cn', content: nextBuiltin }],
      legacyBuiltinDigests: { general_cn: [getConfigDigest(legacyConfig)] },
    })

    const result = ctx.manager.init()
    const upgraded = ctx.manager.getAssistantConfig('general_cn')!

    assert.equal(result.generalUpdated, true)
    assert.equal(upgraded.builtinVersion, 2)
    assert.equal(upgraded.systemPrompt, '你是更自然的分析搭档。')
    assert.equal(upgraded.builtinDigest, getConfigDigest(parseAssistantFile(nextBuiltin, 'general_cn.md')!))
  })

  it('preserves a customized legacy general assistant', () => {
    const legacyConfig = parseAssistantFile(SAMPLE_BUILTIN, 'general_cn.md')!
    const nextBuiltin = SAMPLE_BUILTIN.replace('你是一个通用助手。', '你是更自然的分析搭档。').replace(
      'name: 通用助手',
      'name: 通用助手\nbuiltinVersion: 2'
    )
    const fs = createMemoryFs()
    fs.files.set(
      '/data/assistants/general_cn.md',
      serializeAssistant({ ...legacyConfig, builtinId: 'general_cn', systemPrompt: '保留我的自定义提示词。' })
    )
    const ctx = createManager({
      fs,
      builtins: [{ id: 'general_cn', content: nextBuiltin }],
      legacyBuiltinDigests: { general_cn: [getConfigDigest(legacyConfig)] },
    })

    const result = ctx.manager.init()

    assert.equal(result.generalUpdated, false)
    assert.equal(ctx.manager.getAssistantConfig('general_cn')!.systemPrompt, '保留我的自定义提示词。')
  })

  it('reports an upgrade only for a customized outdated default assistant', () => {
    const ctx = createCustomizedLegacyUpgradeManager()
    ctx.manager.init()

    assert.deepEqual(ctx.manager.getAssistantUpgradeInfo('general_cn'), {
      assistantId: 'general_cn',
      builtinId: 'general_cn',
      name: '通用助手',
      currentVersion: null,
      latestVersion: 2,
    })

    manager.init()
    manager.updateAssistant('general_cn', { systemPrompt: '当前模板上的自定义提示词。' })
    assert.equal(manager.getAssistantUpgradeInfo('general_cn'), null)
  })

  it('backs up a customized outdated default before upgrading it', () => {
    const ctx = createCustomizedLegacyUpgradeManager()
    ctx.manager.init()

    const result = ctx.manager.upgradeAssistantWithBackup('general_cn', '通用助手（旧版备份）')

    assert.deepEqual(result, { success: true, backupId: 'custom_1' })
    assert.equal(ctx.manager.getAssistantConfig('general_cn')!.systemPrompt, '你是更自然的分析搭档。')
    assert.equal(ctx.manager.getAssistantConfig('general_cn')!.builtinVersion, 2)
    const backup = ctx.manager.getAssistantConfig('custom_1')!
    assert.equal(backup.name, '通用助手（旧版备份）')
    assert.equal(backup.systemPrompt, '保留我的自定义提示词。')
    assert.equal(backup.builtinId, undefined)
    assert.equal(backup.builtinVersion, undefined)
    assert.equal(backup.builtinDigest, undefined)
    assert.equal(ctx.manager.getAssistantUpgradeInfo('general_cn'), null)
  })

  it('keeps the old default untouched when its backup cannot be written', () => {
    const ctx = createCustomizedLegacyUpgradeManager()
    ctx.manager.init()
    const writeFile = ctx.fs.writeFile
    ctx.fs.writeFile = (filePath, content) => {
      if (filePath.endsWith('/custom_1.md')) throw new Error('Backup write failed')
      writeFile(filePath, content)
    }

    const result = ctx.manager.upgradeAssistantWithBackup('general_cn', '通用助手（旧版备份）')

    assert.equal(result.success, false)
    assert.equal(ctx.manager.getAssistantConfig('general_cn')!.systemPrompt, '保留我的自定义提示词。')
    assert.equal(ctx.manager.hasAssistant('custom_1'), false)
  })

  it('reuses the backup when replacing the default is retried', () => {
    const ctx = createCustomizedLegacyUpgradeManager()
    ctx.manager.init()
    const writeFile = ctx.fs.writeFile
    ctx.fs.writeFile = (filePath, content) => {
      if (filePath.endsWith('/general_cn.md')) throw new Error('Default write failed')
      writeFile(filePath, content)
    }

    const failed = ctx.manager.upgradeAssistantWithBackup('general_cn', '通用助手（旧版备份）')
    assert.deepEqual(failed, { success: false, backupId: 'custom_1', error: 'Error: Default write failed' })
    assert.equal(ctx.manager.getAssistantConfig('general_cn')!.systemPrompt, '保留我的自定义提示词。')

    ctx.fs.writeFile = writeFile
    const retried = ctx.manager.upgradeAssistantWithBackup('general_cn', '通用助手（旧版备份）')

    assert.deepEqual(retried, { success: true, backupId: 'custom_1' })
    assert.equal(ctx.manager.getAllAssistants().length, 2)
    assert.equal(ctx.manager.getAssistantConfig('general_cn')!.systemPrompt, '你是更自然的分析搭档。')
  })

  it('uses the stored digest to preserve later customizations', () => {
    manager.init()
    manager.updateAssistant('general_cn', { systemPrompt: '用户修改后的提示词。' })
    const nextBuiltin = SAMPLE_BUILTIN.replace('你是一个通用助手。', '新版内置提示词。').replace(
      'name: 通用助手',
      'name: 通用助手\nbuiltinVersion: 2'
    )
    const next = createManager({
      fs: memFs,
      builtins: [{ id: 'general_cn', content: nextBuiltin }],
    })

    const result = next.manager.init()

    assert.equal(result.generalUpdated, false)
    assert.equal(next.manager.getAssistantConfig('general_cn')!.systemPrompt, '用户修改后的提示词。')
  })

  it('uses the stored digest to upgrade an untouched tracked assistant', () => {
    manager.init()
    const nextBuiltin = SAMPLE_BUILTIN.replace('你是一个通用助手。', '新版内置提示词。').replace(
      'name: 通用助手',
      'name: 通用助手\nbuiltinVersion: 2'
    )
    const next = createManager({
      fs: memFs,
      builtins: [{ id: 'general_cn', content: nextBuiltin }],
    })

    const result = next.manager.init()

    assert.equal(result.generalUpdated, true)
    assert.equal(next.manager.getAssistantConfig('general_cn')!.systemPrompt, '新版内置提示词。')
    assert.equal(next.manager.getAssistantConfig('general_cn')!.builtinVersion, 2)
  })

  it('getAllAssistants returns summaries', () => {
    manager.init()
    const all = manager.getAllAssistants()
    assert.equal(all.length, 1)
    assert.equal(all[0].name, '通用助手')
  })

  it('getAssistantConfig returns full config', () => {
    manager.init()
    const config = manager.getAssistantConfig('general_cn')
    assert.ok(config)
    assert.equal(config!.systemPrompt, '你是一个通用助手。')
  })

  it('creates a custom assistant', () => {
    manager.init()
    const result = manager.createAssistant({
      name: 'Custom',
      systemPrompt: 'Be helpful.',
      presetQuestions: [],
    })
    assert.ok(result.success)
    assert.ok(result.id)
    assert.equal(manager.getAllAssistants().length, 2)
  })

  it('updates an assistant', () => {
    manager.init()
    manager.createAssistant({ name: 'Old', systemPrompt: 'x', presetQuestions: [] })
    const result = manager.updateAssistant('custom_1', { name: 'New' })
    assert.ok(result.success)
    assert.equal(manager.getAssistantConfig('custom_1')!.name, 'New')
  })

  it('deletes a non-general assistant', () => {
    manager.init()
    manager.createAssistant({ name: 'ToDelete', systemPrompt: 'x', presetQuestions: [] })
    const result = manager.deleteAssistant('custom_1')
    assert.ok(result.success)
    assert.equal(manager.hasAssistant('custom_1'), false)
  })

  it('refuses to delete general assistant', () => {
    manager.init()
    const result = manager.deleteAssistant('general_cn')
    assert.equal(result.success, false)
    assert.ok(result.error)
  })

  it('resets a builtin assistant', () => {
    manager.init()
    manager.updateAssistant('general_cn', { name: 'Modified' })
    assert.equal(manager.getAssistantConfig('general_cn')!.name, 'Modified')

    const result = manager.resetAssistant('general_cn')
    assert.ok(result.success)
    assert.equal(manager.getAssistantConfig('general_cn')!.name, '通用助手')
    assert.ok(manager.getAssistantConfig('general_cn')!.builtinDigest)
  })

  it('imports from raw markdown', () => {
    manager.init()
    const md = `---
id: cloud_test
name: Cloud Assistant
presetQuestions: []
---
Cloud system prompt.`
    const result = manager.importAssistantFromMd(md)
    assert.ok(result.success)
    assert.equal(result.id, 'cloud_test')
    assert.equal(manager.hasAssistant('cloud_test'), true)
  })

  it('isGeneralAssistant checks correctly', () => {
    assert.ok(manager.isGeneralAssistant('general_cn'))
    assert.ok(!manager.isGeneralAssistant('custom_1'))
  })
})
