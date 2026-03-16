/**
 * 助手管理器
 * 负责助手配置的加载、CRUD 和内置助手导入
 *
 * 存储策略（导入模型）：
 * - 内置助手作为模板目录打包在 BUILTIN_CONFIGS 中（.md 原始字符串，编译时内联）
 * - 启动时仅自动导入 general 助手
 * - 用户通过"助手市场"主动导入其他内置助手
 * - 导入后完全属于用户，可自由编辑/删除（general 除外）
 * - 用户可手动重新导入以恢复为最新模板
 *
 * 文件格式：Markdown（YAML frontmatter + Markdown body）
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { getAiDataDir, ensureDir } from '../../paths'
import { aiLogger } from '../logger'
import { parseAssistantFile, serializeAssistant } from './parser'
import type {
  AssistantConfig,
  AssistantSummary,
  AssistantInitResult,
  AssistantSaveResult,
  BuiltinAssistantInfo,
} from './types'

// ==================== 内置助手模板（仅 General，各语言一份） ====================

import builtinGeneralZhRaw from './builtins/general_cn.md?raw'
import builtinGeneralEnRaw from './builtins/general_en.md?raw'
import builtinGeneralJaRaw from './builtins/general_ja.md?raw'

const BUILTIN_RAW: { id: string; content: string }[] = [
  { id: 'general_cn', content: builtinGeneralZhRaw },
  { id: 'general_en', content: builtinGeneralEnRaw },
  { id: 'general_ja', content: builtinGeneralJaRaw },
]

const builtinConfigCache: Map<string, AssistantConfig> = new Map()

function getBuiltinConfigs(): AssistantConfig[] {
  if (builtinConfigCache.size === 0) {
    for (const { id, content } of BUILTIN_RAW) {
      const config = parseAssistantFile(content, `${id}.md`)
      if (config) builtinConfigCache.set(config.id, config)
    }
  }
  return Array.from(builtinConfigCache.values())
}

function getBuiltinConfig(id: string): AssistantConfig | undefined {
  getBuiltinConfigs()
  return builtinConfigCache.get(id)
}

const ASSISTANTS_DIR_NAME = 'assistants'

const cachedAssistants: Map<string, AssistantConfig> = new Map()
let initialized = false

function getAssistantsDir(): string {
  return path.join(getAiDataDir(), ASSISTANTS_DIR_NAME)
}

// ==================== 初始化 ====================

/** 所有 general 助手 id（各语言一份，启动时自动确保存在） */
const GENERAL_IDS = ['general_cn', 'general_en', 'general_ja']

/**
 * 初始化助手管理器
 * - 确保目录存在
 * - 确保各语言 general 助手已导入
 * - 加载所有用户助手配置
 */
export function initAssistantManager(): AssistantInitResult {
  const assistantsDir = getAssistantsDir()
  ensureDir(assistantsDir)

  const generalCreated = ensureGeneralAssistants()
  loadAllAssistants()

  initialized = true
  aiLogger.info('AssistantManager', 'Initialized', {
    total: cachedAssistants.size,
    generalCreated,
  })

  return { total: cachedAssistants.size, generalCreated }
}

/**
 * 确保各语言 general 助手存在于用户目录（首次启动自动导入）
 */
function ensureGeneralAssistants(): boolean {
  let anyCreated = false
  for (const id of GENERAL_IDS) {
    const config = getBuiltinConfig(id)
    if (!config) continue

    const userFilePath = path.join(getAssistantsDir(), `${id}.md`)
    if (fs.existsSync(userFilePath)) continue

    const configToWrite: AssistantConfig = {
      ...config,
      builtinId: config.id,
    }
    writeAssistantFile(userFilePath, configToWrite)
    anyCreated = true
  }
  return anyCreated
}

/**
 * 从用户目录加载所有助手配置到内存缓存
 */
function loadAllAssistants(): void {
  cachedAssistants.clear()

  const assistantsDir = getAssistantsDir()
  if (!fs.existsSync(assistantsDir)) return

  const files = fs.readdirSync(assistantsDir).filter((f) => f.endsWith('.md'))

  for (const file of files) {
    try {
      const filePath = path.join(assistantsDir, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      const config = parseAssistantFile(content, filePath)
      if (config) {
        cachedAssistants.set(config.id, config)
      } else {
        aiLogger.warn('AssistantManager', `Failed to parse assistant: ${file}`)
      }
    } catch (error) {
      aiLogger.warn('AssistantManager', `Failed to load assistant: ${file}`, { error: String(error) })
    }
  }
}

// ==================== 查询 API ====================

/**
 * 获取所有已导入助手的摘要列表（用于前端展示）
 */
export function getAllAssistants(): AssistantSummary[] {
  ensureInitialized()

  return Array.from(cachedAssistants.values())
    .sort((a, b) => a.name.localeCompare(b.name))
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
 * 获取内置助手模板目录
 * 云端市场上线后，本地内置仅保留 general 系列，市场数据来自云端
 */
export function getBuiltinCatalog(): BuiltinAssistantInfo[] {
  ensureInitialized()
  return []
}

/**
 * 从内置模板导入助手到用户目录
 * - 同一 builtinId 不可重复导入
 */
export function importAssistant(builtinId: string): AssistantSaveResult {
  ensureInitialized()

  const builtinConfig = getBuiltinConfig(builtinId)
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

  const builtinConfig = getBuiltinConfig(existing.builtinId)
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
export function createAssistant(config: Omit<AssistantConfig, 'id'>): AssistantSaveResult & { id?: string } {
  ensureInitialized()

  const id = `custom_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const newConfig: AssistantConfig = {
    ...config,
    id,
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

  if (GENERAL_IDS.includes(id)) {
    return { success: false, error: 'Cannot delete the default assistant (general)' }
  }

  const existing = cachedAssistants.get(id)
  if (!existing) {
    return { success: false, error: `Assistant not found: ${id}` }
  }

  try {
    const filePath = path.join(getAssistantsDir(), `${id}.md`)
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

  const builtinConfig = getBuiltinConfig(existing.builtinId)
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

// ==================== 云端导入 ====================

/**
 * 从原始 Markdown 导入助手（云端市场用）
 * 与 importAssistant 类似，但接受原始 .md 内容而非 builtinId
 */
export function importAssistantFromMd(rawMd: string): AssistantSaveResult & { id?: string } {
  ensureInitialized()

  const config = parseAssistantFile(rawMd, 'cloud_import.md')
  if (!config) {
    return { success: false, error: 'Failed to parse assistant markdown' }
  }

  if (cachedAssistants.has(config.id)) {
    return { success: false, error: `Assistant already exists: ${config.id}` }
  }

  const result = saveAssistantToDisk(config)
  return { ...result, id: result.success ? config.id : undefined }
}

/**
 * 检查 id 是否为 general 系列助手
 */
export function isGeneralAssistant(id: string): boolean {
  return GENERAL_IDS.includes(id)
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
    builtinId: config.builtinId,
    applicableChatTypes: config.applicableChatTypes,
    supportedLocales: config.supportedLocales,
  }
}

function saveAssistantToDisk(config: AssistantConfig): AssistantSaveResult {
  try {
    const filePath = path.join(getAssistantsDir(), `${config.id}.md`)
    writeAssistantFile(filePath, config)
    cachedAssistants.set(config.id, config)
    return { success: true }
  } catch (error) {
    aiLogger.error('AssistantManager', `Failed to save assistant: ${config.id}`, { error: String(error) })
    return { success: false, error: String(error) }
  }
}

function writeAssistantFile(filePath: string, config: AssistantConfig): void {
  fs.writeFileSync(filePath, serializeAssistant(config), 'utf-8')
}
