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
      '想盘点或归纳某类话题、列举“聊过哪些X / 有哪些 / 都聊过什么 / 提到过哪些 / 喜欢什么”，或查找语义相关片段时，调用 semantic_search_current_chat 做向量检索：一次检索即可召回语义相关片段，覆盖未出现字面关键词的内容；不要用多轮 search_messages 逐个猜测关键词穷举。',
      '只有在已知确切字面词、原话、特定发送者或时间范围时，才用 search_messages 精确查找。',
      '寒暄、写作、解释通用概念等不依赖历史证据的问题不要调用检索工具。',
    ].join('')
  }
  return [
    'Choose a retrieval tool by need when searching THIS conversation history: ',
    'for evidence chains, event counts, whether something happened, or "how many times / did we ever" historical fact judgments, prefer retrieve_chat_evidence (it combines semantic + keyword retrieval and returns included/excluded/uncertain evidence). ',
    'To inventory or summarize a topic, enumerate "what X did we discuss / which ones / what did we talk about / what do we like", or find semantically related excerpts, call semantic_search_current_chat (vector search): a single search recalls related excerpts including ones without the literal keyword — do NOT brute-force many rounds of search_messages guessing keywords. ',
    'Use search_messages only when you already know the exact literal word, quote, specific sender, or time range. ',
    'Do not call retrieval tools for greetings, writing, or explaining general concepts that need no historical evidence.',
  ].join('')
}
