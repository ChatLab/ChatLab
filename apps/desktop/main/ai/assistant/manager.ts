/**
 * Assistant manager — thin Electron adapter.
 *
 * Delegates all logic to @openchatlab/node-runtime's AssistantManager class,
 * injecting Electron-specific dependencies (paths, builtins, logger).
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import {
  AssistantManager as SharedAssistantManager,
  DEFAULT_GENERAL_ASSISTANT_RAW_CONFIGS,
  LEGACY_GENERAL_ASSISTANT_DIGESTS,
  type AssistantConfig,
  type AssistantSummary,
  type AssistantInitResult,
  type AssistantSaveResult,
  type BuiltinAssistantInfo,
  type AssistantManagerFs,
} from '@openchatlab/node-runtime'
import { getPathProvider } from '../../paths/provider'
import { aiLogger } from '../logger'

const nodeFs: AssistantManagerFs = {
  ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  },
  listFiles(dir: string, ext: string) {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter((f) => f.endsWith(ext))
  },
  readFile(filePath: string) {
    return fs.readFileSync(filePath, 'utf-8')
  },
  writeFile(filePath: string, content: string) {
    fs.writeFileSync(filePath, content, 'utf-8')
  },
  deleteFile(filePath: string) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  },
  fileExists(filePath: string) {
    return fs.existsSync(filePath)
  },
  joinPath(...parts: string[]) {
    return path.join(...parts)
  },
}

let _manager: SharedAssistantManager | null = null

export function getManager(): SharedAssistantManager {
  if (!_manager) {
    _manager = new SharedAssistantManager({
      fs: nodeFs,
      assistantsDir: path.join(getPathProvider().getAiDataDir(), 'assistants'),
      builtinRawConfigs: DEFAULT_GENERAL_ASSISTANT_RAW_CONFIGS,
      contentHash: (content) => createHash('sha256').update(content).digest('hex'),
      legacyBuiltinDigests: LEGACY_GENERAL_ASSISTANT_DIGESTS,
      logger: aiLogger,
      generateId: () => `custom_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    })
  }
  return _manager
}

// ==================== Public API (preserves existing function signatures) ====================

export function initAssistantManager(): AssistantInitResult {
  return getManager().init()
}

export function getAllAssistants(): AssistantSummary[] {
  return getManager().getAllAssistants()
}

export function getAssistantConfig(id: string): AssistantConfig | null {
  return getManager().getAssistantConfig(id)
}

export function hasAssistant(id: string): boolean {
  return getManager().hasAssistant(id)
}

export function getBuiltinCatalog(): BuiltinAssistantInfo[] {
  return getManager().getBuiltinCatalog()
}

export function importAssistant(builtinId: string): AssistantSaveResult {
  return getManager().importAssistant(builtinId)
}

export function reimportAssistant(id: string): AssistantSaveResult {
  return getManager().reimportAssistant(id)
}

export function updateAssistant(id: string, updates: Partial<AssistantConfig>): AssistantSaveResult {
  return getManager().updateAssistant(id, updates)
}

export function createAssistant(config: Omit<AssistantConfig, 'id'>): AssistantSaveResult & { id?: string } {
  return getManager().createAssistant(config)
}

export function deleteAssistant(id: string): AssistantSaveResult {
  return getManager().deleteAssistant(id)
}

export function resetAssistant(id: string): AssistantSaveResult {
  return getManager().resetAssistant(id)
}

export function importAssistantFromMd(rawMd: string): AssistantSaveResult & { id?: string } {
  return getManager().importAssistantFromMd(rawMd)
}

export function isGeneralAssistant(id: string): boolean {
  return getManager().isGeneralAssistant(id)
}
