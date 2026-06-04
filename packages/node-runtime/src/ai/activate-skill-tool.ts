/**
 * activate_skill 元工具（AI 自选模式专用）
 *
 * LLM 判断用户问题适合某个技能时调用此工具，获取技能的完整执行指导。
 * 平台无关 — 通过 getter 函数获取技能定义。
 */

import type { SkillDef } from './types'

export interface ActivateSkillToolResult {
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
}

export interface ActivateSkillToolOptions {
  chatType: 'group' | 'private'
  allowedTools?: string[]
  coreToolNames?: Set<string>
  locale?: string
  getSkillConfig: (id: string) => SkillDef | null
}

export interface ActivateSkillTool {
  name: string
  label: string
  description: string
  parameters: Record<string, unknown>
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown
  ) => Promise<ActivateSkillToolResult>
}

export function createActivateSkillTool(options: ActivateSkillToolOptions): ActivateSkillTool {
  const { chatType, allowedTools, coreToolNames, getSkillConfig, locale = 'zh-CN' } = options
  const isZh = locale.startsWith('zh')

  return {
    name: 'activate_skill',
    label: 'activate_skill',
    description: isZh
      ? '激活一个分析技能，获取该技能的详细执行指导'
      : 'Activate an analysis skill and get its detailed execution instructions',
    parameters: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          description: isZh ? '技能 ID' : 'Skill ID',
        },
      },
      required: ['skill_id'],
    },
    execute: async (_toolCallId: string, params: unknown) => {
      const toolParams = (params && typeof params === 'object' ? params : {}) as { skill_id?: string }
      const skillId = toolParams.skill_id || ''
      const skill: SkillDef | null = getSkillConfig(skillId)
      if (!skill) {
        return {
          content: [{ type: 'text' as const, text: isZh ? '技能不存在' : 'Skill not found' }],
          details: { skillId, found: false },
        }
      }

      if (skill.chatScope !== 'all' && skill.chatScope !== chatType) {
        const scopeMsg = isZh
          ? `该技能仅适用于${skill.chatScope === 'group' ? '群聊' : '私聊'}场景`
          : `This skill is only applicable to ${skill.chatScope === 'group' ? 'group chat' : 'private chat'} scenarios`
        return {
          content: [{ type: 'text' as const, text: scopeMsg }],
          details: { skillId, found: true, applicable: false },
        }
      }

      if (skill.tools.length > 0 && allowedTools !== undefined) {
        const missing = skill.tools.filter((t) => !(coreToolNames?.has(t) ?? false) && !allowedTools.includes(t))
        if (missing.length > 0) {
          const msg = isZh
            ? `当前助手缺少该技能所需的工具：${missing.join(', ')}`
            : `Current assistant lacks tools required by this skill: ${missing.join(', ')}`
          return {
            content: [{ type: 'text' as const, text: msg }],
            details: { skillId, found: true, applicable: false, missingTools: missing },
          }
        }
      }

      const actionPrompt = isZh
        ? '\n\n[System]: 你已成功加载该技能手册。现在，请立即、自动地开始执行步骤1，调用相关的基础数据工具，不要等待用户的进一步确认！'
        : '\n\n[System]: You have successfully loaded this skill manual. Now, immediately start executing step 1 by calling the relevant data tools. Do not wait for further user confirmation!'

      return {
        content: [{ type: 'text' as const, text: `${skill.prompt}${actionPrompt}` }],
        details: { skillId, found: true, applicable: true },
      }
    },
  }
}
