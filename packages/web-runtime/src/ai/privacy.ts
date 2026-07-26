import type { RawMessage } from '@openchatlab/tools'

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<EMAIL>'],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/g, '<PHONE>'],
  [/(?<!\d)\d{17}[\dXx](?!\d)/g, '<ID_CARD>'],
  [/(?<!\d)(?:\d[ -]?){16,19}(?!\d)/g, '<BANK_CARD>'],
  [/(?:sk|pk|api)[-_][A-Za-z0-9_-]{16,}/gi, '<API_KEY>'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, 'Bearer <TOKEN>'],
]

export function redactSensitiveText(value: string): string {
  return SENSITIVE_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

export function redactMessages(messages: RawMessage[]): RawMessage[] {
  return messages.map((message) => ({
    ...message,
    content: message.content ? redactSensitiveText(message.content) : message.content,
  }))
}

export function sanitizeToolValue<T>(value: T): T {
  if (typeof value === 'string') return redactSensitiveText(value) as T
  if (Array.isArray(value)) return value.map((item) => sanitizeToolValue(item)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeToolValue(item)])
    ) as T
  }
  return value
}
