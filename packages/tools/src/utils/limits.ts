export function resolveMessageLimit(requestedLimit: unknown, defaultLimit: number, maxMessagesLimit?: number): number {
  const requested = typeof requestedLimit === 'number' && requestedLimit > 0 ? requestedLimit : defaultLimit
  return maxMessagesLimit && maxMessagesLimit > 0 ? Math.min(requested, maxMessagesLimit) : requested
}
