export interface SelectableChat {
  chatId: string
  messageCount: number
}

export function createDefaultSelectedChatIds(chats: readonly SelectableChat[]): Set<string> {
  return new Set(chats.filter((chat) => chat.messageCount > 0).map((chat) => chat.chatId))
}

export function toggleSelectedChatId(selected: ReadonlySet<string>, chatId: string): Set<string> {
  const next = new Set(selected)
  if (next.has(chatId)) {
    next.delete(chatId)
  } else {
    next.add(chatId)
  }
  return next
}

export function toggleAllChatIds(selected: ReadonlySet<string>, chats: readonly SelectableChat[]): Set<string> {
  const allSelected = chats.length > 0 && chats.every((chat) => selected.has(chat.chatId))
  return allSelected ? new Set() : new Set(chats.map((chat) => chat.chatId))
}
