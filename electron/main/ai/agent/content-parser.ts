/**
 * Agent 内容解析工具
 * 处理思考标签提取和工具调用标签清理
 */

const THINK_TAGS = ['think', 'analysis', 'reasoning', 'reflection', 'thought', 'thinking']

/**
 * 从文本内容中提取思考类标签内容
 */
export function extractThinkingContent(content: string): { thinking: string; cleanContent: string } {
  if (!content) {
    return { thinking: '', cleanContent: '' }
  }

  const tagPattern = THINK_TAGS.join('|')
  const thinkRegex = new RegExp(`<(${tagPattern})>([\\s\\S]*?)<\\/\\1>`, 'gi')
  const thinkingParts: string[] = []
  let cleanContent = content

  const matches = content.matchAll(thinkRegex)
  for (const match of matches) {
    const thinkText = match[2].trim()
    if (thinkText) {
      thinkingParts.push(thinkText)
    }
    cleanContent = cleanContent.replace(match[0], '')
  }

  return { thinking: thinkingParts.join('\n').trim(), cleanContent: cleanContent.trim() }
}

/**
 * 清理 <tool_call> 标签内容，避免将工具调用文本展示给用户
 */
export function stripToolCallTags(content: string): string {
  return content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim()
}
