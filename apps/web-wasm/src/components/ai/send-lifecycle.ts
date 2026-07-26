export async function resolveSendTarget<T>(
  signal: AbortSignal,
  resolve: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  signal.throwIfAborted()
  const target = await resolve(signal)
  signal.throwIfAborted()
  return target
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; code?: unknown; data?: { code?: unknown } }
  return candidate.name === 'AbortError' || candidate.code === 'ABORTED' || candidate.data?.code === 'ABORTED'
}
