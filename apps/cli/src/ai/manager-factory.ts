/**
 * Factory functions for creating AssistantManager and SkillManagerCore instances.
 *
 * Server-side equivalent of the Electron adapter in electron/main/ai/assistant/manager.ts.
 * Uses Node.js fs directly (no Electron dependency).
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import {
  appLogger,
  AssistantManager,
  DEFAULT_GENERAL_ASSISTANT_RAW_CONFIGS,
  LEGACY_GENERAL_ASSISTANT_DIGESTS,
  SkillManagerCore,
  type AssistantManagerFs,
  type SkillManagerFs,
} from '@openchatlab/node-runtime'

const nodeFs: AssistantManagerFs & SkillManagerFs = {
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

const managerCache = new Map<string, { assistant: AssistantManager; skill: SkillManagerCore }>()

export function getAssistantManager(aiDataDir: string): AssistantManager {
  let cached = managerCache.get(aiDataDir)
  if (!cached) {
    cached = {
      assistant: new AssistantManager({
        fs: nodeFs,
        assistantsDir: path.join(aiDataDir, 'assistants'),
        builtinRawConfigs: DEFAULT_GENERAL_ASSISTANT_RAW_CONFIGS,
        contentHash: (content: string) => createHash('sha256').update(content).digest('hex'),
        legacyBuiltinDigests: LEGACY_GENERAL_ASSISTANT_DIGESTS,
        generateId: () => `custom_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        logger: appLogger,
      }),
      skill: new SkillManagerCore({
        fs: nodeFs,
        skillsDir: path.join(aiDataDir, 'skills'),
        builtinRawSkills: [],
        contentHash: (content: string) => createHash('md5').update(content).digest('hex'),
      }),
    }
    managerCache.set(aiDataDir, cached)
  }
  return cached.assistant
}

export function getSkillManagerCore(aiDataDir: string): SkillManagerCore {
  let cached = managerCache.get(aiDataDir)
  if (!cached) {
    getAssistantManager(aiDataDir)
    cached = managerCache.get(aiDataDir)!
  }
  return cached.skill
}
