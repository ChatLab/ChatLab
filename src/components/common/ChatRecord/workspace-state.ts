export type ChatRecordIndexState = 'loading' | 'ready' | 'missing' | 'error'

export type ChatRecordIndexAction = 'generate' | 'retry' | null

/**
 * Keep destructive index generation exclusive to a confirmed missing state.
 * Read failures must only offer a retry so existing summaries remain untouched.
 */
export function resolveChatRecordIndexAction(state: ChatRecordIndexState): ChatRecordIndexAction {
  if (state === 'missing') return 'generate'
  if (state === 'error') return 'retry'
  return null
}
