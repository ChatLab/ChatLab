/**
 * Embedding 输入文本处理（纯函数）
 */

/** 给 query 加模型 queryInstruction 前缀；document 不调用此函数 */
export function applyQueryInstruction(instruction: string, query: string): string {
  const trimmed = instruction.trim()
  if (!trimmed) return query
  if (trimmed.endsWith(':') || trimmed.endsWith('：')) return `${trimmed}${query}`
  return `Instruct: ${trimmed}\nQuery: ${query}`
}

/** 按字符上限截断文本；maxChars 未提供或文本更短时原样返回 */
export function clampTextChars(text: string, maxChars?: number): string {
  if (maxChars === undefined || text.length <= maxChars) return text
  return text.slice(0, maxChars)
}
