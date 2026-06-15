import { stripAvatarFields } from '@openchatlab/core'
import type { AiToolExecuteRequest, AiToolExecuteResult } from '@openchatlab/http-routes'
import { batchSegmentWithFrequency } from '@openchatlab/node-runtime'
import { AGENT_TOOL_REGISTRY } from '@openchatlab/tools'
import type { ToolExecutionContext } from '@openchatlab/tools'
import { t as i18nT } from '../../i18n'
import { WorkerDataProvider } from './worker-data-provider'

const MAX_RESULT_CHARS = 500_000

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('cancelled')
  }
}

export async function executeElectronAiTool(params: AiToolExecuteRequest): Promise<AiToolExecuteResult> {
  const { toolName, sessionId, abortSignal } = params
  const entry = AGENT_TOOL_REGISTRY.find((tool) => tool.name === toolName)
  if (!entry) {
    return { success: false, error: `Tool not found: ${toolName}` }
  }

  try {
    assertNotAborted(abortSignal)
    const execCtx: ToolExecutionContext = {
      sessionId,
      abortSignal,
      dataProvider: new WorkerDataProvider(sessionId, abortSignal),
      segmentText: (texts, locale, options) => batchSegmentWithFrequency(texts, locale as any, options as any),
      translateTemplate: (key: string) => {
        const translated = i18nT(key)
        return translated !== key ? translated : undefined
      },
    }

    const startTime = Date.now()
    const result = await entry.handler(params.params, execCtx)
    const elapsed = Date.now() - startTime
    assertNotAborted(abortSignal)

    let details = (result.data as Record<string, unknown> | undefined) ?? undefined
    let truncated = false

    if (details) {
      stripAvatarFields(details)
      const raw = JSON.stringify(details)
      if (raw.length > MAX_RESULT_CHARS) {
        truncated = true
        details = { _truncated: true, _originalSize: raw.length, _preview: raw.slice(0, MAX_RESULT_CHARS) }
      }
    }

    return {
      success: true,
      elapsed,
      content: [{ type: 'text', text: result.content }],
      details,
      truncated,
    }
  } catch (error) {
    if (abortSignal.aborted) {
      return { success: false, error: 'cancelled' }
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
