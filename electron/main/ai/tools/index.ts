/**
 * AI Tools 模块入口
 * 工具创建、预处理管道与管理
 *
 * 架构：工具返回结构化数据（rawMessages） → 处理层执行预处理 + 格式化 → 生成 LLM 内容
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext, TruncationStrategy } from './types'
import { TOOL_REGISTRY } from './definitions'

const CORE_TOOL_NAMES = new Set(TOOL_REGISTRY.filter((e) => e.category === 'core').map((e) => e.name))
import { t as i18nT } from '../../i18n'
import { preprocessMessages, type PreprocessableMessage } from '../preprocessor'
import { formatMessageCompact } from './utils/format'
import { countTokens } from '../tokenizer'
import { getSkillConfig } from '../skills'
import type { SkillDef } from '../skills/types'

const TRUNCATION_STRATEGY_MAP = new Map<string, TruncationStrategy>(
  TOOL_REGISTRY.filter((e) => e.truncationStrategy).map((e) => [e.name, e.truncationStrategy!])
)

// 导出类型
export * from './types'

/**
 * 将工具返回的结构化数据格式化为 LLM 友好的纯文本
 *
 * 从 JSON.stringify 改为纯文本，节省 token 且更易于 LLM 理解。
 * 元数据作为头部，消息逐行排列。
 */
function formatToolResultAsText(details: Record<string, unknown>): string {
  const lines: string[] = []
  const messages = details.messages as string[] | undefined

  for (const [key, value] of Object.entries(details)) {
    if (key === 'messages') continue
    if (value === undefined || value === null) continue

    if (typeof value === 'object') {
      if ('start' in (value as Record<string, unknown>) && 'end' in (value as Record<string, unknown>)) {
        const range = value as { start: string; end: string }
        lines.push(`${key}: ${range.start} ~ ${range.end}`)
      } else if (Array.isArray(value)) {
        lines.push(`${key}: ${value.join(', ')}`)
      } else {
        lines.push(`${key}: ${JSON.stringify(value)}`)
      }
    } else {
      lines.push(`${key}: ${value}`)
    }
  }

  if (messages && messages.length > 0) {
    lines.push('')
    let lastDate = ''
    for (const msg of messages) {
      const spaceIdx = msg.indexOf(' ')
      const secondSpaceIdx = msg.indexOf(' ', spaceIdx + 1)
      if (spaceIdx > 0 && secondSpaceIdx > 0) {
        const date = msg.slice(0, spaceIdx)
        const rest = msg.slice(spaceIdx + 1)
        if (date !== lastDate) {
          lines.push(`--- ${date} ---`)
          lastDate = date
        }
        lines.push(rest)
      } else {
        lines.push(msg)
      }
    }
  }

  return lines.join('\n')
}

/**
 * 翻译 AgentTool 的描述（工具级 + 参数级）
 *
 * i18n 键命名规则：
 * - 工具描述：ai.tools.{toolName}.desc
 * - 参数描述：ai.tools.{toolName}.params.{paramName}
 */
function translateTool(tool: AgentTool<any>): AgentTool<any> {
  const name = tool.name

  const descKey = `ai.tools.${name}.desc`
  const translatedDesc = i18nT(descKey)

  const params = tool.parameters as Record<string, unknown>
  if (params?.properties && typeof params.properties === 'object') {
    for (const [paramName, param] of Object.entries(params.properties as Record<string, Record<string, unknown>>)) {
      const paramKey = `ai.tools.${name}.params.${paramName}`
      const translated = i18nT(paramKey)
      if (translated !== paramKey) {
        param.description = translated
      }
    }
  }

  return {
    ...tool,
    description: translatedDesc !== descKey ? translatedDesc : tool.description,
  }
}

/**
 * 预处理包装层
 * 拦截工具的 execute 结果：如果 details 中包含 rawMessages，
 * 则执行预处理管道 + 格式化，替换为最终的 LLM 内容
 *
 * 工具约定：返回消息的工具在 details 中放置 rawMessages 字段（结构化消息数组），
 * 处理层负责 preprocess + formatMessageCompact，工具无需感知预处理逻辑。
 */
function wrapWithPreprocessing(tool: AgentTool<any>, context: ToolContext): AgentTool<any> {
  const originalExecute = tool.execute
  return {
    ...tool,
    execute: async (toolCallId: string, params: any, _signal?: AbortSignal, _onUpdate?: unknown) => {
      const result = await originalExecute(toolCallId, params)

      const details = result.details as Record<string, unknown> | undefined
      if (!details?.rawMessages || !Array.isArray(details.rawMessages)) {
        return result
      }

      const raw = details.rawMessages as PreprocessableMessage[]
      const processed = preprocessMessages(raw, context.preprocessConfig)

      let nameMapLine = ''
      if (context.preprocessConfig?.anonymizeNames) {
        nameMapLine = anonymizeMessageNames(processed, context.ownerInfo?.platformId)
      }

      let formatted = processed.map((m) => formatMessageCompact(m, context.locale))

      // Token-aware 截断：超出预算时按策略裁剪消息列表
      let wasTruncated = false
      const originalCount = formatted.length
      if (context.maxToolResultTokens && context.maxToolResultTokens > 0) {
        const truncResult = truncateFormattedMessages(
          formatted,
          context.maxToolResultTokens,
          TRUNCATION_STRATEGY_MAP.get(tool.name) ?? 'keep_last'
        )
        if (truncResult.wasTruncated) {
          formatted = truncResult.messages
          wasTruncated = true
        }
      }

      const { rawMessages: _rawMessages, ...restDetails } = details
      const finalDetails = { ...restDetails, messages: formatted, returned: formatted.length }

      let textContent = formatToolResultAsText(finalDetails)

      if (wasTruncated) {
        const strategy = TRUNCATION_STRATEGY_MAP.get(tool.name) ?? 'keep_last'
        const strategyDesc = strategy === 'keep_first' ? 'most relevant' : 'most recent'
        const notice = `⚠️ Results truncated: ${originalCount} messages found, showing ${formatted.length} ${strategyDesc} due to context limit. Use a narrower time range or more specific keywords for more precise results.`
        textContent = notice + '\n' + textContent
      }

      if (nameMapLine) {
        textContent = nameMapLine + '\n' + textContent
      }

      return {
        content: [{ type: 'text' as const, text: textContent }],
        details: finalDetails,
      }
    },
  }
}

/**
 * Token-aware 截断：在 token 预算内保留尽可能多的消息
 */
function truncateFormattedMessages(
  formatted: string[],
  maxTokens: number,
  strategy: TruncationStrategy
): { messages: string[]; wasTruncated: boolean } {
  // 预留 token 给元数据头部和截断提示
  const budget = maxTokens - 200

  // 先快速估算总 token，如果未超预算则直接返回
  let totalTokens = 0
  for (const line of formatted) {
    totalTokens += countTokens(line) + 1
  }
  if (totalTokens <= budget) {
    return { messages: formatted, wasTruncated: false }
  }

  if (strategy === 'keep_first') {
    let tokens = 0
    let cutIndex = formatted.length
    for (let i = 0; i < formatted.length; i++) {
      tokens += countTokens(formatted[i]) + 1
      if (tokens > budget) {
        cutIndex = i
        break
      }
    }
    return { messages: formatted.slice(0, cutIndex), wasTruncated: cutIndex < formatted.length }
  } else {
    let tokens = 0
    let cutIndex = 0
    for (let i = formatted.length - 1; i >= 0; i--) {
      tokens += countTokens(formatted[i]) + 1
      if (tokens > budget) {
        cutIndex = i + 1
        break
      }
    }
    return { messages: formatted.slice(cutIndex), wasTruncated: cutIndex > 0 }
  }
}

/**
 * 昵称匿名化：用 U{senderId} 替代真实昵称
 * 就地修改 messages 的 senderName，返回映射表文本行
 */
function anonymizeMessageNames(messages: PreprocessableMessage[], ownerPlatformId?: string): string {
  const nameMap = new Map<number, { name: string; platformId?: string }>()
  for (const msg of messages) {
    if (msg.senderId != null && !nameMap.has(msg.senderId)) {
      nameMap.set(msg.senderId, { name: msg.senderName, platformId: msg.senderPlatformId })
    }
  }

  if (nameMap.size === 0) return ''

  for (const msg of messages) {
    if (msg.senderId != null) {
      msg.senderName = `U${msg.senderId}`
    }
  }

  const entries: string[] = []
  for (const [id, { name, platformId }] of nameMap) {
    const isOwner = ownerPlatformId && platformId === ownerPlatformId
    entries.push(`U${id}=${name}${isOwner ? '(owner)' : ''}`)
  }

  return `[Name Map] ${entries.join(' | ')}`
}

/**
 * 获取所有可用的 AgentTool
 *
 * - Core 工具始终加载，不受 allowedTools 白名单影响
 * - Analysis 工具仅在 allowedTools 中显式列出时才加载（opt-in）
 *
 * @param context 工具上下文
 * @param allowedTools analysis 工具白名单（仅控制 analysis 工具）
 */
export function getAllTools(context: ToolContext, allowedTools?: string[]): AgentTool<any>[] {
  const coreTools = TOOL_REGISTRY.filter((e) => e.category === 'core').map((e) => e.factory(context))

  let analysisTools: AgentTool<any>[] = []
  if (allowedTools && allowedTools.length > 0) {
    analysisTools = TOOL_REGISTRY.filter((e) => e.category === 'analysis' && allowedTools.includes(e.name)).map((e) =>
      e.factory(context)
    )
  }

  return [...coreTools, ...analysisTools].map(translateTool).map((t) => wrapWithPreprocessing(t, context))
}

/**
 * 创建 activate_skill 元工具（AI 自选模式专用）
 * LLM 判断用户问题适合某个技能时调用此工具，获取技能的完整执行指导
 */
export function createActivateSkillTool(
  chatType: 'group' | 'private',
  allowedTools?: string[],
  locale: string = 'zh-CN'
): AgentTool<any> {
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
    execute: async (_toolCallId: string, params: { skill_id: string }, _signal?: AbortSignal, _onUpdate?: unknown) => {
      const skill: SkillDef | null = getSkillConfig(params.skill_id)
      if (!skill) {
        return {
          content: [{ type: 'text' as const, text: isZh ? '技能不存在' : 'Skill not found' }],
          details: { skillId: params.skill_id, found: false },
        }
      }

      if (skill.chatScope !== 'all' && skill.chatScope !== chatType) {
        const scopeMsg = isZh
          ? `该技能仅适用于${skill.chatScope === 'group' ? '群聊' : '私聊'}场景`
          : `This skill is only applicable to ${skill.chatScope === 'group' ? 'group chat' : 'private chat'} scenarios`
        return {
          content: [{ type: 'text' as const, text: scopeMsg }],
          details: { skillId: params.skill_id, found: true, applicable: false },
        }
      }

      if (skill.tools.length > 0 && allowedTools && allowedTools.length > 0) {
        const missing = skill.tools.filter((t) => !CORE_TOOL_NAMES.has(t) && !allowedTools.includes(t))
        if (missing.length > 0) {
          const msg = isZh
            ? `当前助手缺少该技能所需的工具：${missing.join(', ')}`
            : `Current assistant lacks tools required by this skill: ${missing.join(', ')}`
          return {
            content: [{ type: 'text' as const, text: msg }],
            details: { skillId: params.skill_id, found: true, applicable: false, missingTools: missing },
          }
        }
      }

      const actionPrompt = isZh
        ? '\n\n[System]: 你已成功加载该技能手册。现在，请立即、自动地开始执行步骤1，调用相关的基础数据工具，不要等待用户的进一步确认！'
        : '\n\n[System]: You have successfully loaded this skill manual. Now, immediately start executing step 1 by calling the relevant data tools. Do not wait for further user confirmation!'

      return {
        content: [{ type: 'text' as const, text: `${skill.prompt}${actionPrompt}` }],
        details: { skillId: params.skill_id, found: true, applicable: true },
      }
    },
  }
}
