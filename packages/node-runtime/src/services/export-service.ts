/**
 * Shared export service.
 *
 * Wraps node-runtime's Markdown exporter with adapter-based DB opening.
 */

import { exportFilterResultToMarkdown, type ExportFilterParams, type ExportResult } from '../export'
import type { SessionRuntimeAdapter } from './adapters'

export function exportMarkdown(
  adapter: SessionRuntimeAdapter,
  params: ExportFilterParams
): { result: ExportResult; content: string } {
  const chunks: string[] = []
  const result = exportFilterResultToMarkdown(
    params,
    {
      openDatabase(sessionId: string) {
        return adapter.openReadonly(sessionId)
      },
    },
    {
      write(chunk: string) {
        chunks.push(chunk)
      },
      end() {
        /* collected in chunks array */
      },
    }
  )
  return { result, content: chunks.join('') }
}
