import {
  completeSimple,
  type Api as PiApi,
  type Model as PiModel,
  type TextContent as PiTextContent,
} from '@earendil-works/pi-ai'
import type {
  AnalysisPlanIntent,
  AnalysisPlanSummary,
  AnalysisPlanner,
  PlanContentBlock,
  PlannerInput,
} from './planning-types'

export type PlannerCompletionResult = string | { text: string }

export interface CreateAnalysisPlannerOptions {
  piModel?: PiModel<PiApi>
  apiKey?: string
  complete?: (prompt: string, signal?: AbortSignal) => Promise<PlannerCompletionResult> | PlannerCompletionResult
  maxTokens?: number
  temperature?: number
}

const PLAN_INTENTS: readonly AnalysisPlanIntent[] = [
  'summary',
  'trend',
  'relationship',
  'search',
  'comparison',
  'mixed',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIntent(value: unknown): value is AnalysisPlanIntent {
  return typeof value === 'string' && PLAN_INTENTS.includes(value as AnalysisPlanIntent)
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text.trim()
}

function parsePlanJson(rawText: string, availableTools: Set<string>): AnalysisPlanSummary | null {
  try {
    const parsed = JSON.parse(extractJsonObject(rawText)) as unknown
    if (!isRecord(parsed)) return null
    const title = normalizeString(parsed.title)
    if (!title || !isIntent(parsed.intent) || !Array.isArray(parsed.steps)) return null

    // 中文注释：Planner 输出来自 LLM，必须在进入 Agent guidance 前做结构约束；
    // 这里裁剪长度并过滤不存在的工具，避免把幻觉工具名注入后续执行上下文。
    const steps = parsed.steps
      .filter(isRecord)
      .map((step) => {
        const goal = normalizeString(step.goal)
        const evidenceNeeded = normalizeString(step.evidenceNeeded)
        if (!goal || !evidenceNeeded) return null
        const suggestedTools = Array.isArray(step.suggestedTools)
          ? step.suggestedTools.filter((tool): tool is string => typeof tool === 'string' && availableTools.has(tool))
          : []
        return { goal, suggestedTools: Array.from(new Set(suggestedTools)), evidenceNeeded }
      })
      .filter((step): step is NonNullable<typeof step> => step !== null)
      .slice(0, 5)

    if (steps.length === 0) return null

    const successCriteria = Array.isArray(parsed.successCriteria)
      ? parsed.successCriteria
          .map(normalizeString)
          .filter((item): item is string => item !== null)
          .slice(0, 5)
      : []
    if (successCriteria.length === 0) return null

    return {
      version: 1,
      title,
      route: 'planned_execution',
      intent: parsed.intent,
      steps,
      successCriteria,
    }
  } catch {
    return null
  }
}

function resultToText(result: PlannerCompletionResult): string {
  return typeof result === 'string' ? result : result.text
}

function buildPlannerPrompt(input: PlannerInput): string {
  const dataSnapshot = input.dataSnapshot
    ? `${input.dataSnapshot.name}, ${input.dataSnapshot.totalMessages} messages, ${input.dataSnapshot.totalMembers} members`
    : '(none)'
  const availableCapabilities =
    input.availableCapabilities && input.availableCapabilities.length > 0
      ? input.availableCapabilities
          .map((capability) => {
            const tools = capability.tools.join(', ') || 'none'
            return `  - ${capability.id} (${capability.label}; tools: ${tools}): ${capability.guidance}`
          })
          .join('\n')
      : '(none)'

  return `Create a concise user-visible analysis plan for a ChatLab planned_execution request.

Return strict JSON only:
{
  "title": "short title",
  "intent": "summary|trend|relationship|search|comparison|mixed",
  "steps": [
    {"goal": "what to investigate", "suggestedTools": ["tool_name"], "evidenceNeeded": "what evidence is needed"}
  ],
  "successCriteria": ["criterion"]
}

Limits:
- Max 5 steps.
- Max 5 successCriteria.
- suggestedTools must come only from availableTools.
- If availableCapabilities are listed, you may plan steps that use their tools when the capability helps the user.
- Do not reveal hidden chain-of-thought; write a user-readable plan summary.
- The plan is soft guidance, not a mandatory execution script.

Context:
- locale: ${input.locale}
- chatType: ${input.chatType}
- availableTools: ${input.availableTools.join(', ') || '(none)'}
- availableCapabilities:
${availableCapabilities}
- dataSnapshot: ${dataSnapshot}
- assistantSummary: ${input.assistantSummary ?? '(none)'}
- skillSummary: ${input.skillSummary ?? '(none)'}
- recentIntentSummary: ${input.recentIntentSummary ?? '(none)'}

User request:
${input.userMessage}`
}

export function createAnalysisPlanner(options: CreateAnalysisPlannerOptions): AnalysisPlanner {
  return async (input, signal) => {
    try {
      const prompt = buildPlannerPrompt(input)
      const rawResult = options.complete
        ? await options.complete(prompt, signal)
        : await completeWithPiAi(prompt, options, signal)
      return parsePlanJson(resultToText(rawResult), new Set(input.availableTools))
    } catch {
      return null
    }
  }
}

export function createPlanContentBlock(
  plan: AnalysisPlanSummary,
  status: PlanContentBlock['status'] = 'created'
): PlanContentBlock {
  return {
    type: 'plan',
    version: 1,
    status,
    plan,
  }
}

export function buildPlanGuidance(plan: AnalysisPlanSummary): string {
  const steps = plan.steps
    .map((step, index) => {
      const tools = step.suggestedTools.length > 0 ? step.suggestedTools.join(', ') : 'none'
      return `${index + 1}. ${step.goal}\n   Evidence needed: ${step.evidenceNeeded}\n   Suggested tools: ${tools}`
    })
    .join('\n')
  const successCriteria = plan.successCriteria.map((item) => `- ${item}`).join('\n')

  return `A suggested analysis plan is available below. Use it as guidance when helpful, but do not follow it mechanically if the user's question can be answered more directly.

Plan title: ${plan.title}
Intent: ${plan.intent}

Steps:
${steps}

Success criteria:
${successCriteria}`
}

async function completeWithPiAi(
  prompt: string,
  options: CreateAnalysisPlannerOptions,
  signal?: AbortSignal
): Promise<PlannerCompletionResult> {
  if (!options.piModel || !options.apiKey) {
    throw new Error('Planner requires piModel and apiKey')
  }

  const result = await completeSimple(
    options.piModel,
    {
      systemPrompt: 'You are a strict JSON planner for ChatLab analysis. Return JSON only.',
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }] as any,
    },
    {
      apiKey: options.apiKey,
      maxTokens: options.maxTokens ?? 700,
      temperature: options.temperature ?? 0.2,
      signal,
    }
  )

  return {
    text: result.content
      .filter((item): item is PiTextContent => item.type === 'text')
      .map((item) => item.text)
      .join(''),
  }
}
