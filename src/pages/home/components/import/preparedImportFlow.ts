import type { ImportResult } from '@/services'

export interface PreparedBatchChat {
  chatId: string
  name: string
}

export interface PreparedBatchImportResult {
  total: number
  success: number
  failed: number
  cancelled: number
  items: Array<{
    chat: PreparedBatchChat
    status: 'success' | 'failed' | 'cancelled'
    sessionId?: string
    error?: string
    importMode?: ImportResult['importMode']
    matchedBy?: ImportResult['matchedBy']
    newMessageCount?: number
    duplicateCount?: number
  }>
}

type PreparedChatImportResult = Pick<
  ImportResult,
  'success' | 'sessionId' | 'error' | 'importMode' | 'matchedBy' | 'newMessageCount' | 'duplicateCount'
>

export async function runPreparedImportBatch(options: {
  sourceId: string
  chats: PreparedBatchChat[]
  importChat: (sourceId: string, chatId: string) => Promise<PreparedChatImportResult>
  releaseSource: (sourceId: string) => Promise<void>
  isCancelled?: () => boolean
  onItemStart?: (chat: PreparedBatchChat, index: number) => void
  onItemComplete?: (chat: PreparedBatchChat, index: number, result: PreparedChatImportResult) => void
}): Promise<PreparedBatchImportResult> {
  const items: PreparedBatchImportResult['items'] = []

  try {
    for (let index = 0; index < options.chats.length; index++) {
      const chat = options.chats[index]
      if (options.isCancelled?.()) {
        for (const remaining of options.chats.slice(index)) {
          items.push({ chat: remaining, status: 'cancelled' })
        }
        break
      }

      options.onItemStart?.(chat, index)
      try {
        const result = await options.importChat(options.sourceId, chat.chatId)
        options.onItemComplete?.(chat, index, result)
        items.push({
          chat,
          status: result.success ? 'success' : 'failed',
          sessionId: result.sessionId,
          error: result.error,
          importMode: result.importMode,
          matchedBy: result.matchedBy,
          newMessageCount: result.newMessageCount,
          duplicateCount: result.duplicateCount,
        })
      } catch (error) {
        const result = { success: false, error: error instanceof Error ? error.message : String(error) }
        options.onItemComplete?.(chat, index, result)
        items.push({ chat, status: 'failed', error: result.error })
      }
    }
  } finally {
    try {
      await options.releaseSource(options.sourceId)
    } catch {
      // Source 会由 TTL 或进程退出继续清理，释放失败不应覆盖已完成的导入结果。
    }
  }

  return {
    total: options.chats.length,
    success: items.filter((item) => item.status === 'success').length,
    failed: items.filter((item) => item.status === 'failed').length,
    cancelled: items.filter((item) => item.status === 'cancelled').length,
    items,
  }
}
