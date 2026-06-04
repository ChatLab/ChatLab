/**
 * AI Tools 模块入口
 * 工具创建、预处理管道与管理
 *
 * 架构：工具返回结构化数据（rawMessages） → 处理层执行预处理 + 格式化 → 生成 LLM 内容
 */

import type { AgentTool } from '@openchatlab/node-runtime'
import { CHART_CAPABILITY_ANALYSIS_TOOLS, getChartCapabilityAllowedBuiltinTools } from '@openchatlab/core'
import type { ToolContext, TruncationStrategy } from './types'
import { TOOL_REGISTRY } from './definitions'
import { t as i18nT } from '../../i18n'
import { applyPreprocessingPipeline, type PreprocessableMessage } from '@openchatlab/node-runtime'
import { aiLogger } from '../logger'
import { getSkillConfig } from '../skills'
import {
  createActivateSkillTool as sharedCreateActivateSkillTool,
  createChartSchemaGateState,
  getSkillConfigWithBuiltinChart,
  wrapWithChartSchemaGate,
} from '@openchatlab/node-runtime'

const CORE_TOOL_NAMES = new Set(TOOL_REGISTRY.filter((e) => e.category === 'core').map((e) => e.name))
const RAW_SQL_TOOL_NAME_SET = new Set(['execute_sql'])
const CHART_CAPABILITY_ANALYSIS_TOOL_SET = new Set<string>(CHART_CAPABILITY_ANALYSIS_TOOLS)

const preprocessLogger = {
  info: (category: string, message: string, extra?: Record<string, unknown>) => aiLogger.info(category, message, extra),
  warn: (category: string, message: string, extra?: Record<string, unknown>) => aiLogger.warn(category, message, extra),
}

const TRUNCATION_STRATEGY_MAP = new Map<string, TruncationStrategy>(
  TOOL_REGISTRY.filter((e) => e.truncationStrategy).map((e) => [e.name, e.truncationStrategy!])
)

// 导出类型
export * from './types'

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
 * 则委托共享管道 applyPreprocessingPipeline 执行预处理 + 格式化 + 截断。
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

      const { rawMessages, ...restDetails } = details

      const pipelineResult = applyPreprocessingPipeline({
        rawMessages: rawMessages as PreprocessableMessage[],
        preprocessConfig: context.preprocessConfig,
        locale: context.locale,
        anonymizeNames: context.preprocessConfig?.anonymizeNames ?? false,
        ownerPlatformId: context.ownerInfo?.platformId,
        maxToolResultTokens: context.maxToolResultTokens,
        truncationStrategy: TRUNCATION_STRATEGY_MAP.get(tool.name) ?? 'keep_last',
        extraDetails: restDetails as Record<string, unknown>,
        logger: preprocessLogger,
      })

      return {
        content: [{ type: 'text' as const, text: pipelineResult.text }],
        details: pipelineResult.details,
      }
    },
  }
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

  const chartSchemaGateState = createChartSchemaGateState()

  return [...coreTools, ...analysisTools]
    .map(translateTool)
    .map((t) => wrapWithChartSchemaGate(t, chartSchemaGateState))
    .map((t) => wrapWithPreprocessing(t, context))
}

export function getAllowedToolsForChartCapability(allowedTools?: readonly string[] | null): string[] {
  return getChartCapabilityAllowedBuiltinTools(allowedTools).filter(
    (toolName) => CHART_CAPABILITY_ANALYSIS_TOOL_SET.has(toolName) || !RAW_SQL_TOOL_NAME_SET.has(toolName)
  )
}

/**
 * 创建 activate_skill 元工具（AI 自选模式专用）
 * 委托给共享包的 createActivateSkillTool，注入 Electron 端的 getSkillConfig
 */
export function createActivateSkillTool(
  chatType: 'group' | 'private',
  allowedTools?: string[],
  locale: string = 'zh-CN'
): AgentTool<any> {
  return sharedCreateActivateSkillTool({
    chatType,
    allowedTools,
    locale,
    getSkillConfig: (id) =>
      getSkillConfigWithBuiltinChart(id, locale, (skillConfigId) => getSkillConfig(skillConfigId)),
    coreToolNames: CORE_TOOL_NAMES,
  })
}
