/**
 * Unified response envelope for agent-facing query commands.
 *
 * Contract (design: .docs/tasks/2026-07-03-agent-friendly-cli-design.md §6.2):
 * - `ok` and `command` are always present.
 * - Success carries `data` + `meta` (with `apiVersion`); failure carries `error`.
 * - No null placeholders for the missing side.
 * - Errors are written to stdout (single parse path for agents); exit codes are semantic.
 */

/** Bump on breaking envelope changes (additive changes do not bump). */
export const API_VERSION = 1

export interface QueryErrorShape {
  code: string
  message: string
  hint?: string
  candidates?: unknown[]
}

export class QueryError extends Error {
  readonly code: string
  readonly hint?: string
  readonly candidates?: unknown[]

  constructor(shape: QueryErrorShape) {
    super(shape.message)
    this.name = 'QueryError'
    this.code = shape.code
    this.hint = shape.hint
    this.candidates = shape.candidates
  }
}

export interface SuccessEnvelope {
  ok: true
  command: string
  data: unknown
  meta: Record<string, unknown> & { apiVersion: number }
}

export interface ErrorEnvelope {
  ok: false
  command: string
  error: QueryErrorShape
  meta?: Record<string, unknown>
}

export function successEnvelope(command: string, data: unknown, meta?: Record<string, unknown>): SuccessEnvelope {
  return {
    ok: true,
    command,
    data,
    meta: { ...(meta ?? {}), apiVersion: API_VERSION },
  }
}

export function errorEnvelope(
  command: string,
  error: QueryErrorShape | QueryError,
  meta?: Record<string, unknown>
): ErrorEnvelope {
  const shape: QueryErrorShape = {
    code: error.code,
    message: error.message,
    ...(error.hint !== undefined ? { hint: error.hint } : {}),
    ...(error.candidates !== undefined ? { candidates: error.candidates } : {}),
  }
  return {
    ok: false,
    command,
    error: shape,
    ...(meta !== undefined ? { meta } : {}),
  }
}

/**
 * Semantic exit codes: 0 success, 2 argument errors (incl. disabled capabilities),
 * 3 resource not found, 4 ambiguity needing disambiguation, 5 SQL errors, 1 anything else.
 */
export function exitCodeForError(code: string): number {
  if (code === 'SQL_ERROR') return 5
  if (code.endsWith('_AMBIGUOUS')) return 4
  if (code.endsWith('_NOT_FOUND')) return 3
  if (code === 'INVALID_ARGUMENT' || code === 'CURSOR_INVALID' || code.endsWith('_DISABLED')) return 2
  return 1
}
