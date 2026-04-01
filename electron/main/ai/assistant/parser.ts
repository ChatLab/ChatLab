/**
 * 助手文件解析器 & 序列化器
 * 将 Markdown + YAML Frontmatter 格式的 .md 文件与 AssistantConfig 互相转换
 */

import * as path from 'path'
import matter from 'gray-matter'
import type { AssistantConfig } from './types'

/**
 * 解析助手 Markdown 文件内容为 AssistantConfig
 *
 * 解析失败时返回 null（不抛异常），调用方负责处理。
 * 单文件解析失败不能影响整个 AssistantManager 初始化。
 */
export function parseAssistantFile(content: string, filePath: string): AssistantConfig | null {
  try {
    const { data: fm, content: body } = matter(content)

    const id = fm.id ?? path.basename(filePath, '.md')
    const name = fm.name
    if (!name) return null

    return {
      id,
      name,
      systemPrompt: body.trim(),
      presetQuestions: parseStringArray(fm.presetQuestions),
      allowedBuiltinTools: parseStringArray(fm.allowedBuiltinTools),
      builtinId: typeof fm.builtinId === 'string' ? fm.builtinId : undefined,
      applicableChatTypes: parseChatTypes(fm.applicableChatTypes),
      supportedLocales: parseStringArray(fm.supportedLocales),
    }
  } catch {
    return null
  }
}

/**
 * 将 AssistantConfig 序列化为 Markdown 文件内容（YAML frontmatter + body）
 *
 * frontmatter 中省略空数组和 undefined 值以保持简洁。
 */
export function serializeAssistant(config: AssistantConfig): string {
  const fm: Record<string, unknown> = {
    id: config.id,
    name: config.name,
  }

  if (config.builtinId) fm.builtinId = config.builtinId
  if (config.applicableChatTypes?.length) fm.applicableChatTypes = config.applicableChatTypes
  if (config.supportedLocales?.length) fm.supportedLocales = config.supportedLocales
  if (config.allowedBuiltinTools?.length) fm.allowedBuiltinTools = config.allowedBuiltinTools
  if (config.presetQuestions?.length) fm.presetQuestions = config.presetQuestions

  return matter.stringify(`\n${config.systemPrompt}\n`, fm)
}

function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  return []
}

function parseChatTypes(raw: unknown): ('group' | 'private')[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const valid = raw.filter((v): v is 'group' | 'private' => v === 'group' || v === 'private')
  return valid.length > 0 ? valid : undefined
}
