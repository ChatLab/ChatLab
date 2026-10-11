export interface MemberAliasUpdate {
  sessionId: string
  memberId: number
  aliases: string[]
}

type MemberAliasListener = (update: MemberAliasUpdate) => void

const listeners = new Set<MemberAliasListener>()

export function notifyMemberAliasesChanged(update: MemberAliasUpdate): void {
  for (const listener of listeners) listener(update)
}

export function onMemberAliasesChanged(listener: MemberAliasListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
