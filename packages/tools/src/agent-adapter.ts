import type { JsonSchema, ToolDefinition, ToolExecutionContext, ToolResult } from './types'

interface AgentToolParameters {
  type: 'object'
  properties: Record<string, unknown>
  required: string[]
}

interface AgentToolExecutionResult {
  content: Array<{ type: 'text'; text: string }>
  details: unknown
}

/** 将平台无关的工具输入 schema 转成 Agent SDK 接受的参数结构，并避免共享原对象引用。 */
export function toAgentToolParameters(schema: JsonSchema): AgentToolParameters {
  return {
    type: 'object',
    properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, { ...value }])),
    required: schema.required ?? [],
  }
}

/** 统一把工具返回的数据、图表和原始消息整理成 CLI/Desktop 共用的 Agent 结果结构。 */
function toAgentToolResult(result: ToolResult): AgentToolExecutionResult {
  const chartDetails = {
    ...(result.chart ? { chart: result.chart } : {}),
    ...(result.charts ? { charts: result.charts } : {}),
  }

  if (result.rawMessages?.length) {
    const data = typeof result.data === 'object' && result.data !== null ? result.data : {}
    const { rawMessages: _ignored, ...details } = data as Record<string, unknown>
    return {
      content: [{ type: 'text', text: result.content }],
      details: { ...details, ...chartDetails, rawMessages: result.rawMessages },
    }
  }

  const details =
    typeof result.data === 'object' && result.data !== null
      ? (result.data as Record<string, unknown>)
      : result.data === undefined
        ? null
        : { value: result.data }

  return {
    content: [{ type: 'text', text: result.content }],
    details: Object.keys(chartDetails).length > 0 ? { ...(details ?? {}), ...chartDetails } : details,
  }
}

/** 执行共享工具并把异常收敛成 Agent 可直接返回给模型的文本结果。 */
export async function executeToolForAgent(
  tool: ToolDefinition,
  params: unknown,
  context: ToolExecutionContext
): Promise<AgentToolExecutionResult> {
  const toolParams = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
  try {
    return toAgentToolResult(await tool.handler(toolParams, context))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { content: [{ type: 'text', text: `Error: ${message}` }], details: null }
  }
}
