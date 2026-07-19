export class WebRuntimeError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WebRuntimeError'
    this.code = code
  }
}
