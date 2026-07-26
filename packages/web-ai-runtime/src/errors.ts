import type { WebAIRuntimeErrorData } from './types'

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
  const candidate = error as { statusCode?: number; status?: number; message?: string; name?: string }
  const status = candidate?.statusCode ?? candidate?.status
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
  if (candidate?.name === 'TimeoutError' || /timeout|timed out/i.test(message)) {
    return new WebAIRuntimeError({ code: 'TIMEOUT', message, retryable: true, status }, { cause: error })
  }
  if (error instanceof TypeError && /fetch|network|load failed/i.test(message)) {
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
