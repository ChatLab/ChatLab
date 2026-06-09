import type { LlmRouteDecider, RouteDecision, RouterInput } from './routing-types'
import { formatDataSnapshotForRouter } from './data-snapshot'
import {
  completeSimple,
  type Api as PiApi,
  type Model as PiModel,
  type TextContent as PiTextContent,
} from '@earendil-works/pi-ai'

export interface DecideRequestRouteOptions {
  llmRouter?: LlmRouteDecider
  llmFallbackConfidenceThreshold?: number
}

export type LlmRouterCompletionResult =
  | string
  | {
      text: string
      usage?: RouteDecision['usage']
    }

export interface CreateLlmRouteDeciderOptions {
  piModel?: PiModel<PiApi>
  apiKey?: string
  complete?: (prompt: string, signal?: AbortSignal) => Promise<LlmRouterCompletionResult> | LlmRouterCompletionResult
  abortSignal?: AbortSignal
  maxTokens?: number
  temperature?: number
}

const DEFAULT_LLM_FALLBACK_CONFIDENCE_THRESHOLD = 0.6

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function isRoute(value: unknown): value is RouteDecision['route'] {
  return value === 'direct_response' || value === 'tool_assisted' || value === 'planned_execution'
}

function resultToText(result: LlmRouterCompletionResult): { text: string; usage?: RouteDecision['usage'] } {
  return typeof result === 'string' ? { text: result } : result
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text.trim()
}

function parseLlmDecision(rawText: string, usage?: RouteDecision['usage']): RouteDecision | null {
  try {
    const parsed = JSON.parse(extractJsonObject(rawText)) as Record<string, unknown>
    if (!isRoute(parsed.route)) return null
    return {
      route: parsed.route,
      confidence: clampConfidence(typeof parsed.confidence === 'number' ? parsed.confidence : 0.5),
      reason: typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : 'LLM route decision.',
      source: 'llm',
      usage,
    }
  } catch {
    return null
  }
}

function buildLlmRouterPrompt(input: RouterInput, ruleDecision: RouteDecision): string {
  const toolNames = input.availableTools?.length ? input.availableTools.join(', ') : '(none)'
  const dataSnapshot = formatDataSnapshotForRouter(input.dataSnapshot)

  return `Classify the user's ChatLab request into exactly one route.

Routes:
- direct_response: no local chat data/tools needed.
- tool_assisted: local chat data/tools needed, but the task is simple.
- planned_execution: complex analysis, multi-step evidence gathering, retries, long-range comparison, relationship analysis, or insufficient-evidence handling.

Return strict JSON only:
{"route":"direct_response|tool_assisted|planned_execution","confidence":0.0,"reason":"short reason"}

Context:
- locale: ${input.locale}
- chatType: ${input.chatType}
- availableTools: ${toolNames}
- dataSnapshot: ${dataSnapshot}
- assistantSummary: ${input.assistantSummary ?? '(none)'}
- skillSummary: ${input.skillSummary ?? '(none)'}
- recentIntentSummary: ${input.recentIntentSummary ?? '(none)'}
- ruleDecision: ${ruleDecision.route}, confidence=${ruleDecision.confidence}, reason=${ruleDecision.reason}

User request:
${input.userMessage}`
}

function directRuleDecision(text: string): RouteDecision | null {
  if (
    matchAny(text, [/不用查聊天记录|不用查询|不用查数据|不用看本地数据/i, /润色|改写|翻译|polish|rewrite|translate/i])
  ) {
    return {
      route: 'direct_response',
      confidence: 0.95,
      reason: 'User explicitly asked for a non-data response.',
      source: 'rule',
    }
  }

  if (matchAny(text, [/什么是|解释一下|概念|区别|explain|briefly explain|why .*function calling|react/i])) {
    return {
      route: 'direct_response',
      confidence: 0.86,
      reason: 'Conceptual explanation without local chat-data dependency.',
      source: 'rule',
    }
  }

  if (matchAny(text, [/日志在哪里|怎么配置|设置|帮助|help|where .*log/i])) {
    return {
      route: 'direct_response',
      confidence: 0.84,
      reason: 'Help or configuration request does not require chat tools.',
      source: 'rule',
    }
  }

  if (matchAny(text, [/你觉得|闲聊|随便聊聊|建议我|should i/i])) {
    return {
      route: 'direct_response',
      confidence: 0.78,
      reason: 'Conversational request without clear data dependency.',
      source: 'rule',
    }
  }

  return null
}

function plannedRuleDecision(text: string): RouteDecision | null {
  if (matchAny(text, [/如果.*找不到.*继续查|换几个相关|换几个.*继续|search.*if.*not.*found/i])) {
    return {
      route: 'planned_execution',
      confidence: 0.88,
      reason: 'Request asks for search failure recovery and retry strategy.',
      source: 'rule',
    }
  }

  const dimensions = [
    matchAny(text, [/分析|复盘|总结.*规律|趋势|变化|演变|compare|comparison/i]),
    matchAny(text, [/过去一年|最近半年|今年|去年|上半年|下半年|长期|按季度|按月份|first half|second half/i]),
    matchAny(text, [/关系|互动|影响力|最强|最活跃|被忽略|主动|回应|turning point|转折点/i]),
    matchAny(text, [/证据|举出|例子|关键分歧|主要矛盾|evidence/i]),
    matchAny(text, [/并且|同时|以及|分别|每个阶段|多条件|参与|回复|topic|theme/i]),
    matchAny(text, [/证据不够|不足以|不够|uncertain|insufficient/i]),
  ]
  const score = dimensions.filter(Boolean).length
  if (score >= 2) {
    return {
      route: 'planned_execution',
      confidence: Math.min(0.95, 0.72 + score * 0.04),
      reason: `Rule matched ${score} complex-analysis signals.`,
      source: 'rule',
    }
  }

  return null
}

function toolRuleDecision(text: string): RouteDecision | null {
  if (
    matchAny(text, [
      /一共有多少|多少成员|多少条消息|谁发言最多|前\s*\d+\s*名|top\s*\d+/i,
      /异常活跃|活跃度|发言最多|message count|member count/i,
    ])
  ) {
    return {
      route: 'tool_assisted',
      confidence: 0.82,
      reason: 'Simple statistics request can be answered by one or a few tools.',
      source: 'rule',
    }
  }

  if (
    matchAny(text, [
      /找一下|查一下|有没有聊到|有没有提过|最近提到|昨天.*聊了什么|最近.*发言/i,
      /search|find|mentioned|talked about/i,
    ])
  ) {
    return {
      route: 'tool_assisted',
      confidence: 0.78,
      reason: 'Simple search or lookup request with a single clear target.',
      source: 'rule',
    }
  }

  return null
}

function ruleDecision(input: RouterInput): RouteDecision {
  const text = normalizeText(input.userMessage)

  // 中文注释：先识别复杂分析，再识别简单工具查询，最后识别直答；
  // 这样“分析/证据/长时间范围”等高认知负载请求不会被“找一下”之类词误判成简单搜索。
  return (
    plannedRuleDecision(text) ??
    toolRuleDecision(text) ??
    directRuleDecision(text) ?? {
      route: 'tool_assisted',
      confidence: 0.45,
      reason: 'Ambiguous request; conservatively keep the existing tool-assisted Agent path.',
      source: 'rule',
    }
  )
}

export async function decideRequestRoute(
  input: RouterInput,
  options: DecideRequestRouteOptions = {}
): Promise<RouteDecision> {
  const decision = ruleDecision(input)
  const threshold = options.llmFallbackConfidenceThreshold ?? DEFAULT_LLM_FALLBACK_CONFIDENCE_THRESHOLD
  if (decision.confidence >= threshold || !options.llmRouter) {
    return { ...decision, confidence: clampConfidence(decision.confidence) }
  }

  const llmDecision = await options.llmRouter(input, decision)
  return {
    ...llmDecision,
    confidence: clampConfidence(llmDecision.confidence),
  }
}

export function createLlmRouteDecider(options: CreateLlmRouteDeciderOptions): LlmRouteDecider {
  return async (input, ruleDecision) => {
    const prompt = buildLlmRouterPrompt(input, ruleDecision)

    try {
      const rawResult = options.complete
        ? await options.complete(prompt, options.abortSignal)
        : await completeWithPiAi(prompt, options)
      const { text, usage } = resultToText(rawResult)
      const decision = parseLlmDecision(text, usage)
      if (decision) return decision
      return {
        ...ruleDecision,
        reason: `${ruleDecision.reason} LLM fallback returned invalid route JSON.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ...ruleDecision,
        reason: `${ruleDecision.reason} LLM fallback failed: ${message}`,
      }
    }
  }
}

async function completeWithPiAi(
  prompt: string,
  options: CreateLlmRouteDeciderOptions
): Promise<LlmRouterCompletionResult> {
  if (!options.piModel || !options.apiKey) {
    throw new Error('LLM router requires piModel and apiKey')
  }

  const result = await completeSimple(
    options.piModel,
    {
      systemPrompt: 'You are a strict JSON classifier for ChatLab AI routing. Return JSON only.',
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }] as any,
    },
    {
      apiKey: options.apiKey,
      maxTokens: options.maxTokens ?? 180,
      temperature: options.temperature ?? 0,
      signal: options.abortSignal,
    }
  )

  const text = result.content
    .filter((item): item is PiTextContent => item.type === 'text')
    .map((item) => item.text)
    .join('')

  return {
    text,
    usage: {
      promptTokens: result.usage?.input,
      completionTokens: result.usage?.output,
      totalTokens: result.usage?.totalTokens,
    },
  }
}
