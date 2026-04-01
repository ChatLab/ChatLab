/**
 * 内置脱敏规则库
 * 按 locale 分组，支持通用规则和地区特定规则
 */
import type { DesensitizeRule } from './types'

export type { DesensitizeRule }

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
  },
  {
    id: 'cn_id_card',
    label: 'desensitize.rules.cn_id_card',
    pattern: '(?<!\\d)\\d{17}[\\dXx](?!\\d)',
    replacement: '[身份证]',
    enabled: true,
    builtin: true,
    locales: ['zh-CN'],
  },
  {
    id: 'cn_bank_card',
    label: 'desensitize.rules.cn_bank_card',
    pattern: '(?<!\\d)\\d{16,19}(?!\\d)',
    replacement: '[银行卡]',
    enabled: false,
    builtin: true,
    locales: ['zh-CN'],
  },
  {
    id: 'cn_landline',
    label: 'desensitize.rules.cn_landline',
    pattern: '(?<!\\d)0\\d{2,3}-?\\d{7,8}(?!\\d)',
    replacement: '[座机号]',
    enabled: false,
    builtin: true,
    locales: ['zh-CN'],
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
  },
  {
    id: 'us_phone',
    label: 'desensitize.rules.us_phone',
    pattern: '(?<!\\d)(?:\\+?1[-\\s.]?)?\\(?\\d{3}\\)?[-\\s.]?\\d{3}[-\\s.]?\\d{4}(?!\\d)',
    replacement: '[Phone]',
    enabled: true,
    builtin: true,
    locales: ['en-US'],
  },
  {
    id: 'us_drivers_license',
    label: 'desensitize.rules.us_drivers_license',
    pattern: '(?<![A-Z])\\b[A-Z]\\d{7,8}\\b',
    replacement: "[Driver's License]",
    enabled: false,
    builtin: true,
    locales: ['en-US'],
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
  },
  {
    id: 'jp_my_number',
    label: 'desensitize.rules.jp_my_number',
    pattern: '(?<!\\d)\\d{4}\\s?\\d{4}\\s?\\d{4}(?!\\d)',
    replacement: '[マイナンバー]',
    enabled: false,
    builtin: true,
    locales: ['ja-JP'],
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
  },
  {
    id: 'kr_rrn',
    label: 'desensitize.rules.kr_rrn',
    pattern: '(?<!\\d)\\d{6}-[1-4]\\d{6}(?!\\d)',
    replacement: '[주민번호]',
    enabled: true,
    builtin: true,
    locales: ['ko-KR'],
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
  },
  {
    id: 'bearer_token',
    label: 'desensitize.rules.bearer_token',
    pattern: 'Bearer\\s+[A-Za-z0-9\\-._~+/]+=*',
    replacement: 'Bearer [Token]',
    enabled: true,
    builtin: true,
    locales: [],
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
  },
  {
    id: 'credit_card',
    label: 'desensitize.rules.credit_card',
    pattern:
      '(?<!\\d)(?:4\\d{3}|5[1-5]\\d{2}|3[47]\\d{2}|6(?:011|5\\d{2}))[-\\s.]?\\d{4}[-\\s.]?\\d{4}[-\\s.]?\\d{4}(?!\\d)',
    replacement: '[Credit Card]',
    enabled: false,
    builtin: true,
    locales: [],
  },
  {
    id: 'ipv4',
    label: 'desensitize.rules.ipv4',
    pattern:
      '(?<!\\d)(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)(?!\\d)',
    replacement: '[IP]',
    enabled: false,
    builtin: true,
    locales: [],
  },
  {
    id: 'url',
    label: 'desensitize.rules.url',
    pattern: 'https?://[^\\s<>"]+',
    replacement: '[URL]',
    enabled: false,
    builtin: true,
    locales: [],
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

/**
 * 合并新 locale 的规则到现有规则列表
 * 不重复添加已有 id，不修改已有规则的 enabled 状态
 */
export function mergeRulesForLocale(existing: DesensitizeRule[], locale: string): DesensitizeRule[] {
  const existingIds = new Set(existing.map((r) => r.id))
  const newRules = BUILTIN_DESENSITIZE_RULES.filter(
    (rule) => !existingIds.has(rule.id) && (rule.locales.length === 0 || rule.locales.includes(locale))
  ).map((rule) => ({ ...rule }))

  return [...existing, ...newRules]
}
