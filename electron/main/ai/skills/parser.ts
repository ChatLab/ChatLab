/**
 * 技能文件解析器
 * 将 Markdown + YAML Frontmatter 格式的 .md 文件解析为 SkillDef
 */

import * as path from 'path'
import matter from 'gray-matter'
import type { SkillDef } from './types'

/**
 * 解析技能 Markdown 文件内容为 SkillDef
 *
 * 解析失败时返回 null（不抛异常），调用方负责处理。
 * 单文件解析失败不能影响整个 SkillManager 初始化。
 */
export function parseSkillFile(content: string, filePath: string): SkillDef | null {
  try {
    const { data: fm, content: prompt } = matter(content)

    const id = fm.id ?? path.basename(filePath, '.md')
    const name = fm.name
    if (!name) {
      return null
    }

    return {
      id,
      name,
      description: fm.description ?? '',
      tags: parseTags(fm.tags),
      chatScope: validateChatScope(fm.chatScope),
      tools: Array.isArray(fm.tools) ? fm.tools : [],
      prompt: prompt.trim(),
    }
  } catch {
    return null
  }
}

/**
 * 将技能 Markdown 原始内容的 frontmatter 中提取 id（轻量级，不做完整解析）
 */
export function extractSkillId(content: string, filePath: string): string | null {
  try {
    const { data: fm } = matter(content)
    return fm.id ?? path.basename(filePath, '.md')
  } catch {
    return null
  }
}

function parseTags(raw: unknown): string[] {
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  }
  if (Array.isArray(raw)) {
    return raw.map(String).filter(Boolean)
  }
  return []
}

function validateChatScope(raw: unknown): 'all' | 'group' | 'private' {
  if (raw === 'group' || raw === 'private') return raw
  return 'all'
}
