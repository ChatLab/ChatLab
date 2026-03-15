/**
 * 助手管理器
 * 负责助手配置的加载、CRUD 和内置助手导入
 *
 * 存储策略（导入模型）：
 * - 内置助手作为模板目录打包在 BUILTIN_CONFIGS 中
 * - 启动时仅自动导入 general 助手
 * - 用户通过"助手市场"主动导入其他内置助手
 * - 导入后完全属于用户，可自由编辑/删除（general 除外）
 * - 市场可查看内置助手是否有新版本，用户可手动重新导入
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { getAiDataDir, ensureDir } from '../../paths'
import { aiLogger } from '../logger'
import type {
  AssistantConfig,
  AssistantSummary,
  AssistantInitResult,
  AssistantSaveResult,
  BuiltinAssistantInfo,
} from './types'

import builtinGeneral from './builtins/general.json'
import builtinCommunityAnalyst from './builtins/community_analyst.json'
import builtinEmotionAnalyst from './builtins/emotion_analyst.json'
import builtinCustomerService from './builtins/customer_service.json'

const BUILTIN_CONFIGS: AssistantConfig[] = [
  builtinGeneral as AssistantConfig,
  builtinCommunityAnalyst as AssistantConfig,
  builtinEmotionAnalyst as AssistantConfig,
  builtinCustomerService as AssistantConfig,
]

const ASSISTANTS_DIR_NAME = 'assistants'

const cachedAssistants: Map<string, AssistantConfig> = new Map()
let initialized = false

function getAssistantsDir(): string {
  return path.join(getAiDataDir(), ASSISTANTS_DIR_NAME)
}

// ==================== 初始化 ====================

/**
 * 初始化助手管理器
 * - 确保目录存在
 * - 确保 general 助手已导入
 * - 加载所有用户助手配置
 */
export function initAssistantManager(): AssistantInitResult {
  const assistantsDir = getAssistantsDir()
  ensureDir(assistantsDir)

  const generalCreated = ensureGeneralAssistant()
  loadAllAssistants()

  initialized = true
  aiLogger.info('AssistantManager', 'Initialized', {
    total: cachedAssistants.size,
    generalCreated,
  })

  return { total: cachedAssistants.size, generalCreated }
}

/**
 * 确保 general 助手存在于用户目录（首次启动自动导入）
 */
function ensureGeneralAssistant(): boolean {
  const generalConfig = BUILTIN_CONFIGS.find((c) => c.id === 'general')
  if (!generalConfig) return false

  const userFilePath = path.join(getAssistantsDir(), 'general.json')
  if (fs.existsSync(userFilePath)) return false

  const configToWrite: AssistantConfig = {
    ...generalConfig,
    builtinId: generalConfig.id,
  }
  writeJsonFile(userFilePath, configToWrite)
  return true
}

/**
 * 从用户目录加载所有助手配置到内存缓存
 */
function loadAllAssistants(): void {
  cachedAssistants.clear()

  const assistantsDir = getAssistantsDir()
  if (!fs.existsSync(assistantsDir)) return

  const files = fs.readdirSync(assistantsDir).filter((f) => f.endsWith('.json'))

  for (const file of files) {
    try {
      const raw = readJsonFile<AssistantConfig & { responseRules?: string }>(path.join(assistantsDir, file))
      if (raw && raw.id) {
        const config = migrateResponseRules(raw, path.join(assistantsDir, file))
        cachedAssistants.set(config.id, config)
      }
    } catch (error) {
      aiLogger.warn('AssistantManager', `Failed to load assistant: ${file}`, { error: String(error) })
    }
  }
}

/**
 * 迁移旧数据：将 responseRules 合并到 systemPrompt，删除旧字段并持久化
 */
function migrateResponseRules(raw: AssistantConfig & { responseRules?: string }, filePath: string): AssistantConfig {
  if (!raw.responseRules) return raw as AssistantConfig

  const merged: AssistantConfig = {
    ...raw,
    systemPrompt: `${raw.systemPrompt}\n\n## 回答要求\n${raw.responseRules}`,
  }
  delete (merged as Record<string, unknown>).responseRules

  try {
    writeJsonFile(filePath, merged)
    aiLogger.info('AssistantManager', `Migrated responseRules for assistant: ${raw.id}`)
  } catch (error) {
    aiLogger.warn('AssistantManager', `Failed to persist migration for: ${raw.id}`, { error: String(error) })
  }

  return merged
}

// ==================== 查询 API ====================

/**
 * 获取所有已导入助手的摘要列表（用于前端展示）
 */
export function getAllAssistants(): AssistantSummary[] {
  ensureInitialized()

  return Array.from(cachedAssistants.values())
    .sort((a, b) => {
      const orderDiff = (a.order ?? 100) - (b.order ?? 100)
      if (orderDiff !== 0) return orderDiff
      return a.name.localeCompare(b.name)
    })
    .map(toSummary)
}

/**
 * 获取单个助手的完整配置
 */
export function getAssistantConfig(id: string): AssistantConfig | null {
  ensureInitialized()
  return cachedAssistants.get(id) ?? null
}

/**
 * 检查助手是否存在
 */
export function hasAssistant(id: string): boolean {
  ensureInitialized()
  return cachedAssistants.has(id)
}

// ==================== 内置助手目录（市场） ====================

/**
 * 获取内置助手模板目录（用于助手市场展示）
 * 对每个内置助手检查用户是否已导入、是否有版本更新
 */
export function getBuiltinCatalog(): BuiltinAssistantInfo[] {
  ensureInitialized()

  return BUILTIN_CONFIGS.map((builtin) => {
    const userAssistant = findImportedByBuiltinId(builtin.id)
    const imported = !!userAssistant
    const hasUpdate = imported && builtin.version > (userAssistant!.version || 0)

    return {
      id: builtin.id,
      name: builtin.name,
      systemPrompt: builtin.systemPrompt,
      version: builtin.version,
      order: builtin.order,
      applicableChatTypes: builtin.applicableChatTypes,
      supportedLocales: builtin.supportedLocales,
      imported,
      hasUpdate,
    }
  })
}

/**
 * 从内置模板导入助手到用户目录
 * - 同一 builtinId 不可重复导入
 */
export function importAssistant(builtinId: string): AssistantSaveResult {
  ensureInitialized()

  const builtinConfig = BUILTIN_CONFIGS.find((c) => c.id === builtinId)
  if (!builtinConfig) {
    return { success: false, error: `Builtin assistant not found: ${builtinId}` }
  }

  const existing = findImportedByBuiltinId(builtinId)
  if (existing) {
    return { success: false, error: `Assistant already imported: ${builtinId}` }
  }

  const newConfig: AssistantConfig = {
    ...builtinConfig,
    builtinId: builtinConfig.id,
  }

  return saveAssistantToDisk(newConfig)
}

/**
 * 重新导入内置助手（覆盖用户副本为最新模板版本，保留 id）
 */
export function reimportAssistant(id: string): AssistantSaveResult {
  ensureInitialized()

  const existing = cachedAssistants.get(id)
  if (!existing) {
    return { success: false, error: `Assistant not found: ${id}` }
  }
  if (!existing.builtinId) {
    return { success: false, error: 'Only imported builtin assistants can be reimported' }
  }

  const builtinConfig = BUILTIN_CONFIGS.find((c) => c.id === existing.builtinId)
  if (!builtinConfig) {
    return { success: false, error: `Builtin template not found: ${existing.builtinId}` }
  }

  const updatedConfig: AssistantConfig = {
    ...builtinConfig,
    id: existing.id,
    builtinId: existing.builtinId,
  }

  return saveAssistantToDisk(updatedConfig)
}

// ==================== 修改 API ====================

/**
 * 更新助手配置（用于配置弹窗保存）
 */
export function updateAssistant(id: string, updates: Partial<AssistantConfig>): AssistantSaveResult {
  ensureInitialized()

  const existing = cachedAssistants.get(id)
  if (!existing) {
    return { success: false, error: `Assistant not found: ${id}` }
  }

  const updated: AssistantConfig = {
    ...existing,
    ...updates,
    id,
  }

  return saveAssistantToDisk(updated)
}

/**
 * 创建自定义助手
 */
export function createAssistant(
  config: Omit<AssistantConfig, 'id' | 'version'>
): AssistantSaveResult & { id?: string } {
  ensureInitialized()

  const id = `custom_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const newConfig: AssistantConfig = {
    ...config,
    id,
    version: 1,
    builtinId: undefined,
  }

  const result = saveAssistantToDisk(newConfig)
  return { ...result, id: result.success ? id : undefined }
}

/**
 * 删除助手
 * general 助手不可删除，其他导入的内置助手可以删除
 */
export function deleteAssistant(id: string): AssistantSaveResult {
  ensureInitialized()

  if (id === 'general') {
    return { success: false, error: 'Cannot delete the default assistant (general)' }
  }

  const existing = cachedAssistants.get(id)
  if (!existing) {
    return { success: false, error: `Assistant not found: ${id}` }
  }

  try {
    const filePath = path.join(getAssistantsDir(), `${id}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    cachedAssistants.delete(id)
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

/**
 * 重置内置助手为出厂默认
 */
export function resetAssistant(id: string): AssistantSaveResult {
  ensureInitialized()

  const existing = cachedAssistants.get(id)
  if (!existing?.builtinId) {
    return { success: false, error: 'Only builtin assistants can be reset' }
  }

  const builtinConfig = BUILTIN_CONFIGS.find((c) => c.id === existing.builtinId)
  if (!builtinConfig) {
    return { success: false, error: `Builtin config not found: ${existing.builtinId}` }
  }

  const resetConfig: AssistantConfig = {
    ...builtinConfig,
    id: existing.id,
    builtinId: existing.builtinId,
  }

  return saveAssistantToDisk(resetConfig)
}

// ==================== 内部工具函数 ====================

function ensureInitialized(): void {
  if (!initialized) {
    initAssistantManager()
  }
}

function findImportedByBuiltinId(builtinId: string): AssistantConfig | undefined {
  return Array.from(cachedAssistants.values()).find((c) => c.builtinId === builtinId)
}

function toSummary(config: AssistantConfig): AssistantSummary {
  return {
    id: config.id,
    name: config.name,
    systemPrompt: config.systemPrompt,
    presetQuestions: config.presetQuestions,
    order: config.order,
    builtinId: config.builtinId,
    applicableChatTypes: config.applicableChatTypes,
    supportedLocales: config.supportedLocales,
  }
}

function saveAssistantToDisk(config: AssistantConfig): AssistantSaveResult {
  try {
    const filePath = path.join(getAssistantsDir(), `${config.id}.json`)
    writeJsonFile(filePath, config)
    cachedAssistants.set(config.id, config)
    return { success: true }
  } catch (error) {
    aiLogger.error('AssistantManager', `Failed to save assistant: ${config.id}`, { error: String(error) })
    return { success: false, error: String(error) }
  }
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}
