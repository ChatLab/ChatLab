/**
 * 技能管理器
 * 负责技能配置的加载、CRUD、内置技能导入和 AI 自选菜单构建
 *
 * 存储策略（导入模型）：
 * - 内置技能作为模板打包在 BUILTIN_SKILL_RAW 中（.md 原始字符串）
 * - 不自动导入任何技能（与助手系统不同）
 * - 用户通过"技能市场"主动导入内置技能
 * - 导入后完全属于用户，可自由编辑/删除
 * - 市场可查看内置技能是否有更新，用户可手动重新导入
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { getAiDataDir, ensureDir } from '../../paths'
import { aiLogger } from '../logger'
import { parseSkillFile } from './parser'
import type {
  SkillDef,
  SkillSummary,
  SkillInitResult,
  SkillSaveResult,
  BuiltinSkillInfo,
} from './types'

// ==================== 内置技能模板 ====================
// 云端市场上线后，本地不再内置技能模板，全部从云端获取

const BUILTIN_SKILL_RAW: { id: string; content: string }[] = []

// Parsed cache of builtin templates
const builtinSkillDefs: Map<string, SkillDef> = new Map()

function getBuiltinDefs(): Map<string, SkillDef> {
  if (builtinSkillDefs.size === 0) {
    for (const { id, content } of BUILTIN_SKILL_RAW) {
      const def = parseSkillFile(content, `${id}.md`)
      if (def) {
        builtinSkillDefs.set(id, def)
      }
    }
  }
  return builtinSkillDefs
}

function getBuiltinRawContent(builtinId: string): string | undefined {
  return BUILTIN_SKILL_RAW.find((b) => b.id === builtinId)?.content
}

// ==================== 用户技能缓存 ====================

const SKILLS_DIR_NAME = 'skills'

const cachedSkills: Map<string, SkillDef> = new Map()
let initialized = false

function getSkillsDir(): string {
  return path.join(getAiDataDir(), SKILLS_DIR_NAME)
}

// ==================== 初始化 ====================

export function initSkillManager(): SkillInitResult {
  const skillsDir = getSkillsDir()
  ensureDir(skillsDir)

  loadAllSkills()

  initialized = true
  aiLogger.info('SkillManager', 'Initialized', { total: cachedSkills.size })

  return { total: cachedSkills.size }
}

function loadAllSkills(): void {
  cachedSkills.clear()

  const skillsDir = getSkillsDir()
  if (!fs.existsSync(skillsDir)) return

  const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith('.md'))

  for (const file of files) {
    try {
      const filePath = path.join(skillsDir, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      const def = parseSkillFile(content, filePath)
      if (def) {
        cachedSkills.set(def.id, def)
      } else {
        aiLogger.warn('SkillManager', `Failed to parse skill: ${file}`)
      }
    } catch (error) {
      aiLogger.warn('SkillManager', `Failed to load skill: ${file}`, { error: String(error) })
    }
  }
}

// ==================== 查询 API ====================

export function getAllSkills(): SkillSummary[] {
  ensureInitialized()
  return Array.from(cachedSkills.values()).map(toSummary)
}

export function getSkillConfig(id: string): SkillDef | null {
  ensureInitialized()
  return cachedSkills.get(id) ?? null
}

// ==================== 内置技能目录（市场） ====================

export function getBuiltinCatalog(): BuiltinSkillInfo[] {
  ensureInitialized()

  const defs = getBuiltinDefs()
  return Array.from(defs.values()).map((builtin) => {
    const userSkill = findImportedByBuiltinId(builtin.id)
    const imported = !!userSkill
    const hasUpdate = imported ? hasBuiltinUpdate(builtin.id, userSkill!) : false

    return {
      id: builtin.id,
      name: builtin.name,
      description: builtin.description,
      tags: builtin.tags,
      chatScope: builtin.chatScope,
      tools: builtin.tools,
      imported,
      hasUpdate,
    }
  })
}

export function importSkill(builtinId: string): SkillSaveResult & { id?: string } {
  ensureInitialized()

  const rawContent = getBuiltinRawContent(builtinId)
  if (!rawContent) {
    return { success: false, error: `Builtin skill not found: ${builtinId}` }
  }

  const existing = findImportedByBuiltinId(builtinId)
  if (existing) {
    return { success: false, error: `Skill already imported: ${builtinId}` }
  }

  const def = parseSkillFile(rawContent, `${builtinId}.md`)
  if (!def) {
    return { success: false, error: `Failed to parse builtin skill: ${builtinId}` }
  }

  const contentWithBuiltinId = injectBuiltinId(rawContent, builtinId)
  return saveSkillToDisk(def.id, contentWithBuiltinId, def)
}

export function reimportSkill(id: string): SkillSaveResult {
  ensureInitialized()

  const existing = cachedSkills.get(id)
  if (!existing) {
    return { success: false, error: `Skill not found: ${id}` }
  }
  if (!existing.builtinId) {
    return { success: false, error: 'Only imported builtin skills can be reimported' }
  }

  const rawContent = getBuiltinRawContent(existing.builtinId)
  if (!rawContent) {
    return { success: false, error: `Builtin template not found: ${existing.builtinId}` }
  }

  const contentWithBuiltinId = injectBuiltinId(rawContent, existing.builtinId)
  const def = parseSkillFile(contentWithBuiltinId, `${id}.md`)
  if (!def) {
    return { success: false, error: `Failed to parse builtin skill: ${existing.builtinId}` }
  }
  def.builtinId = existing.builtinId

  return saveSkillToDisk(id, contentWithBuiltinId, def)
}

// ==================== 修改 API ====================

export function updateSkill(id: string, rawMd: string): SkillSaveResult {
  ensureInitialized()

  const existing = cachedSkills.get(id)
  if (!existing) {
    return { success: false, error: `Skill not found: ${id}` }
  }

  const def = parseSkillFile(rawMd, `${id}.md`)
  if (!def) {
    return { success: false, error: 'Failed to parse skill content' }
  }

  def.id = id
  if (existing.builtinId) {
    def.builtinId = existing.builtinId
  }

  return saveSkillToDisk(id, rawMd, def)
}

export function createSkill(rawMd: string): SkillSaveResult & { id?: string } {
  ensureInitialized()

  const def = parseSkillFile(rawMd, 'new_skill.md')
  if (!def) {
    return { success: false, error: 'Failed to parse skill content' }
  }

  if (cachedSkills.has(def.id)) {
    const suffix = Date.now().toString(36)
    def.id = `${def.id}_${suffix}`
  }

  const result = saveSkillToDisk(def.id, rawMd, def)
  return { ...result, id: result.success ? def.id : undefined }
}

export function deleteSkill(id: string): SkillSaveResult {
  ensureInitialized()

  const existing = cachedSkills.get(id)
  if (!existing) {
    return { success: false, error: `Skill not found: ${id}` }
  }

  try {
    const filePath = path.join(getSkillsDir(), `${id}.md`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    cachedSkills.delete(id)
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ==================== 云端导入 ====================

/**
 * 从原始 Markdown 导入技能（云端市场用）
 * 与 createSkill 类似，但 id 冲突时拒绝而非重命名
 */
export function importSkillFromMd(rawMd: string): SkillSaveResult & { id?: string } {
  ensureInitialized()

  const def = parseSkillFile(rawMd, 'cloud_import.md')
  if (!def) {
    return { success: false, error: 'Failed to parse skill markdown' }
  }

  if (cachedSkills.has(def.id)) {
    return { success: false, error: `Skill already exists: ${def.id}` }
  }

  const result = saveSkillToDisk(def.id, rawMd, def)
  return { ...result, id: result.success ? def.id : undefined }
}

// ==================== AI 自选菜单 ====================

const MAX_SKILL_MENU_ITEMS = 15

/**
 * 构建 AI 自选技能菜单文本
 * 只包含与当前 chatType + 助手工具权限兼容的技能
 */
export function getSkillMenu(
  chatType: 'group' | 'private',
  allowedTools?: string[]
): string | null {
  ensureInitialized()

  const compatible = Array.from(cachedSkills.values()).filter((skill) => {
    if (skill.chatScope !== 'all' && skill.chatScope !== chatType) return false
    if (skill.tools.length > 0 && allowedTools && allowedTools.length > 0) {
      const allCovered = skill.tools.every((t) => allowedTools.includes(t))
      if (!allCovered) return false
    }
    return true
  })

  if (compatible.length === 0) return null

  const items = compatible.slice(0, MAX_SKILL_MENU_ITEMS)
  const lines = items.map((s) => `- ${s.id}: ${s.name} — ${s.description}`)

  return `## 可用技能
以下是你可以使用的分析技能。当你判断用户的问题适合使用某个技能时，
请调用 activate_skill 工具激活它，然后按照返回的指导完成任务。

${lines.join('\n')}

如果用户的问题不需要使用技能，直接回答即可。`
}

// ==================== 内部工具函数 ====================

function ensureInitialized(): void {
  if (!initialized) {
    initSkillManager()
  }
}

function findImportedByBuiltinId(builtinId: string): SkillDef | undefined {
  return Array.from(cachedSkills.values()).find((s) => s.builtinId === builtinId)
}

function toSummary(def: SkillDef): SkillSummary {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    tags: def.tags,
    chatScope: def.chatScope,
    tools: def.tools,
    builtinId: def.builtinId,
  }
}

function saveSkillToDisk(id: string, rawMd: string, def: SkillDef): SkillSaveResult {
  try {
    const filePath = path.join(getSkillsDir(), `${id}.md`)
    fs.writeFileSync(filePath, rawMd, 'utf-8')
    cachedSkills.set(id, def)
    return { success: true }
  } catch (error) {
    aiLogger.error('SkillManager', `Failed to save skill: ${id}`, { error: String(error) })
    return { success: false, error: String(error) }
  }
}

/**
 * 在 frontmatter 中注入 builtinId 标记
 * 使导入后的文件能追溯到内置模板来源
 */
function injectBuiltinId(rawMd: string, builtinId: string): string {
  const marker = `builtinId: ${builtinId}`
  if (rawMd.includes('builtinId:')) return rawMd

  const endOfFrontmatter = rawMd.indexOf('\n---', 3)
  if (endOfFrontmatter === -1) return rawMd

  return rawMd.slice(0, endOfFrontmatter) + `\n${marker}` + rawMd.slice(endOfFrontmatter)
}

function contentHash(content: string): string {
  return createHash('md5').update(content).digest('hex')
}

/**
 * 检查内置技能是否有更新（基于内容 hash 比对）
 */
function hasBuiltinUpdate(builtinId: string, userSkill: SkillDef): boolean {
  const rawContent = getBuiltinRawContent(builtinId)
  if (!rawContent) return false

  const userFilePath = path.join(getSkillsDir(), `${userSkill.id}.md`)
  try {
    const userContent = fs.readFileSync(userFilePath, 'utf-8')
    const builtinPromptHash = contentHash(rawContent)
    const userPromptHash = contentHash(stripBuiltinId(userContent))
    return builtinPromptHash !== userPromptHash
  } catch {
    return false
  }
}

function stripBuiltinId(content: string): string {
  return content.replace(/\nbuiltinId:.*\n/g, '\n')
}
