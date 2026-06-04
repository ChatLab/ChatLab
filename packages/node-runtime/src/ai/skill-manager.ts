/**
 * 技能管理器（平台无关）
 *
 * 从 aiDataDir/skills/*.md 加载技能定义，
 * 提供查询和 AI 自选菜单构建。
 */

import * as fs from 'fs'
import * as path from 'path'
import { SkillManagerCore, type SkillInitResult, type SkillManagerFs } from './skill-manager-core'
import type { SkillDef, SkillSummary } from './types'

const SKILLS_DIR_NAME = 'skills'

export interface SkillManagerLogger {
  info(message: string, extra?: Record<string, unknown>): void
  warn(message: string, extra?: Record<string, unknown>): void
}

const defaultLogger: SkillManagerLogger = {
  info: () => {},
  warn: () => {},
}

const nodeFs: SkillManagerFs = {
  ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true })
  },
  listFiles(dir, ext) {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter((file) => file.endsWith(ext))
  },
  readFile(filePath) {
    return fs.readFileSync(filePath, 'utf-8')
  },
  writeFile(filePath, content) {
    fs.writeFileSync(filePath, content, 'utf-8')
  },
  deleteFile(filePath) {
    fs.unlinkSync(filePath)
  },
  fileExists(filePath) {
    return fs.existsSync(filePath)
  },
  joinPath(...parts) {
    return path.join(...parts)
  },
}

export class SkillManager {
  private core: SkillManagerCore
  private logger: SkillManagerLogger

  constructor(aiDataDir: string, logger?: SkillManagerLogger) {
    this.logger = logger ?? defaultLogger
    this.core = new SkillManagerCore({
      fs: nodeFs,
      skillsDir: path.join(aiDataDir, SKILLS_DIR_NAME),
      builtinRawSkills: [],
      logger: {
        info: () => {},
        warn: (_category, message, data) => this.logger.warn(message, toLoggerExtra(data)),
        error: (_category, message, data) => this.logger.warn(message, toLoggerExtra(data)),
      },
    })
  }

  init(): SkillInitResult {
    const result = this.core.init()
    this.logger.info(`SkillManager initialized: ${result.total} skills`)
    return result
  }

  getSkillConfig(id: string): SkillDef | null {
    return this.core.getSkillConfig(id)
  }

  getAllSkills(): SkillSummary[] {
    return this.core.getAllSkills()
  }

  /**
   * 构建 AI 自选技能菜单文本
   * 只包含与当前 chatType + 助手工具权限兼容的技能
   */
  getSkillMenu(chatType: 'group' | 'private', allowedTools?: string[]): string | null {
    return this.core.getSkillMenu(chatType, allowedTools)
  }
}

function toLoggerExtra(data: unknown): Record<string, unknown> | undefined {
  if (data === undefined) return undefined
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>
  return { data }
}
