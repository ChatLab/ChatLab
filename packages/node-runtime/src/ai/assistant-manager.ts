/**
 * Platform-agnostic assistant manager.
 * Abstracts file system operations and builtin resource loading
 * via dependency injection.
 */

import { parseAssistantFile, serializeAssistant } from './assistant-parser'
import type { AssistantConfig, AssistantSummary } from './types'
import { GENERAL_ASSISTANT_IDS } from '@openchatlab/shared-types'
import type { AssistantUpgradeInfo, AssistantUpgradeResult, BuiltinAssistantInfo } from '@openchatlab/shared-types'

// ==================== Result types ====================

export interface AssistantInitResult {
  total: number
  generalCreated: boolean
  generalUpdated: boolean
}

export interface AssistantSaveResult {
  success: boolean
  error?: string
}

// ==================== Dependency abstraction ====================

export interface AssistantManagerFs {
  ensureDir(dir: string): void
  listFiles(dir: string, ext: string): string[]
  readFile(filePath: string): string
  writeFile(filePath: string, content: string): void
  deleteFile(filePath: string): void
  fileExists(filePath: string): boolean
  joinPath(...parts: string[]): string
}

export interface AssistantManagerDeps {
  fs: AssistantManagerFs
  assistantsDir: string
  builtinRawConfigs?: ReadonlyArray<{ id: string; content: string }>
  generalIds?: readonly string[]
  contentHash: (content: string) => string
  /** Legacy template digests used to identify untouched defaults created before tracking existed. */
  legacyBuiltinDigests?: Readonly<Record<string, readonly string[]>>
  generateId?: () => string
  logger?: {
    info: (category: string, message: string, data?: unknown) => void
    warn: (category: string, message: string, data?: unknown) => void
    error: (category: string, message: string, data?: unknown) => void
  }
}

// ==================== Manager ====================

function toSummary(config: AssistantConfig): AssistantSummary {
  return {
    id: config.id,
    name: config.name,
    systemPrompt: config.systemPrompt,
    presetQuestions: config.presetQuestions,
    builtinId: config.builtinId,
    applicableChatTypes: config.applicableChatTypes,
    supportedLocales: config.supportedLocales,
  }
}

export class AssistantManager {
  private deps: AssistantManagerDeps
  private generalIds: string[]
  private builtinCache = new Map<string, AssistantConfig>()
  private builtinDigestCache = new Map<string, string>()
  private cache = new Map<string, AssistantConfig>()
  private initialized = false

  constructor(deps: AssistantManagerDeps) {
    this.deps = deps
    this.generalIds = [...(deps.generalIds ?? GENERAL_ASSISTANT_IDS)]
    this.initBuiltinCache()
  }

  private initBuiltinCache(): void {
    if (!this.deps.builtinRawConfigs) return
    for (const { id, content } of this.deps.builtinRawConfigs) {
      const config = parseAssistantFile(content, `${id}.md`)
      if (config) {
        this.builtinCache.set(config.id, config)
        this.builtinDigestCache.set(config.id, this.getConfigDigest(config))
      }
    }
  }

  private getBuiltinConfig(id: string): AssistantConfig | undefined {
    return this.builtinCache.get(id)
  }

  private ensureInitialized(): void {
    if (!this.initialized) this.init()
  }

  // ==================== Init ====================

  init(): AssistantInitResult {
    const { fs, assistantsDir } = this.deps
    fs.ensureDir(assistantsDir)

    const { generalCreated, generalUpdated } = this.syncGeneralAssistants()
    this.loadAll()

    this.initialized = true
    this.deps.logger?.info('AssistantManager', 'Initialized', {
      total: this.cache.size,
      generalCreated,
      generalUpdated,
    })

    return { total: this.cache.size, generalCreated, generalUpdated }
  }

  private syncGeneralAssistants(): { generalCreated: boolean; generalUpdated: boolean } {
    const { fs, assistantsDir } = this.deps
    let generalCreated = false
    let generalUpdated = false

    for (const id of this.generalIds) {
      const config = this.getBuiltinConfig(id)
      if (!config) continue

      const filePath = fs.joinPath(assistantsDir, `${id}.md`)
      if (!fs.fileExists(filePath)) {
        fs.writeFile(filePath, serializeAssistant(this.withBuiltinTracking(config)))
        generalCreated = true
        continue
      }

      try {
        const existing = parseAssistantFile(fs.readFile(filePath), filePath)
        if (!existing) continue

        if (existing.builtinId !== id) {
          try {
            const backupId = this.backupAssistantOccupyingReservedId(existing)
            fs.writeFile(filePath, serializeAssistant(this.withBuiltinTracking(config)))
            generalCreated = true
            this.deps.logger?.info('AssistantManager', 'Backed up assistant occupying reserved default ID', {
              reservedId: id,
              backupId,
            })
          } catch (error) {
            // 先写备份再替换默认助手；任一步失败都中止本次迁移，避免静默丢失用户配置。
            this.deps.logger?.error(
              'AssistantManager',
              `Failed to migrate assistant occupying reserved default ID: ${id}`,
              error
            )
          }
          continue
        }

        if (!this.shouldUpgradeBuiltin(existing, config)) continue

        fs.writeFile(filePath, serializeAssistant(this.withBuiltinTracking(config, existing.id)))
        generalUpdated = true
        this.deps.logger?.info('AssistantManager', 'Updated unmodified default assistant template', {
          id,
          fromVersion: existing.builtinVersion,
          toVersion: config.builtinVersion,
        })
      } catch (error) {
        this.deps.logger?.warn('AssistantManager', `Failed to inspect default assistant: ${id}`, {
          error: String(error),
        })
      }
    }

    return { generalCreated, generalUpdated }
  }

  private backupAssistantOccupyingReservedId(config: AssistantConfig): string {
    const { fs, assistantsDir } = this.deps
    const baseId = this.deps.generateId?.() || `custom_${Date.now().toString(36)}`
    let backupId = baseId
    let suffix = 2

    while (this.generalIds.includes(backupId) || fs.fileExists(fs.joinPath(assistantsDir, `${backupId}.md`))) {
      backupId = `${baseId}_${suffix++}`
    }

    fs.writeFile(fs.joinPath(assistantsDir, `${backupId}.md`), serializeAssistant({ ...config, id: backupId }))
    return backupId
  }

  private getConfigDigest(config: AssistantConfig): string {
    // Hash only user-editable template content; tracking metadata must not affect comparison.
    return this.deps.contentHash(
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

  private withBuiltinTracking(config: AssistantConfig, id = config.id): AssistantConfig {
    return {
      ...config,
      id,
      builtinId: config.id,
      builtinVersion: config.builtinVersion,
      builtinDigest: this.builtinDigestCache.get(config.id) ?? this.getConfigDigest(config),
    }
  }

  private shouldUpgradeBuiltin(existing: AssistantConfig, builtin: AssistantConfig): boolean {
    const comparison = this.compareBuiltin(existing, builtin)
    return comparison.isUnmodified && comparison.isOutdated
  }

  private compareBuiltin(
    existing: AssistantConfig,
    builtin: AssistantConfig
  ): {
    isUnmodified: boolean
    isOutdated: boolean
  } {
    const builtinDigest = this.builtinDigestCache.get(builtin.id) ?? this.getConfigDigest(builtin)
    const existingDigest = this.getConfigDigest(existing)
    const knownBaseDigests = existing.builtinDigest
      ? [existing.builtinDigest]
      : (this.deps.legacyBuiltinDigests?.[builtin.id] ?? [])
    const isUnmodified = existingDigest === builtinDigest || knownBaseDigests.includes(existingDigest)
    const isOutdated = existing.builtinDigest !== builtinDigest || existing.builtinVersion !== builtin.builtinVersion

    return { isUnmodified, isOutdated }
  }

  private loadAll(): void {
    const { fs, assistantsDir } = this.deps
    this.cache.clear()

    const files = fs.listFiles(assistantsDir, '.md')
    for (const file of files) {
      try {
        const filePath = fs.joinPath(assistantsDir, file)
        const content = fs.readFile(filePath)
        const config = parseAssistantFile(content, filePath)
        if (config) {
          this.cache.set(config.id, config)
        } else {
          this.deps.logger?.warn('AssistantManager', `Failed to parse: ${file}`)
        }
      } catch (error) {
        this.deps.logger?.warn('AssistantManager', `Failed to load: ${file}`, { error: String(error) })
      }
    }
  }

  // ==================== Query ====================

  getAllAssistants(): AssistantSummary[] {
    this.ensureInitialized()
    return Array.from(this.cache.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(toSummary)
  }

  getAssistantConfig(id: string): AssistantConfig | null {
    this.ensureInitialized()
    return this.cache.get(id) ?? null
  }

  getAssistantUpgradeInfo(id: string): AssistantUpgradeInfo | null {
    this.ensureInitialized()
    if (!this.generalIds.includes(id)) return null

    const existing = this.cache.get(id)
    if (!existing?.builtinId) return null

    const builtin = this.getBuiltinConfig(existing.builtinId)
    if (!builtin) return null

    const comparison = this.compareBuiltin(existing, builtin)
    if (!comparison.isOutdated || comparison.isUnmodified) return null

    return {
      assistantId: existing.id,
      builtinId: existing.builtinId,
      name: existing.name,
      currentVersion: existing.builtinVersion ?? null,
      latestVersion: builtin.builtinVersion ?? null,
    }
  }

  hasAssistant(id: string): boolean {
    this.ensureInitialized()
    return this.cache.has(id)
  }

  getBuiltinCatalog(): BuiltinAssistantInfo[] {
    this.ensureInitialized()
    return []
  }

  isGeneralAssistant(id: string): boolean {
    return this.generalIds.includes(id)
  }

  // ==================== Import ====================

  importAssistant(builtinId: string): AssistantSaveResult {
    this.ensureInitialized()

    const builtinConfig = this.getBuiltinConfig(builtinId)
    if (!builtinConfig) return { success: false, error: `Builtin assistant not found: ${builtinId}` }

    const existing = this.findByBuiltinId(builtinId)
    if (existing) return { success: false, error: `Assistant already imported: ${builtinId}` }

    return this.saveToDisk(this.withBuiltinTracking(builtinConfig))
  }

  reimportAssistant(id: string): AssistantSaveResult {
    this.ensureInitialized()

    const existing = this.cache.get(id)
    if (!existing) return { success: false, error: `Assistant not found: ${id}` }
    if (!existing.builtinId) return { success: false, error: 'Only imported builtin assistants can be reimported' }

    const builtinConfig = this.getBuiltinConfig(existing.builtinId)
    if (!builtinConfig) return { success: false, error: `Builtin template not found: ${existing.builtinId}` }

    return this.saveToDisk(this.withBuiltinTracking(builtinConfig, existing.id))
  }

  importAssistantFromMd(rawMd: string): AssistantSaveResult & { id?: string } {
    this.ensureInitialized()

    const config = parseAssistantFile(rawMd, 'cloud_import.md')
    if (!config) return { success: false, error: 'Failed to parse assistant markdown' }

    if (this.cache.has(config.id)) return { success: false, error: `Assistant already exists: ${config.id}` }

    const result = this.saveToDisk(config)
    return { ...result, id: result.success ? config.id : undefined }
  }

  // ==================== Mutate ====================

  updateAssistant(id: string, updates: Partial<AssistantConfig>): AssistantSaveResult {
    this.ensureInitialized()

    const existing = this.cache.get(id)
    if (!existing) return { success: false, error: `Assistant not found: ${id}` }

    return this.saveToDisk({ ...existing, ...updates, id })
  }

  createAssistant(config: Omit<AssistantConfig, 'id'>): AssistantSaveResult & { id?: string } {
    this.ensureInitialized()

    const id = this.deps.generateId?.() || `custom_${Date.now().toString(36)}`
    const newConfig: AssistantConfig = { ...config, id, builtinId: undefined }

    const result = this.saveToDisk(newConfig)
    return { ...result, id: result.success ? id : undefined }
  }

  deleteAssistant(id: string): AssistantSaveResult {
    this.ensureInitialized()

    if (this.generalIds.includes(id)) return { success: false, error: 'Cannot delete the default assistant (general)' }

    const existing = this.cache.get(id)
    if (!existing) return { success: false, error: `Assistant not found: ${id}` }

    try {
      const filePath = this.deps.fs.joinPath(this.deps.assistantsDir, `${id}.md`)
      if (this.deps.fs.fileExists(filePath)) this.deps.fs.deleteFile(filePath)
      this.cache.delete(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  resetAssistant(id: string): AssistantSaveResult {
    this.ensureInitialized()

    const existing = this.cache.get(id)
    if (!existing?.builtinId) return { success: false, error: 'Only builtin assistants can be reset' }

    const builtinConfig = this.getBuiltinConfig(existing.builtinId)
    if (!builtinConfig) return { success: false, error: `Builtin config not found: ${existing.builtinId}` }

    const result = this.saveToDisk(this.withBuiltinTracking(builtinConfig, existing.id))
    if (result.success) {
      this.deps.logger?.info('AssistantManager', 'Reset builtin assistant to default template', {
        id: existing.id,
        builtinId: existing.builtinId,
      })
    }
    return result
  }

  upgradeAssistantWithBackup(id: string, backupName: string): AssistantUpgradeResult {
    this.ensureInitialized()

    const upgradeInfo = this.getAssistantUpgradeInfo(id)
    if (!upgradeInfo) return { success: false, error: `No assistant upgrade available: ${id}` }

    const existing = this.cache.get(id)!
    const builtin = this.getBuiltinConfig(upgradeInfo.builtinId)!
    const normalizedBackupName = backupName.trim() || `${existing.name} (Legacy Backup)`
    const backupConfig: AssistantConfig = {
      ...existing,
      id: this.deps.generateId?.() || `custom_${Date.now().toString(36)}`,
      name: normalizedBackupName,
      builtinId: undefined,
      builtinVersion: undefined,
      builtinDigest: undefined,
    }

    const existingBackup = Array.from(this.cache.values()).find(
      (config) => !config.builtinId && this.getConfigDigest(config) === this.getConfigDigest(backupConfig)
    )
    const backupId = existingBackup?.id ?? backupConfig.id

    if (!existingBackup) {
      const backupResult = this.saveToDisk(backupConfig)
      if (!backupResult.success) return backupResult
    }

    const upgradeResult = this.saveToDisk(this.withBuiltinTracking(builtin, existing.id))
    if (!upgradeResult.success) {
      this.deps.logger?.warn('AssistantManager', 'Default assistant upgrade failed after backup', {
        id: existing.id,
        builtinId: existing.builtinId,
        backupId,
      })
      return { ...upgradeResult, backupId }
    }

    this.deps.logger?.info('AssistantManager', 'Backed up and upgraded default assistant', {
      id: existing.id,
      builtinId: existing.builtinId,
      backupId,
      fromVersion: existing.builtinVersion,
      toVersion: builtin.builtinVersion,
    })
    return { success: true, backupId }
  }

  // ==================== Internal ====================

  private findByBuiltinId(builtinId: string): AssistantConfig | undefined {
    return Array.from(this.cache.values()).find((c) => c.builtinId === builtinId)
  }

  private saveToDisk(config: AssistantConfig): AssistantSaveResult {
    try {
      const filePath = this.deps.fs.joinPath(this.deps.assistantsDir, `${config.id}.md`)
      this.deps.fs.writeFile(filePath, serializeAssistant(config))
      this.cache.set(config.id, config)
      return { success: true }
    } catch (error) {
      this.deps.logger?.error('AssistantManager', `Failed to save: ${config.id}`, { error: String(error) })
      return { success: false, error: String(error) }
    }
  }
}
