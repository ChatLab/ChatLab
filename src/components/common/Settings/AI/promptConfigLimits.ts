export const MAX_TOOL_RESULT_PERCENT = 80
export const MIN_TOOL_RESULT_PERCENT = 10
export const DEFAULT_TOOL_RESULT_PERCENT = 50

export function normalizeMaxToolResultPercent(value: number): number {
  return Math.max(MIN_TOOL_RESULT_PERCENT, Math.min(MAX_TOOL_RESULT_PERCENT, value || DEFAULT_TOOL_RESULT_PERCENT))
}
