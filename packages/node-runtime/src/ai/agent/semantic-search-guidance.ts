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
      '检索本对话历史时按需选择工具：',
      '需要证据链 / 事件次数统计 / 是否发生过 / “我们有没有/去过几次”这类历史事实判断时，优先调用 retrieve_chat_evidence（它会综合语义与关键词并给出可计入/不计入/不确定的证据）。',
      '只是想找语义相关片段时，调用 semantic_search_current_chat。',
      '只需按精确关键词字面查找时，用 search_messages。',
      '寒暄、写作、解释通用概念等不依赖历史证据的问题不要调用检索工具。',
    ].join('')
  }
  return [
    'Choose a retrieval tool by need when searching THIS conversation history: ',
    'for evidence chains, event counts, whether something happened, or "how many times / did we ever" historical fact judgments, prefer retrieve_chat_evidence (it combines semantic + keyword retrieval and returns included/excluded/uncertain evidence). ',
    'For finding semantically related excerpts only, call semantic_search_current_chat. ',
    'For exact literal keyword lookup, use search_messages. ',
    'Do not call retrieval tools for greetings, writing, or explaining general concepts that need no historical evidence.',
  ].join('')
}
