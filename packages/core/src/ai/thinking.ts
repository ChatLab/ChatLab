/**
 * Thinking / Reasoning level configuration for AI models.
 *
 * Inspired by cherry-studio's MODEL_SUPPORTED_REASONING_EFFORT table.
 * This module is the single source of truth for:
 *   - which models support thinking and at what granularity
 *   - what `compat` fields pi-ai needs to actually inject the right request params
 *
 * Scope (v1): openai-completions API path only.
 * anthropic-messages / google-generative-ai are out of scope for this version.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Ordered from off (weakest) to xhigh (strongest), mirrors pi-ai's enum. */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/** Used internally to categorise a model into a thinking behaviour group. */
type ThinkingType =
  | 'none'          // model is not a reasoning model
  | 'qwen'          // Qwen-family: boolean enable_thinking (off/on)
  | 'deepseek_v4'   // DeepSeek V4+: thinkingFormat:'deepseek', off/high/xhigh
  | 'o_series'      // OpenAI o1/o3: can't disable thinking; low/medium/high only
  | 'gpt5'          // OpenAI gpt-5 base: can't disable; minimal/low/medium/high
  | 'gpt5_1'        // OpenAI gpt-5.1: off→none supported; off/low/medium/high
  | 'gpt5_2plus'    // OpenAI gpt-5.2+: off→none + xhigh; full range
  | 'grok'          // xAI grok: can't disable; low/high only
  | 'kimi'          // Kimi thinking: low/medium/high
  | 'doubao'        // Doubao seed reasoning: high only (no disable support)
  | 'default'       // generic reasoning: off / low / medium / high

// ── Internal: per-type level tables ──────────────────────────────────────────

/** UI options for each type — what the selector will show. */
const TYPE_LEVELS: Record<ThinkingType, ThinkingLevel[]> = {
  none:        [],
  // Qwen/GLM: boolean enable_thinking; 'off' sends false, 'high' sends true
  qwen:        ['off', 'high'],
  // DeepSeek V4+: thinkingFormat:'deepseek', 'off' → thinking:{type:"disabled"}
  deepseek_v4: ['off', 'high', 'xhigh'],
  // o-series: always thinks, no API param to disable; don't show 'off'
  o_series:    ['low', 'medium', 'high'],
  // gpt-5 base: API doesn't support reasoning_effort:'none'; no 'off'
  gpt5:        ['minimal', 'low', 'medium', 'high'],
  // gpt-5.1+: supports reasoning_effort:'none' to disable thinking
  gpt5_1:      ['off', 'low', 'medium', 'high'],
  gpt5_2plus:  ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  // Grok: no disable support; only low/high
  grok:        ['low', 'high'],
  // Kimi: low/medium/high (no confirmed disable API)
  kimi:        ['low', 'medium', 'high'],
  // Doubao: only 'high' confirmed; no disable
  doubao:      ['high'],
  default:     ['off', 'low', 'medium', 'high'],
}

/**
 * thinkingLevelMap entries for models that use `reasoning_effort`.
 * `null` means that level is explicitly not supported.
 * `undefined` (key absent) means pass the level string verbatim.
 * Matches pi-ai's convention in models.generated.js.
 */
// thinkingLevelMap is only used by models on the supportsReasoningEffort path.
// DeepSeek uses thinkingFormat:'deepseek' (its own pi-ai branch) and has no entry here.
const TYPE_LEVEL_MAP: Partial<Record<ThinkingType, Partial<Record<ThinkingLevel, string | null>>>> = {
  gpt5: {
    minimal: 'minimal',
    low:     'low',
    medium:  'medium',
    high:    'high',
  },
  // 'off' maps to reasoning_effort:'none' — API confirmed to disable thinking
  gpt5_1: {
    off:    'none',
    low:    'low',
    medium: 'medium',
    high:   'high',
    xhigh:  null,
  },
  gpt5_2plus: {
    off:     'none',
    minimal: 'minimal',
    low:     'low',
    medium:  'medium',
    high:    'high',
    xhigh:   'xhigh',
  },
  grok: {
    minimal: null,
    low:     'low',
    medium:  null,
    high:    'high',
    xhigh:   null,
  },
  kimi: {
    minimal: null,
    low:     'low',
    medium:  'medium',
    high:    'high',
    xhigh:   null,
  },
  doubao: {
    high: 'high',
  },
}

// ── Internal: model → ThinkingType classification ─────────────────────────────

/**
 * Classify a model into a ThinkingType based on provider + model id.
 * Kept intentionally simple: providers/ids are stable enough for direct matching.
 */
function classifyThinkingType(provider: string, modelId: string): ThinkingType {
  const id = modelId.toLowerCase()
  const prov = provider.toLowerCase()

  // ── Non-reasoning paths handled by other API formats (out of scope v1) ──
  if (prov === 'anthropic' || prov === 'gemini') return 'none'

  // ── Qwen (official DashScope + self-hosted models containing qwen/qwq) ──
  if (prov === 'qwen' || /qwen|qwq/i.test(id)) return 'qwen'

  // ── DeepSeek V4+ ──
  if (/deepseek[_-]v([4-9]|\d{2,})/i.test(id) || /deepseek-ai\/deepseek-r1/i.test(id)) return 'deepseek_v4'

  // ── OpenAI gpt-5.x family ──
  if (prov === 'openai' || prov === 'openai-compatible') {
    if (/gpt-5\.[2-9]|gpt-5\.[1-9]\d/.test(id)) return 'gpt5_2plus'
    if (/gpt-5\.1/.test(id)) return 'gpt5_1'
    if (/gpt-5/.test(id)) return 'gpt5'
    if (/^o\d/.test(id)) return 'o_series'
  }
  // o-series on other providers (e.g., Azure, OpenRouter)
  if (/^o\d/.test(id)) return 'o_series'

  // ── xAI Grok reasoning models ──
  if (prov === 'xai' && /grok-[34]/i.test(id) && /mini|4\b/i.test(id)) return 'grok'

  // ── Kimi thinking models ──
  if (prov === 'kimi' && /thinking/i.test(id)) return 'kimi'

  // ── Doubao seed reasoning ──
  if (prov === 'doubao' && /seed/i.test(id)) return 'doubao'

  // ── GLM (ZAI) — only boolean enable_thinking, same as Qwen ──
  if (prov === 'glm' || /glm[-_]/i.test(id)) return 'qwen'

  // ── SiliconFlow hosted reasoning models (DeepSeek R1 family) ──
  if (prov === 'siliconflow' && /r[1-9]/i.test(id)) return 'deepseek_v4'

  // ── OpenRouter: wrap by inner model id if known ──
  if (prov === 'openrouter') {
    if (/deepseek.*(v[4-9]|r\d)/i.test(id)) return 'deepseek_v4'
    return 'default'
  }

  // ── Self-hosted / unknown — heuristic from model name ──
  if (/qwen|qwq/i.test(id)) return 'qwen'
  if (/deepseek[_-]?r\d|deepseek[_-]?v[4-9]/i.test(id)) return 'deepseek_v4'
  if (/^o\d/i.test(id)) return 'o_series'

  // Only assign 'default' (reasoning bucket) when the model name itself
  // suggests thinking capability. Otherwise return 'none'.
  if (/reasoning|thinking|r1\b|r2\b|qwq|think/i.test(id)) return 'default'

  return 'none'
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the list of ThinkingLevel values the selector should show for a model.
 * An empty array means the model has no thinking support — hide the selector.
 *
 * Used by: UI (ChatStatusBar) to render the level picker.
 */
export function getSupportedThinkingLevels(provider: string, modelId: string): ThinkingLevel[] {
  const type = classifyThinkingType(provider, modelId)
  return TYPE_LEVELS[type]
}

/**
 * Returns whether the model/provider combo is a reasoning-capable model
 * on the openai-completions path. (anthropic/gemini always return false here.)
 *
 * Used by: buildPiModel to set `PiModel.reasoning`.
 * Replaces the ad-hoc inferReasoning logic in llm-builder.ts.
 */
export function isReasoningModel(provider: string, modelId: string): boolean {
  return classifyThinkingType(provider, modelId) !== 'none'
}

/**
 * PiModel compat fragment that makes the chosen thinkingLevel actually reach
 * the request body. Must be spread into the PiModel returned by buildPiModel.
 *
 * Used by: buildPiModel (openai-completions branch).
 */
export interface ThinkingCompat {
  thinkingFormat?: 'qwen' | 'deepseek'  // provider-specific injection format
  supportsReasoningEffort?: true         // OpenAI-style reasoning_effort param
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>
}

export function getThinkingCompat(provider: string, modelId: string): ThinkingCompat {
  const type = classifyThinkingType(provider, modelId)

  if (type === 'none') return {}

  if (type === 'qwen') {
    // Qwen/GLM: pi-ai injects enable_thinking boolean.
    // 'off' → reasoningEffort=undefined → enable_thinking:false
    // 'high' → reasoningEffort='high' → enable_thinking:true
    return { thinkingFormat: 'qwen' }
  }

  if (type === 'deepseek_v4') {
    // DeepSeek requires thinkingFormat:'deepseek' so pi-ai sends:
    //   thinking:{type:"disabled"} when reasoningEffort=undefined (off)
    //   thinking:{type:"enabled"} + reasoning_effort when set
    return {
      thinkingFormat: 'deepseek',
      thinkingLevelMap: { high: 'high', xhigh: 'max', minimal: null, low: null, medium: null },
    }
  }

  // All remaining types use OpenAI-style reasoning_effort.
  const compat: ThinkingCompat = { supportsReasoningEffort: true }
  const levelMap = TYPE_LEVEL_MAP[type]
  if (levelMap) {
    compat.thinkingLevelMap = levelMap as Partial<Record<ThinkingLevel, string | null>>
  }
  return compat
}
