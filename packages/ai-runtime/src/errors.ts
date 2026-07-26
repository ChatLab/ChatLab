import type { RuntimeErrorData } from './types'

export class AiRuntimeError extends Error {
  readonly code: RuntimeErrorData['code']
  readonly retryable: boolean

  constructor(data: RuntimeErrorData, options?: ErrorOptions) {
    super(data.message, options)
    this.name = 'AiRuntimeError'
    this.code = data.code
    this.retryable = data.retryable
  }

  toJSON(): RuntimeErrorData {
    return { code: this.code, message: this.message, retryable: this.retryable }
  }
}

export function normalizeRuntimeError(error: unknown, signal?: AbortSignal): AiRuntimeError {
  if (error instanceof AiRuntimeError) return error
  if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
    return new AiRuntimeError({ code: 'ABORTED', message: 'The AI request was cancelled.', retryable: true })
  }
  const message = error instanceof Error ? error.message : String(error)
  return new AiRuntimeError({ code: 'MODEL_ERROR', message, retryable: true }, { cause: error })
}
