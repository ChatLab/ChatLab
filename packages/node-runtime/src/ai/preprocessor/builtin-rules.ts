/**
 * 内置脱敏规则库
 * 按 locale 分组，支持通用规则和地区特定规则
 */
import type { DesensitizeRule } from './types'

export const DESENSITIZE_RULES_SCHEMA_VERSION = 2

export interface DesensitizeRuleGroup {
  id: string
  label: string
  description: string
  locales: string[]
  order: number
  rules: DesensitizeRule[]
}

const GROUP_DEFS: Array<Omit<DesensitizeRuleGroup, 'rules'>> = [
  {
    id: 'credentials',
    label: 'desensitize.groups.credentials',
    description: 'desensitize.groups.credentials_desc',
    locales: [],
    order: 10,
  },
  {
    id: 'global_contact',
    label: 'desensitize.groups.global_contact',
    description: 'desensitize.groups.global_contact_desc',
    locales: [],
    order: 20,
  },
  {
    id: 'global_financial',
    label: 'desensitize.groups.global_financial',
    description: 'desensitize.groups.global_financial_desc',
    locales: [],
    order: 30,
  },
  {
    id: 'global_network',
    label: 'desensitize.groups.global_network',
    description: 'desensitize.groups.global_network_desc',
    locales: [],
    order: 40,
  },
  {
    id: 'region_cn',
    label: 'desensitize.groups.region_cn',
    description: 'desensitize.groups.region_cn_desc',
    locales: ['zh-CN'],
    order: 50,
  },
  {
    id: 'region_us',
    label: 'desensitize.groups.region_us',
    description: 'desensitize.groups.region_us_desc',
    locales: ['en-US'],
    order: 50,
  },
  {
    id: 'region_jp',
    label: 'desensitize.groups.region_jp',
    description: 'desensitize.groups.region_jp_desc',
    locales: ['ja-JP'],
    order: 50,
  },
  {
    id: 'region_kr',
    label: 'desensitize.groups.region_kr',
    description: 'desensitize.groups.region_kr_desc',
    locales: ['ko-KR'],
    order: 50,
  },
]

export const BUILTIN_DESENSITIZE_RULES: DesensitizeRule[] = [
  // ==================== 中国 (zh-CN) ====================
  {
    id: 'cn_phone',
    label: 'desensitize.rules.cn_phone',
    pattern: '(?<!\\d)1[3-9]\\d{9}(?!\\d)',
    replacement: '[手机号]',
    enabled: true,
    builtin: true,
    locales: ['zh-CN'],
    group: 'region_cn',
  },
  {
    id: 'cn_id_card',
    label: 'desensitize.rules.cn_id_card',
    pattern: '(?<!\\d)\\d{17}[\\dXx](?!\\d)',
    replacement: '[身份证]',
    enabled: true,
    builtin: true,
    locales: ['zh-CN'],
    group: 'region_cn',
  },
  {
    id: 'cn_bank_card',
    label: 'desensitize.rules.cn_bank_card',
    pattern: '(?<!\\d)\\d{16,19}(?!\\d)',
    replacement: '[银行卡]',
    enabled: true,
    builtin: true,
    locales: ['zh-CN'],
    group: 'region_cn',
  },
  {
    id: 'cn_landline',
    label: 'desensitize.rules.cn_landline',
    pattern: '(?<!\\d)0\\d{2,3}-?\\d{7,8}(?!\\d)',
    replacement: '[座机号]',
    enabled: true,
    builtin: true,
    locales: ['zh-CN'],
    group: 'region_cn',
  },

  // ==================== 美国 (en-US) ====================
  {
    id: 'us_ssn',
    label: 'desensitize.rules.us_ssn',
    pattern: '(?<!\\d)\\d{3}-\\d{2}-\\d{4}(?!\\d)',
    replacement: '[SSN]',
    enabled: true,
    builtin: true,
    locales: ['en-US'],
    group: 'region_us',
  },
  {
    id: 'us_phone',
    label: 'desensitize.rules.us_phone',
    pattern: '(?<!\\d)(?:\\+?1[-\\s.]?)?\\(?\\d{3}\\)?[-\\s.]?\\d{3}[-\\s.]?\\d{4}(?!\\d)',
    replacement: '[Phone]',
    enabled: true,
    builtin: true,
    locales: ['en-US'],
    group: 'region_us',
  },
  {
    id: 'us_drivers_license',
    label: 'desensitize.rules.us_drivers_license',
    pattern: '(?<![A-Z])\\b[A-Z]\\d{7,8}\\b',
    replacement: "[Driver's License]",
    enabled: true,
    builtin: true,
    locales: ['en-US'],
    group: 'region_us',
  },

  // ==================== 日本 (ja-JP) ====================
  {
    id: 'jp_phone',
    label: 'desensitize.rules.jp_phone',
    pattern: '(?<!\\d)0[789]0-?\\d{4}-?\\d{4}(?!\\d)',
    replacement: '[電話番号]',
    enabled: true,
    builtin: true,
    locales: ['ja-JP'],
    group: 'region_jp',
  },
  {
    id: 'jp_my_number',
    label: 'desensitize.rules.jp_my_number',
    pattern: '(?<!\\d)\\d{4}\\s?\\d{4}\\s?\\d{4}(?!\\d)',
    replacement: '[マイナンバー]',
    enabled: true,
    builtin: true,
    locales: ['ja-JP'],
    group: 'region_jp',
  },

  // ==================== 韩国 (ko-KR) ====================
  {
    id: 'kr_phone',
    label: 'desensitize.rules.kr_phone',
    pattern: '(?<!\\d)01[016789]-?\\d{3,4}-?\\d{4}(?!\\d)',
    replacement: '[전화번호]',
    enabled: true,
    builtin: true,
    locales: ['ko-KR'],
    group: 'region_kr',
  },
  {
    id: 'kr_rrn',
    label: 'desensitize.rules.kr_rrn',
    pattern: '(?<!\\d)\\d{6}-[1-4]\\d{6}(?!\\d)',
    replacement: '[주민번호]',
    enabled: true,
    builtin: true,
    locales: ['ko-KR'],
    group: 'region_kr',
  },

  // ==================== 凭据 / Token (所有语言) ====================
  {
    id: 'api_key_prefix',
    label: 'desensitize.rules.api_key_prefix',
    pattern: '\\b(?:sk-|pk_(?:live|test)_|ghp_|gho_|ghs_|ghu_|glpat-|xoxb-|xoxp-|AKIA)[A-Za-z0-9_\\-]{10,}\\b',
    replacement: '[API Key]',
    enabled: true,
    builtin: true,
    locales: [],
    group: 'credentials',
  },
  {
    id: 'bearer_token',
    label: 'desensitize.rules.bearer_token',
    pattern: 'Bearer\\s+[A-Za-z0-9\\-._~+/]+=*',
    replacement: 'Bearer [Token]',
    enabled: true,
    builtin: true,
    locales: [],
    group: 'credentials',
  },

  // ==================== 通用 (所有语言) ====================
  {
    id: 'email',
    label: 'desensitize.rules.email',
    pattern: '[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}',
    replacement: '[Email]',
    enabled: true,
    builtin: true,
    locales: [],
    group: 'global_contact',
  },
  {
    id: 'credit_card',
    label: 'desensitize.rules.credit_card',
    pattern:
      '(?<!\\d)(?:4\\d{3}|5[1-5]\\d{2}|3[47]\\d{2}|6(?:011|5\\d{2}))[-\\s.]?\\d{4}[-\\s.]?\\d{4}[-\\s.]?\\d{4}(?!\\d)',
    replacement: '[Credit Card]',
    enabled: true,
    builtin: true,
    locales: [],
    group: 'global_financial',
  },
  {
    id: 'ipv4',
    label: 'desensitize.rules.ipv4',
    pattern:
      '(?<!\\d)(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)(?!\\d)',
    replacement: '[IP]',
    enabled: true,
    builtin: true,
    locales: [],
    group: 'global_network',
  },
  {
    id: 'url',
    label: 'desensitize.rules.url',
    pattern: 'https?://[^\\s<>"]+',
    replacement: '[URL]',
    enabled: true,
    builtin: true,
    locales: [],
    group: 'global_network',
  },
]

/**
 * 获取指定 locale 的默认规则（当前 locale 特定 + 通用规则）
 */
export function getDefaultRulesForLocale(locale: string): DesensitizeRule[] {
  return BUILTIN_DESENSITIZE_RULES.filter((rule) => rule.locales.length === 0 || rule.locales.includes(locale)).map(
    (rule) => ({ ...rule })
  )
}

export function applyDesensitizeRuleOverrides(
  rules: DesensitizeRule[],
  overrides: Record<string, boolean> = {}
): DesensitizeRule[] {
  return rules.map((rule) => ({
    ...rule,
    enabled: overrides[rule.id] ?? rule.enabled,
  }))
}

export function getRuleGroupsForLocale(
  locale: string,
  overrides: Record<string, boolean> = {}
): DesensitizeRuleGroup[] {
  const rules = applyDesensitizeRuleOverrides(getDefaultRulesForLocale(locale), overrides)
  const rulesByGroup = new Map<string, DesensitizeRule[]>()
  for (const rule of rules) {
    if (!rule.group) continue
    const groupRules = rulesByGroup.get(rule.group) ?? []
    groupRules.push(rule)
    rulesByGroup.set(rule.group, groupRules)
  }

  return GROUP_DEFS.filter((group) => {
    if (group.locales.length > 0 && !group.locales.includes(locale)) return false
    return (rulesByGroup.get(group.id)?.length ?? 0) > 0
  })
    .map((group) => ({
      ...group,
      rules: rulesByGroup.get(group.id) ?? [],
    }))
    .sort((a, b) => a.order - b.order)
}

/**
 * 合并新 locale 的规则到现有规则列表
 */
export function mergeRulesForLocale(
  existing: DesensitizeRule[],
  locale: string,
  overrides: Record<string, boolean> = {}
): DesensitizeRule[] {
  const customRules = existing.filter((rule) => !rule.builtin)
  const builtinRules = applyDesensitizeRuleOverrides(getDefaultRulesForLocale(locale), overrides)

  return [...builtinRules, ...customRules]
}
