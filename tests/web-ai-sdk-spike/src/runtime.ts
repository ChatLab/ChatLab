import type { LanguageModel, LanguageModelUsage, ToolSet } from 'ai'
import { ToolLoopAgent, stepCountIs, streamText, tool } from 'ai'
import { z } from 'zod'

export type ProviderKind = 'openai-compatible' | 'deepseek'

export interface SpikeConfig {
  providerKind: ProviderKind
  baseURL: string
  apiKey: string
  model: string
}

export type SpikeEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool-call'; name: string }
  | { type: 'tool-result'; name: string }
  | { type: 'usage'; usage: LanguageModelUsage }
  | { type: 'aborted' }

export interface SpikeRunResult {
  text: string
  firstOutputMs: number | null
  toolCalls: number
  usage: LanguageModelUsage
  aborted: boolean
}

function emptyUsage(): LanguageModelUsage {
  return {
    inputTokens: undefined,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens: undefined,
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
    totalTokens: undefined,
  }
}

export async function createSpikeModel(config: SpikeConfig): Promise<LanguageModel> {
  const common = {
    apiKey: config.apiKey,
    baseURL: config.baseURL.replace(/\/+$/, ''),
  }

  if (config.providerKind === 'deepseek') {
    const { createDeepSeek } = await import('@ai-sdk/deepseek')
    return createDeepSeek(common)(config.model)
  }

  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
  return createOpenAICompatible({
    ...common,
    name: 'deepseek-browser-spike',
  }).chatModel(config.model)
}

export async function runStreamSpike(
  config: SpikeConfig,
  signal: AbortSignal,
  onEvent: (event: SpikeEvent) => void
): Promise<SpikeRunResult> {
  const model = await createSpikeModel(config)
  const startedAt = performance.now()
  let firstOutputMs: number | null = null
  let text = ''
  let aborted = false

  const result = streamText({
    model,
    abortSignal: signal,
    maxOutputTokens: 256,
    prompt: '请用一句简短中文回复：ChatLab Web AI 流式请求成功。',
  })

  for await (const part of result.stream) {
    if (part.type === 'text-delta') {
      firstOutputMs ??= performance.now() - startedAt
      text += part.text
      onEvent({ type: 'text', delta: part.text })
    } else if (part.type === 'reasoning-delta') {
      firstOutputMs ??= performance.now() - startedAt
      onEvent({ type: 'reasoning', delta: part.text })
    } else if (part.type === 'abort') {
      aborted = true
      onEvent({ type: 'aborted' })
    } else if (part.type === 'error') {
      throw part.error
    }
  }

  const usage = await result.usage
  onEvent({ type: 'usage', usage })
  return { text, firstOutputMs, toolCalls: 0, usage, aborted }
}

export async function runToolLoopSpike(
  config: SpikeConfig,
  signal: AbortSignal,
  onEvent: (event: SpikeEvent) => void
): Promise<SpikeRunResult> {
  const model = await createSpikeModel(config)
  const startedAt = performance.now()
  let firstOutputMs: number | null = null
  let text = ''
  let toolCalls = 0
  let aborted = false

  const tools = {
    get_chat_overview: tool({
      description: '获取当前聊天的本地安全概览。测试中返回固定的无隐私数据。',
      inputSchema: z.object({}),
      execute: async () => {
        toolCalls += 1
        return {
          name: '浏览器测试群',
          type: 'group',
          totalMessages: 128,
          totalMembers: 4,
        }
      },
    }),
  } satisfies ToolSet

  const agent = new ToolLoopAgent({
    model,
    instructions: '你是 ChatLab 测试助手。必须先调用工具，再根据工具结果用一句中文总结，不能猜测数据。',
    tools,
    stopWhen: stepCountIs(3),
    maxOutputTokens: 256,
  })

  const result = await agent.stream({
    abortSignal: signal,
    prompt: '请先查询聊天概览，然后说明消息数和成员数。',
  })

  for await (const part of result.stream) {
    if (part.type === 'text-delta') {
      firstOutputMs ??= performance.now() - startedAt
      text += part.text
      onEvent({ type: 'text', delta: part.text })
    } else if (part.type === 'reasoning-delta') {
      firstOutputMs ??= performance.now() - startedAt
      onEvent({ type: 'reasoning', delta: part.text })
    } else if (part.type === 'tool-call') {
      firstOutputMs ??= performance.now() - startedAt
      onEvent({ type: 'tool-call', name: part.toolName })
    } else if (part.type === 'tool-result') {
      onEvent({ type: 'tool-result', name: part.toolName })
    } else if (part.type === 'abort') {
      aborted = true
      onEvent({ type: 'aborted' })
    } else if (part.type === 'error') {
      throw part.error
    }
  }

  const usage = await result.usage
  onEvent({ type: 'usage', usage })
  return { text, firstOutputMs, toolCalls, usage, aborted }
}

export async function runAbortSpike(
  config: SpikeConfig,
  signal: AbortSignal,
  onEvent: (event: SpikeEvent) => void
): Promise<SpikeRunResult> {
  const model = await createSpikeModel(config)
  const startedAt = performance.now()
  let firstOutputMs: number | null = null
  let text = ''
  let aborted = false

  const result = streamText({
    model,
    abortSignal: signal,
    maxOutputTokens: 1000,
    prompt: '请从 1 开始逐行输出整数，一直输出到 500，不要解释。',
    // 显式接管流错误；主动中止会在下方归一化为 aborted，而不是业务失败。
    onError: () => undefined,
    onAbort: () => {
      aborted = true
      onEvent({ type: 'aborted' })
    },
  })

  try {
    for await (const part of result.stream) {
      if (part.type === 'text-delta') {
        firstOutputMs ??= performance.now() - startedAt
        text += part.text
        onEvent({ type: 'text', delta: part.text })
      } else if (part.type === 'reasoning-delta') {
        firstOutputMs ??= performance.now() - startedAt
        onEvent({ type: 'reasoning', delta: part.text })
      } else if (part.type === 'abort') {
        aborted = true
      } else if (part.type === 'error') {
        if (!signal.aborted) throw part.error
        aborted = true
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error
    aborted = true
  }

  let usage = emptyUsage()
  try {
    usage = await result.usage
  } catch (error) {
    // 即使中止后不展示 usage，也要消费它的 rejection，避免浏览器产生未处理异常。
    if (!signal.aborted) throw error
  }
  onEvent({ type: 'usage', usage })
  return { text, firstOutputMs, toolCalls: 0, usage, aborted }
}
