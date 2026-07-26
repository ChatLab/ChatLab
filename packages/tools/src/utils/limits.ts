export function resolveMessageLimit(requestedLimit: unknown, defaultLimit: number, maxMessagesLimit?: number): number {
  const requested =
    typeof requestedLimit === 'number' && Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.max(1, Math.floor(requestedLimit))
      : defaultLimit
  return maxMessagesLimit && maxMessagesLimit > 0 ? Math.min(requested, maxMessagesLimit) : requested
}
