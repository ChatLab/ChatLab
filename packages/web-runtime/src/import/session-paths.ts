import { WebRuntimeError } from '../runtime-error'

export function sessionDatabaseFilename(sessionId: string): string {
  validateSessionId(sessionId)
  return `/chatlab-sessions/${sessionId}.db`
}

export function validateSessionId(sessionId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(sessionId)) {
    throw new WebRuntimeError('INVALID_SESSION_ID', 'The browser session id is not valid')
  }
}
