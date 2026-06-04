/**
 * Platform-agnostic skill manager (core logic).
 * Same strategy as AssistantManager: abstract FS and builtin resources via DI.
 *
 * Note: Named "skill-manager-core" to avoid conflict with the existing
 * Electron-specific SkillManager class in skill-manager.ts.
 */

import { parseSkillFile } from './skill-parser'
import { buildSkillMenuText, formatSkillMenuLine, MAX_SKILL_MENU_ITEMS } from './skill-menu'
import type { SkillDef, SkillSummary } from './types'

// ==================== Result types ====================

export interface SkillInitResult {
  total: number
}

export interface SkillSaveResult {
  success: boolean
  error?: string
}

export interface BuiltinSkillInfo {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  tools: string[]
  imported: boolean
  hasUpdate: boolean
}

// ==================== Dependency abstraction ====================

export interface SkillManagerFs {
  ensureDir(dir: string): void
  listFiles(dir: string, ext: string): string[]
  readFile(filePath: string): string
  writeFile(filePath: string, content: string): void
  deleteFile(filePath: string): void
  fileExists(filePath: string): boolean
  joinPath(...parts: string[]): string
}

export interface SkillManagerCoreDeps {
  fs: SkillManagerFs
  skillsDir: string
  builtinRawSkills?: Array<{ id: string; content: string }>
  contentHash?: (content: string) => string
  logger?: {
    info: (category: string, message: string, data?: unknown) => void
    warn: (category: string, message: string, data?: unknown) => void
    error: (category: string, message: string, data?: unknown) => void
  }
}

// ==================== Internal helpers ====================

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

function injectBuiltinId(rawMd: string, builtinId: string): string {
  if (rawMd.includes('builtinId:')) return rawMd
  const endOfFrontmatter = rawMd.indexOf('\n---', 3)
  if (endOfFrontmatter === -1) return rawMd
  return rawMd.slice(0, endOfFrontmatter) + `\nbuiltinId: ${builtinId}` + rawMd.slice(endOfFrontmatter)
}

function stripBuiltinId(content: string): string {
  return content.replace(/\nbuiltinId:.*\n/g, '\n')
}

function simpleHash(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}

// ==================== Manager ====================

export class SkillManagerCore {
  private deps: SkillManagerCoreDeps
  private builtinDefs = new Map<string, SkillDef>()
  private builtinRawMap = new Map<string, string>()
  private cache = new Map<string, SkillDef>()
  private initialized = false
  private hashFn: (content: string) => string

  constructor(deps: SkillManagerCoreDeps) {
    this.deps = deps
    this.hashFn = deps.contentHash || simpleHash
    this.initBuiltinCache()
  }

  private initBuiltinCache(): void {
    if (!this.deps.builtinRawSkills) return
    for (const { id, content } of this.deps.builtinRawSkills) {
      this.builtinRawMap.set(id, content)
      const def = parseSkillFile(content, `${id}.md`)
      if (def) this.builtinDefs.set(id, def)
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) this.init()
  }

  // ==================== Init ====================

  init(): SkillInitResult {
    const { fs, skillsDir } = this.deps
    fs.ensureDir(skillsDir)
    this.loadAll()

    this.initialized = true
    this.deps.logger?.info('SkillManager', 'Initialized', { total: this.cache.size })

    return { total: this.cache.size }
  }

  private loadAll(): void {
    const { fs, skillsDir } = this.deps
    this.cache.clear()

    const files = fs.listFiles(skillsDir, '.md')
    for (const file of files) {
      try {
        const filePath = fs.joinPath(skillsDir, file)
        const content = fs.readFile(filePath)
        const def = parseSkillFile(content, filePath)
        if (def) {
          this.cache.set(def.id, def)
        } else {
          this.deps.logger?.warn('SkillManager', `Failed to parse: ${file}`)
        }
      } catch (error) {
        this.deps.logger?.warn('SkillManager', `Failed to load: ${file}`, { error: String(error) })
      }
    }
  }

  // ==================== Query ====================

  getAllSkills(): SkillSummary[] {
    this.ensureInitialized()
    return Array.from(this.cache.values()).map(toSummary)
  }

  getSkillConfig(id: string): SkillDef | null {
    this.ensureInitialized()
    return this.cache.get(id) ?? null
  }

  // ==================== Builtin catalog ====================

  getBuiltinCatalog(): BuiltinSkillInfo[] {
    this.ensureInitialized()

    return Array.from(this.builtinDefs.entries()).map(([builtinId, builtin]) => {
      const userSkill = this.findByBuiltinId(builtinId)
      const imported = !!userSkill
      const hasUpdate = imported ? this.hasBuiltinUpdate(builtinId, userSkill!) : false

      return {
        id: builtinId,
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

  // ==================== Import ====================

  importSkill(builtinId: string): SkillSaveResult & { id?: string } {
    this.ensureInitialized()

    const rawContent = this.builtinRawMap.get(builtinId)
    if (!rawContent) return { success: false, error: `Builtin skill not found: ${builtinId}` }

    const existing = this.findByBuiltinId(builtinId)
    if (existing) return { success: false, error: `Skill already imported: ${builtinId}` }

    const contentWithId = injectBuiltinId(rawContent, builtinId)
    const def = parseSkillFile(contentWithId, `${builtinId}.md`)
    if (!def) return { success: false, error: `Failed to parse builtin skill: ${builtinId}` }
    def.builtinId = builtinId

    const result = this.saveToDisk(def.id, contentWithId, def)
    return { ...result, id: result.success ? def.id : undefined }
  }

  reimportSkill(id: string): SkillSaveResult {
    this.ensureInitialized()

    const existing = this.cache.get(id)
    if (!existing) return { success: false, error: `Skill not found: ${id}` }
    if (!existing.builtinId) return { success: false, error: 'Only imported builtin skills can be reimported' }

    const rawContent = this.builtinRawMap.get(existing.builtinId)
    if (!rawContent) return { success: false, error: `Builtin template not found: ${existing.builtinId}` }

    const contentWithId = injectBuiltinId(rawContent, existing.builtinId)
    const def = parseSkillFile(contentWithId, `${id}.md`)
    if (!def) return { success: false, error: `Failed to parse builtin skill: ${existing.builtinId}` }
    def.builtinId = existing.builtinId

    return this.saveToDisk(id, contentWithId, def)
  }

  importSkillFromMd(rawMd: string): SkillSaveResult & { id?: string } {
    this.ensureInitialized()

    const def = parseSkillFile(rawMd, 'cloud_import.md')
    if (!def) return { success: false, error: 'Failed to parse skill markdown' }

    if (this.cache.has(def.id)) return { success: false, error: `Skill already exists: ${def.id}` }

    const result = this.saveToDisk(def.id, rawMd, def)
    return { ...result, id: result.success ? def.id : undefined }
  }

  // ==================== Mutate ====================

  updateSkill(id: string, rawMd: string): SkillSaveResult {
    this.ensureInitialized()

    const existing = this.cache.get(id)
    if (!existing) return { success: false, error: `Skill not found: ${id}` }

    const def = parseSkillFile(rawMd, `${id}.md`)
    if (!def) return { success: false, error: 'Failed to parse skill content' }

    def.id = id
    if (existing.builtinId) def.builtinId = existing.builtinId

    return this.saveToDisk(id, rawMd, def)
  }

  createSkill(rawMd: string): SkillSaveResult & { id?: string } {
    this.ensureInitialized()

    const def = parseSkillFile(rawMd, 'new_skill.md')
    if (!def) return { success: false, error: 'Failed to parse skill content' }

    if (this.cache.has(def.id)) {
      def.id = `${def.id}_${Date.now().toString(36)}`
    }

    const result = this.saveToDisk(def.id, rawMd, def)
    return { ...result, id: result.success ? def.id : undefined }
  }

  deleteSkill(id: string): SkillSaveResult {
    this.ensureInitialized()

    const existing = this.cache.get(id)
    if (!existing) return { success: false, error: `Skill not found: ${id}` }

    try {
      const filePath = this.deps.fs.joinPath(this.deps.skillsDir, `${id}.md`)
      if (this.deps.fs.fileExists(filePath)) this.deps.fs.deleteFile(filePath)
      this.cache.delete(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  // ==================== AI Skill Menu ====================

  getSkillMenu(chatType: 'group' | 'private', allowedTools?: string[]): string | null {
    this.ensureInitialized()

    const compatible = Array.from(this.cache.values()).filter((skill) => {
      if (skill.chatScope !== 'all' && skill.chatScope !== chatType) return false
      if (skill.tools.length > 0 && allowedTools !== undefined) {
        if (!skill.tools.every((t) => allowedTools.includes(t))) return false
      }
      return true
    })

    if (compatible.length === 0) return null

    const items = compatible.slice(0, MAX_SKILL_MENU_ITEMS)
    return buildSkillMenuText(items.map(formatSkillMenuLine))
  }

  // ==================== Internal ====================

  private findByBuiltinId(builtinId: string): SkillDef | undefined {
    return Array.from(this.cache.values()).find((s) => s.builtinId === builtinId)
  }

  private saveToDisk(id: string, rawMd: string, def: SkillDef): SkillSaveResult {
    try {
      const filePath = this.deps.fs.joinPath(this.deps.skillsDir, `${id}.md`)
      this.deps.fs.writeFile(filePath, rawMd)
      this.cache.set(id, def)
      return { success: true }
    } catch (error) {
      this.deps.logger?.error('SkillManager', `Failed to save: ${id}`, { error: String(error) })
      return { success: false, error: String(error) }
    }
  }

  private hasBuiltinUpdate(builtinId: string, userSkill: SkillDef): boolean {
    const rawContent = this.builtinRawMap.get(builtinId)
    if (!rawContent) return false

    try {
      const userFilePath = this.deps.fs.joinPath(this.deps.skillsDir, `${userSkill.id}.md`)
      const userContent = this.deps.fs.readFile(userFilePath)
      return this.hashFn(rawContent) !== this.hashFn(stripBuiltinId(userContent))
    } catch {
      return false
    }
  }
}
