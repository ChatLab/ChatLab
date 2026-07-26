import type { WebAIRuntimeErrorData } from './types'

interface ErrorCandidate {
  statusCode?: number
  status?: number
  message?: string
  name?: string
  cause?: unknown
}

export class WebAIRuntimeError extends Error {
  constructor(
    readonly data: WebAIRuntimeErrorData,
    options?: ErrorOptions
  ) {
    super(data.message, options)
    this.name = 'WebAIRuntimeError'
  }
}

export function normalizeWebAIError(error: unknown): WebAIRuntimeError {
  if (error instanceof WebAIRuntimeError) return error
  const chain = getErrorChain(error)
  const statusCandidate = chain.find(
    (candidate) => candidate.statusCode !== undefined || candidate.status !== undefined
  )
  const status = statusCandidate?.statusCode ?? statusCandidate?.status
  const message = error instanceof Error ? error.message : String(error)
  if (status === 401 || status === 403) {
    return new WebAIRuntimeError({ code: 'AUTH', message, retryable: false, status }, { cause: error })
  }
  if (status === 404) {
    return new WebAIRuntimeError({ code: 'MODEL_NOT_FOUND', message, retryable: false, status }, { cause: error })
  }
  if (status === 429) {
    return new WebAIRuntimeError({ code: 'RATE_LIMIT', message, retryable: true, status }, { cause: error })
  }
  if (
    chain.some((candidate) => candidate.name === 'TimeoutError' || /timeout|timed out/i.test(candidate.message ?? ''))
  ) {
    return new WebAIRuntimeError({ code: 'TIMEOUT', message, retryable: true, status }, { cause: error })
  }
  if (
    chain.some(
      (candidate) => candidate instanceof TypeError && /fetch|network|load failed/i.test(candidate.message ?? '')
    )
  ) {
    return new WebAIRuntimeError(
      {
        code: 'NETWORK_OR_CORS',
        message: 'The model request was blocked by the network or browser CORS policy.',
        retryable: true,
      },
      { cause: error }
    )
  }
  return new WebAIRuntimeError({ code: 'UNKNOWN', message, retryable: true, status }, { cause: error })
}

function getErrorChain(error: unknown): ErrorCandidate[] {
  const chain: ErrorCandidate[] = []
  const visited = new Set<object>()
  let current = error
  while (current && typeof current === 'object' && !visited.has(current) && chain.length < 8) {
    visited.add(current)
    const candidate = current as ErrorCandidate
    chain.push(candidate)
    current = candidate.cause
  }
  return chain
}
