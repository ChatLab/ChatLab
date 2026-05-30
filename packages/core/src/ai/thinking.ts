/**
 * Thinking / Reasoning level configuration for AI models.
 *
 * Inspired by cherry-studio's MODEL_SUPPORTED_REASONING_EFFORT table.
 * This module is the single source of truth for:
 *   - which models support thinking and at what granularity
 *   - what `compat` fields pi-ai needs to actually inject the right request params
 *
 * Scope: openai-completions API path only.
 * anthropic-messages / google-generative-ai are out of scope for this version.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * ThinkingLevel values the UI selector can display.
 * - 'default': no reasoning params sent — rely on model's native default behavior
 * - 'off': explicitly disable reasoning
 * - 'auto': let the model flexibly decide reasoning intensity
 * - others: specific intensity levels
 */
export type ThinkingLevel = 'default' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'auto'

/** Used internally to categorise a model into a thinking behaviour group. */
type ThinkingType =
  | 'none' // model is not a reasoning model
  | 'qwen' // Qwen/GLM-family: boolean enable_thinking (off/on)
  | 'deepseek_v4' // DeepSeek V4+: thinkingFormat:'deepseek', off/high/xhigh
  | 'deepseek_hybrid' // DeepSeek V3.x hybrid inference: supports auto
  | 'o_series' // OpenAI o1/o3: can't disable thinking; low/medium/high only
  | 'gpt5' // OpenAI gpt-5 base: can't disable; minimal/low/medium/high
  | 'gpt5_1' // OpenAI gpt-5.1: off→none supported; off/low/medium/high
  | 'gpt5_2plus' // OpenAI gpt-5.2+: off→none + xhigh; full range
  | 'grok' // xAI grok: can't disable; low/high only
  | 'kimi' // Kimi thinking: off/auto/low/medium/high
  | 'doubao' // Doubao seed reasoning: off/auto/high
  | 'hunyuan' // Hunyuan: enable_thinking boolean, similar to qwen
  | 'gemini' // Gemini 2.5+: thinking level via Google API (off/low/medium/high)
  | 'default' // generic reasoning: off / low / medium / high

// ── Internal: per-type level tables ──────────────────────────────────────────

/** UI options for each type — what the selector will show. */
const TYPE_LEVELS: Record<ThinkingType, ThinkingLevel[]> = {
  none: [],
  qwen: ['default', 'off', 'high'],
  deepseek_v4: ['default', 'off', 'high', 'xhigh'],
  deepseek_hybrid: ['default', 'off', 'auto'],
  o_series: ['default', 'low', 'medium', 'high'],
  gpt5: ['default', 'minimal', 'low', 'medium', 'high'],
  gpt5_1: ['default', 'off', 'low', 'medium', 'high'],
  gpt5_2plus: ['default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  grok: ['default', 'low', 'high'],
  kimi: ['default', 'off', 'auto', 'low', 'medium', 'high'],
  doubao: ['default', 'off', 'auto', 'high'],
  hunyuan: ['default', 'off', 'high'],
  gemini: ['default', 'off', 'low', 'medium', 'high'],
  default: ['default', 'off', 'low', 'medium', 'high'],
}

/**
 * thinkingLevelMap entries for models that use `reasoning_effort`.
 * `null` means that level is explicitly not supported.
 * `undefined` (key absent) means pass the level string verbatim.
 * Matches pi-ai's convention in models.generated.js.
 */
const TYPE_LEVEL_MAP: Partial<Record<ThinkingType, Partial<Record<ThinkingLevel, string | null>>>> = {
  gpt5: {
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
  },
  gpt5_1: {
    off: 'none',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: null,
  },
  gpt5_2plus: {
    off: 'none',
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
  },
  grok: {
    minimal: null,
    low: 'low',
    medium: null,
    high: 'high',
    xhigh: null,
  },
  kimi: {
    off: 'none',
    auto: 'auto',
    minimal: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: null,
  },
  doubao: {
    off: null,
    auto: 'auto',
    high: 'high',
  },
  deepseek_hybrid: {
    off: null,
    auto: 'auto',
    high: 'high',
  },
}

// ── Internal: model → ThinkingType classification ─────────────────────────────

/**
 * Broad regex matching common reasoning model naming patterns.
 * Used as a fallback when no specific provider/model rule matches.
 * Excludes explicit '-non-reasoning' variants.
 */
const REASONING_FALLBACK_REGEX =
  /^(?!.*-non-reasoning\b)(o\d+(?:-[\w-]+)?|.*\b(?:reasoning|reasoner|thinking|think)\b.*|.*-[rR]\d+.*|.*\bqwq(?:-[\w-]+)?\b.*|.*\bhunyuan-t1(?:-[\w-]+)?\b.*|.*\bgrok-(?:3-mini|4|4-fast|build)(?:-[\w-]+)?\b.*)$/i

/**
 * Classify a model into a ThinkingType based on provider + model id.
 */
function classifyThinkingType(provider: string, modelId: string): ThinkingType {
  const id = modelId.toLowerCase()
  const prov = provider.toLowerCase()

  // ── Explicit non-reasoning variants ──
  if (id.includes('-non-reasoning')) return 'none'

  // ── Anthropic uses different API format (out of scope) ──
  if (prov === 'anthropic') return 'none'

  // ── Gemini 2.5+ reasoning models (via Google Generative AI API) ──
  if (prov === 'gemini') {
    if (/gemini-(?:2\.5|3(?:\.\d+)?-(?:flash|pro)|flash-latest|pro-latest)/i.test(id)) return 'gemini'
    return 'none'
  }

  // ── Qwen (official DashScope + self-hosted models containing qwen/qwq) ──
  if (prov === 'qwen' || /\bqwen|qwq/i.test(id)) return 'qwen'

  // ── DeepSeek V4+ ──
  if (/deepseek[_-]v([4-9]|\d{2,})/i.test(id) || /deepseek-ai\/deepseek-r1/i.test(id)) return 'deepseek_v4'

  // ── DeepSeek V3.x hybrid inference (deepseek-chat, deepseek-v3.x) ──
  if (/deepseek[_-]chat|deepseek[_-]v3/i.test(id)) return 'deepseek_hybrid'

  // ── OpenAI gpt-5.x family ──
  if (prov === 'openai' || prov === 'openai-compatible') {
    if (/gpt-5\.[2-9]|gpt-5\.[1-9]\d/.test(id)) return 'gpt5_2plus'
    if (/gpt-5\.1/.test(id)) return 'gpt5_1'
    if (/gpt-5/.test(id)) return 'gpt5'
    if (/^o\d/.test(id)) return 'o_series'
  }
  // o-series on other providers (e.g., Azure, OpenRouter)
  if (/^o\d/.test(id)) return 'o_series'

  // ── xAI Grok reasoning models (grok-3-mini, grok-4, grok-4-fast, grok-build) ──
  if (/\bgrok-(?:3-mini|4|4-fast|build)\b/i.test(id)) return 'grok'

  // ── Kimi thinking models (k2-thinking, k2.5+, k3+) ──
  if (/\bkimi-k(?:2-thinking|2\.[5-9]|[3-9])/i.test(id)) return 'kimi'
  if (prov === 'kimi' && /thinking/i.test(id)) return 'kimi'

  // ── Doubao seed reasoning ──
  if (/\bdoubao-.*seed/i.test(id) || (prov === 'doubao' && /seed/i.test(id))) return 'doubao'

  // ── Hunyuan reasoning models ──
  if (/\bhunyuan-(?:t1|a13b)/i.test(id)) return 'hunyuan'

  // ── GLM (ZAI) — glm-5, glm-4.5/4.6/4.7, glm-z1, glm-zero-preview ──
  if (prov === 'glm' || /\bglm-?(?:5|4\.[5-7]|z1|zero)/i.test(id)) return 'qwen'

  // ── SiliconFlow hosted reasoning models (DeepSeek R1 family) ──
  if (prov === 'siliconflow' && /r[1-9]/i.test(id)) return 'deepseek_v4'

  // ── OpenRouter: classify by inner model id ──
  if (prov === 'openrouter') {
    if (/deepseek.*(v[4-9]|r\d)/i.test(id)) return 'deepseek_v4'
    if (/deepseek[_-]?(chat|v3)/i.test(id)) return 'deepseek_hybrid'
    if (/\bgrok-(?:3-mini|4|4-fast|build)\b/i.test(id)) return 'grok'
    if (/\bkimi-k(?:2-thinking|2\.[5-9]|[3-9])/i.test(id)) return 'kimi'
    if (REASONING_FALLBACK_REGEX.test(id)) return 'default'
    return 'none'
  }

  // ── Models using thinking:{type:'disabled'/'enabled'} format (same as DeepSeek) ──
  if (/\bmimo-v2/i.test(id)) return 'deepseek_hybrid'
  if (/\bminimax-m[123]/i.test(id)) return 'deepseek_hybrid'
  if (/\bseed-oss/i.test(id)) return 'deepseek_hybrid'

  // ── Known reasoning model families → 'default' bucket (supportsReasoningEffort) ──
  if (/\bbaichuan-m[23]/i.test(id)) return 'default'
  if (/\bmagistral/i.test(id)) return 'default'
  if (/\bmistral-small-2603/i.test(id)) return 'default'
  if (/\bstep-(?:3|r1-v-mini)/i.test(id)) return 'default'
  if (/\bgemma-?4/i.test(id)) return 'default'
  if (/\bpangu-pro-moe/i.test(id)) return 'default'
  if (/\bsonar-deep-research/i.test(id)) return 'default'
  if (/\bring-(?:1t|mini|flash)/i.test(id)) return 'default'

  // ── Self-hosted / unknown — heuristic from model name ──
  if (/\bqwen|qwq/i.test(id)) return 'qwen'
  if (/deepseek[_-]?r\d|deepseek[_-]?v[4-9]/i.test(id)) return 'deepseek_v4'
  if (/^o\d/i.test(id)) return 'o_series'

  // Broad fallback: match common reasoning naming patterns
  if (REASONING_FALLBACK_REGEX.test(id)) return 'default'

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
  thinkingFormat?: 'qwen' | 'deepseek'
  supportsReasoningEffort?: true
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>
}

export function getThinkingCompat(provider: string, modelId: string): ThinkingCompat {
  const type = classifyThinkingType(provider, modelId)

  if (type === 'none') return {}

  // Gemini uses pi-ai's native Google provider; no compat fields needed.
  if (type === 'gemini') return {}

  if (type === 'qwen' || type === 'hunyuan') {
    return { thinkingFormat: 'qwen' }
  }

  if (type === 'deepseek_v4') {
    return {
      thinkingFormat: 'deepseek',
      thinkingLevelMap: { high: 'high', xhigh: 'max', minimal: null, low: null, medium: null },
    }
  }

  if (type === 'deepseek_hybrid') {
    return {
      thinkingFormat: 'deepseek',
      thinkingLevelMap: { auto: 'auto', high: 'high', minimal: null, low: null, medium: null, xhigh: null },
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
