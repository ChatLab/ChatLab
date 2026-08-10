import type { SessionRuntimeAdapter } from '../adapters'

export function listOwnerInsightSessionIds(
  adapter: SessionRuntimeAdapter,
  excludedSessionIds: readonly string[] = []
): string[] {
  const excluded = new Set(excludedSessionIds)
  return adapter.listSessionIds().filter((sessionId) => !excluded.has(sessionId))
}
