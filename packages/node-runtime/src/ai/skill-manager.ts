/**
 * 技能管理器（平台无关）
 *
 * 从 aiDataDir/skills/*.md 加载技能定义，
 * 提供查询和 AI 自选菜单构建。
 */

import * as fs from 'fs'
import * as path from 'path'
import { parseSkillFile } from './skill-parser'
import type { SkillDef, SkillSummary } from './types'

const SKILLS_DIR_NAME = 'skills'
const MAX_SKILL_MENU_ITEMS = 15

export interface SkillManagerLogger {
  info(message: string, extra?: Record<string, unknown>): void
  warn(message: string, extra?: Record<string, unknown>): void
}

const defaultLogger: SkillManagerLogger = {
  info: () => {},
  warn: () => {},
}

export class SkillManager {
  private skills = new Map<string, SkillDef>()
  private initialized = false
  private skillsDir: string
  private logger: SkillManagerLogger

  constructor(aiDataDir: string, logger?: SkillManagerLogger) {
    this.skillsDir = path.join(aiDataDir, SKILLS_DIR_NAME)
    this.logger = logger ?? defaultLogger
  }

  init(): { total: number } {
    this.loadAll()
    this.initialized = true
    this.logger.info(`SkillManager initialized: ${this.skills.size} skills`)
    return { total: this.skills.size }
  }

  getSkillConfig(id: string): SkillDef | null {
    this.ensureInitialized()
    return this.skills.get(id) ?? null
  }

  getAllSkills(): SkillSummary[] {
    this.ensureInitialized()
    return Array.from(this.skills.values()).map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      tags: def.tags,
      chatScope: def.chatScope,
      tools: def.tools,
      builtinId: def.builtinId,
    }))
  }

  /**
   * 构建 AI 自选技能菜单文本
   * 只包含与当前 chatType + 助手工具权限兼容的技能
   */
  getSkillMenu(chatType: 'group' | 'private', allowedTools?: string[]): string | null {
    this.ensureInitialized()

    const compatible = Array.from(this.skills.values()).filter((skill) => {
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

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.init()
    }
  }

  private loadAll(): void {
    this.skills.clear()
    if (!fs.existsSync(this.skillsDir)) return

    const files = fs.readdirSync(this.skillsDir).filter((f) => f.endsWith('.md'))
    for (const file of files) {
      try {
        const filePath = path.join(this.skillsDir, file)
        const content = fs.readFileSync(filePath, 'utf-8')
        const def = parseSkillFile(content, filePath)
        if (def) {
          this.skills.set(def.id, def)
        }
      } catch (error) {
        this.logger.warn(`Failed to load skill: ${file}`, { error: String(error) })
      }
    }
  }
}
