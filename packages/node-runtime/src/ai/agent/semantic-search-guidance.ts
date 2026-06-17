/**
 * 语义检索工具引导语
 *
 * 仅当当前会话语义索引可检索、工具被暴露给 LLM 时，由两端 runner 注入 system prompt。
 * 引导模型在需要历史证据时调用 semantic_search_current_chat，避免寒暄/写作类问题无谓检索。
 */

function isChinese(locale?: string): boolean {
  return (locale ?? '').toLowerCase().startsWith('zh')
}

export function buildSemanticSearchGuidance(locale?: string): string {
  if (isChinese(locale)) {
    return [
      '当需要确认本对话历史中的具体事实、人物、地点、事件或过往提及时，调用 semantic_search_current_chat 检索相关片段。',
      '寒暄、写作、解释通用概念等不依赖历史证据的问题不要调用该工具。',
    ].join('')
  }
  return [
    'When you need concrete facts, people, places, events, or past mentions from THIS conversation history, ',
    'call semantic_search_current_chat to retrieve relevant excerpts. ',
    'Do not call it for greetings, writing, or explaining general concepts that need no historical evidence.',
  ].join('')
}
