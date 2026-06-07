/**
 * 助手 MD 文件解析器（平台无关，Node.js 实现）
 */

import * as path from 'path'
import matter from 'gray-matter'
import { normalizeBuiltinToolNames } from '@openchatlab/core'
import type { AssistantConfig } from './types'

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
      allowedBuiltinTools: normalizeBuiltinToolNames(parseStringArray(fm.allowedBuiltinTools)),
      builtinId: typeof fm.builtinId === 'string' ? fm.builtinId : undefined,
      applicableChatTypes: parseChatTypes(fm.applicableChatTypes),
      supportedLocales: parseStringArray(fm.supportedLocales),
    }
  } catch {
    return null
  }
}

export function serializeAssistant(config: AssistantConfig): string {
  const fm: Record<string, unknown> = {
    id: config.id,
    name: config.name,
  }

  if (config.builtinId) fm.builtinId = config.builtinId
  if (config.applicableChatTypes?.length) fm.applicableChatTypes = config.applicableChatTypes
  if (config.supportedLocales?.length) fm.supportedLocales = config.supportedLocales
  if (config.allowedBuiltinTools?.length) fm.allowedBuiltinTools = normalizeBuiltinToolNames(config.allowedBuiltinTools)
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
