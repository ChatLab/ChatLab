import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'

export const CHART_SCHEMA_REQUIRED_MESSAGE =
  'Error: Call get_schema before render_chart. Do not guess table names, fields, or timestamp units.'

export interface ChartSchemaGateState {
  schemaSeen: boolean
}

export function createChartSchemaGateState(): ChartSchemaGateState {
  return { schemaSeen: false }
}

export function wrapWithChartSchemaGate(tool: AgentTool<any>, state: ChartSchemaGateState): AgentTool<any> {
  const originalExecute = tool.execute

  return {
    ...tool,
    execute: async (
      toolCallId: string,
      params: any,
      signal?: AbortSignal,
      onUpdate?: unknown
    ): Promise<AgentToolResult<any>> => {
      if (tool.name === 'render_chart' && !state.schemaSeen) {
        return {
          content: [{ type: 'text', text: CHART_SCHEMA_REQUIRED_MESSAGE }],
          details: null,
        } as AgentToolResult<any>
      }

      const result = await originalExecute(toolCallId, params, signal, onUpdate as never)

      if (tool.name === 'get_schema') {
        state.schemaSeen = true
      }

      return result
    },
  }
}
