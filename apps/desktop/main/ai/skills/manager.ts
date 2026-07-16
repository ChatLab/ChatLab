/**
 * Skill manager — thin Electron adapter.
 *
 * Delegates all logic to @openchatlab/node-runtime's SkillManagerCore class,
 * injecting Electron-specific dependencies (paths, builtins, logger).
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { SkillManagerCore, type SkillManagerFs } from '@openchatlab/node-runtime'
import { getPathProvider } from '../../paths/provider'
import { aiLogger } from '../logger'
import type { SkillDef, SkillSummary, SkillInitResult, SkillSaveResult, BuiltinSkillInfo } from './types'

const nodeFs: SkillManagerFs = {
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

let _manager: SkillManagerCore | null = null

export function getManager(): SkillManagerCore {
  if (!_manager) {
    _manager = new SkillManagerCore({
      fs: nodeFs,
      skillsDir: path.join(getPathProvider().getAiDataDir(), 'skills'),
      builtinRawSkills: [],
      contentHash: (content: string) => createHash('md5').update(content).digest('hex'),
      logger: aiLogger,
    })
  }
  return _manager
}

// ==================== Public API (preserves existing function signatures) ====================

export function initSkillManager(): SkillInitResult {
  return getManager().init()
}

export function getAllSkills(): SkillSummary[] {
  return getManager().getAllSkills()
}

export function getSkillConfig(id: string): SkillDef | null {
  return getManager().getSkillConfig(id)
}

export function getBuiltinCatalog(): BuiltinSkillInfo[] {
  return getManager().getBuiltinCatalog()
}

export function importSkill(builtinId: string): SkillSaveResult & { id?: string } {
  return getManager().importSkill(builtinId)
}

export function reimportSkill(id: string): SkillSaveResult {
  return getManager().reimportSkill(id)
}

export function updateSkill(id: string, rawMd: string): SkillSaveResult {
  return getManager().updateSkill(id, rawMd)
}

export function createSkill(rawMd: string): SkillSaveResult & { id?: string } {
  return getManager().createSkill(rawMd)
}

export function deleteSkill(id: string): SkillSaveResult {
  return getManager().deleteSkill(id)
}

export function importSkillFromMd(rawMd: string): SkillSaveResult & { id?: string } {
  return getManager().importSkillFromMd(rawMd)
}

export function getSkillMenu(chatType: 'group' | 'private', allowedTools?: string[]): string | null {
  return getManager().getSkillMenu(chatType, allowedTools)
}
