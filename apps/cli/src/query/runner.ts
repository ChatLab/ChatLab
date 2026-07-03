/**
 * Query command runner: format resolution, envelope emission, error mapping.
 *
 * Hard rule (design §6.2): in agent/json mode stdout carries only the envelope;
 * errors are structured envelopes on stdout with semantic exit codes. Text mode
 * prints human-readable output with errors on stderr.
 */

import { successEnvelope, errorEnvelope, exitCodeForError, QueryError } from './envelope'

export type OutputFormat = 'agent' | 'json' | 'text'

/** Explicit --format wins; TTY defaults to text, pipes default to agent (design §6.3). */
export function resolveFormat(explicit?: string): OutputFormat {
  if (explicit !== undefined) {
    if (explicit === 'agent' || explicit === 'json' || explicit === 'text') return explicit
    throw new QueryError({
      code: 'INVALID_ARGUMENT',
      message: `Unknown format: ${explicit}`,
      hint: 'Supported formats: agent, json, text',
    })
  }
  return process.stdout.isTTY ? 'text' : 'agent'
}

export interface QueryResult {
  data: unknown
  meta?: Record<string, unknown>
  /** Human rendering for --format text; falls back to pretty-printed data. */
  renderText?: () => string
}

/**
 * Execute a query command handler and emit the response envelope.
 * The handler receives the resolved format so it can shape data accordingly.
 */
export async function runQuery(
  command: string,
  options: { format?: string },
  handler: (format: OutputFormat) => Promise<QueryResult>
): Promise<void> {
  let format: OutputFormat
  try {
    format = resolveFormat(options.format)
  } catch (err) {
    emitError(command, 'agent', err)
    return
  }

  try {
    const result = await handler(format)
    if (format === 'text') {
      console.log(result.renderText ? result.renderText() : JSON.stringify(result.data, null, 2))
    } else {
      console.log(JSON.stringify(successEnvelope(command, result.data, result.meta)))
    }
  } catch (err) {
    emitError(command, format, err)
  }
}

function emitError(command: string, format: OutputFormat, err: unknown): void {
  const queryError =
    err instanceof QueryError
      ? err
      : new QueryError({
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : String(err),
        })

  if (format === 'text') {
    console.error(`Error: ${queryError.message}${queryError.hint ? `\n  ${queryError.hint}` : ''}`)
    if (queryError.candidates) {
      for (const candidate of queryError.candidates) {
        console.error(`  - ${JSON.stringify(candidate)}`)
      }
    }
  } else {
    console.log(JSON.stringify(errorEnvelope(command, queryError)))
  }
  process.exitCode = exitCodeForError(queryError.code)
}
