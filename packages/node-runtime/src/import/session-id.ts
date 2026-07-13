const SAFE_IMPORT_SESSION_ID_RE = /^[A-Za-z0-9_@-][A-Za-z0-9._@-]{0,127}$/

export function isValidImportSessionId(sessionId: string): boolean {
  return SAFE_IMPORT_SESSION_ID_RE.test(sessionId) && !sessionId.includes('..')
}
