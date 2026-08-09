import { buildPiModel, completeSimple, type AIServiceConfig, type PiTextContent } from '../../ai'

const CHAT_TOPIC_MODEL_MAX_TOKENS = 4_096
const CHAT_TOPIC_MODEL_TIMEOUT_MS = 120_000

interface ChatTopicModelClientDeps {
  completeSimple?: typeof completeSimple
}

export interface ChatTopicModelResult {
  text: string
  inputTokens: number
  outputTokens: number
}

export interface ChatTopicModelClient {
  modelId: string
  complete(
    prompts: { systemPrompt: string; userPrompt: string },
    options: { signal: AbortSignal; sessionId: string }
  ): Promise<ChatTopicModelResult>
}

export function createChatTopicModelClient(
  config: AIServiceConfig,
  deps: ChatTopicModelClientDeps = {}
): ChatTopicModelClient {
  const model = buildPiModel(config)
  const modelId = `${config.provider}/${model.id}`
  const runCompletion = deps.completeSimple ?? completeSimple
  return {
    modelId,
    async complete(prompts, options) {
      const result = await runCompletion(
        model,
        {
          systemPrompt: prompts.systemPrompt,
          messages: [
            { role: 'user', content: [{ type: 'text', text: prompts.userPrompt }], timestamp: Date.now() },
          ] as any,
        },
        {
          apiKey: config.apiKey,
          maxTokens: Math.min(
            config.maxTokens ?? model.maxTokens ?? CHAT_TOPIC_MODEL_MAX_TOKENS,
            CHAT_TOPIC_MODEL_MAX_TOKENS
          ),
          ...(model.reasoning ? {} : { temperature: 0.1 }),
          cacheRetention: 'short',
          sessionId: options.sessionId,
          signal: options.signal,
          timeoutMs: CHAT_TOPIC_MODEL_TIMEOUT_MS,
          maxRetries: 0,
          onPayload: normalizeTopicModelPayload,
        }
      )
      if (result.stopReason === 'error' || result.stopReason === 'aborted') {
        throw new Error(result.errorMessage || `Topic model request ${result.stopReason}`)
      }
      return {
        text: result.content
          .filter((item): item is PiTextContent => item.type === 'text')
          .map((item) => item.text)
          .join(''),
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
      }
    },
  }
}

function normalizeTopicModelPayload(payload: unknown, model: { provider: string; baseUrl: string }): unknown {
  if (!isRecord(payload) || !isDeepSeekEndpoint(model)) return undefined

  // The DeepSeek chat-completions endpoint ignored max_completion_tokens in a real topic run and emitted more than
  // 15k output tokens. Keep this compatibility correction local to the topic runtime until the SDK fixes detection.
  const normalized: Record<string, unknown> = {
    ...payload,
    thinking: { type: 'disabled' },
  }
  if (normalized.max_tokens === undefined && typeof normalized.max_completion_tokens === 'number') {
    normalized.max_tokens = normalized.max_completion_tokens
    delete normalized.max_completion_tokens
  }
  delete normalized.reasoning_effort
  return normalized
}

function isDeepSeekEndpoint(model: { provider: string; baseUrl: string }): boolean {
  return model.provider === 'deepseek' || model.baseUrl.includes('deepseek.com')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
