/**
 * FetchImportAdapter — 通过 HTTP + SSE 实现导入功能
 *
 * 用于 CLI serve Web 场景。
 */

import type { ImportProgress } from '@/types/base'
import type {
  ImportAdapter,
  ImportOptions,
  ImportResult,
  FormatInfo,
  MultiChatEntry,
  DemoProgress,
  DemoImportResult,
  IncrementalAnalysis,
  IncrementalImportResult,
} from './types'
import { get } from '../utils/http'

const BASE = '/_web'

export class FetchImportAdapter implements ImportAdapter {
  async importFile(
    file: File | string,
    options?: ImportOptions,
    onProgress?: (p: ImportProgress) => void
  ): Promise<ImportResult> {
    if (typeof file === 'string') {
      return { success: false, error: 'File path import is not supported in Web mode' }
    }

    const form = new FormData()
    form.append('file', file)
    if (options?.formatId) form.append('formatId', options.formatId)
    if (options?.chatIndex !== undefined) form.append('chatIndex', String(options.chatIndex))

    const res = await fetch(`${BASE}/import`, { method: 'POST', body: form })

    if (!res.ok) {
      const text = await res.text()
      return { success: false, error: `HTTP ${res.status}: ${text}` }
    }

    const reader = res.body?.getReader()
    if (!reader) return { success: false, error: 'No response body' }

    const decoder = new TextDecoder()
    let buffer = ''
    let result: ImportResult = { success: false, error: 'Unknown error' }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let eventType = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6))
          if (eventType === 'progress') {
            onProgress?.(data as ImportProgress)
          } else if (eventType === 'done') {
            result = data as ImportResult
          } else if (eventType === 'error') {
            result = data as ImportResult
          }
          eventType = ''
        }
      }
    }

    return result
  }

  async detectFormat(file: File | string): Promise<FormatInfo | null> {
    if (typeof file === 'string') return null
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/detect-format`, { method: 'POST', body: form })
    if (!res.ok) return null
    const data = (await res.json()) as { format: FormatInfo | null }
    return data.format
  }

  async scanMultiChatFile(file: File | string): Promise<MultiChatEntry[]> {
    if (typeof file === 'string') return []
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/scan-multi-chat`, { method: 'POST', body: form })
    if (!res.ok) return []
    const data = (await res.json()) as { chats: MultiChatEntry[] }
    return data.chats
  }

  getSupportedFormats(): Promise<FormatInfo[]> {
    return get('/supported-formats')
  }

  async importDemo(locale: string, onProgress?: (p: DemoProgress) => void): Promise<DemoImportResult> {
    return new Promise((resolve) => {
      fetch(`${BASE}/demo/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      })
        .then(async (resp) => {
          if (!resp.ok || !resp.body) {
            resolve({ success: false, error: `HTTP ${resp.status}` })
            return
          }

          const reader = resp.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            let eventType = ''
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.slice(7).trim()
              } else if (line.startsWith('data: ')) {
                const data = JSON.parse(line.slice(6))
                if (eventType === 'progress') {
                  if (data.stage === 'downloading' || data.stage === 'importing') {
                    onProgress?.({ stage: data.stage })
                  }
                } else if (eventType === 'result') {
                  resolve(data as DemoImportResult)
                  return
                }
                eventType = ''
              }
            }
          }
          resolve({ success: false, error: 'Stream ended without result' })
        })
        .catch((e) => resolve({ success: false, error: String(e) }))
    })
  }

  async analyzeIncrementalImport(sessionId: string, file: File | string): Promise<IncrementalAnalysis> {
    if (typeof file === 'string') {
      return { newMessageCount: 0, duplicateCount: 0, totalInFile: 0, error: 'File path not supported in Web mode' }
    }

    const form = new FormData()
    form.append('file', file)

    const res = await fetch(`${BASE}/sessions/${sessionId}/import/incremental/analyze`, {
      method: 'POST',
      body: form,
    })

    if (!res.ok) {
      const text = await res.text()
      return { newMessageCount: 0, duplicateCount: 0, totalInFile: 0, error: `HTTP ${res.status}: ${text}` }
    }

    return (await res.json()) as IncrementalAnalysis
  }

  async incrementalImport(
    sessionId: string,
    file: File | string,
    onProgress?: (p: ImportProgress) => void
  ): Promise<IncrementalImportResult> {
    if (typeof file === 'string') {
      return { success: false, newMessageCount: 0, error: 'File path not supported in Web mode' }
    }

    const form = new FormData()
    form.append('file', file)

    const res = await fetch(`${BASE}/sessions/${sessionId}/import/incremental`, {
      method: 'POST',
      body: form,
    })

    if (!res.ok) {
      const text = await res.text()
      return { success: false, newMessageCount: 0, error: `HTTP ${res.status}: ${text}` }
    }

    const reader = res.body?.getReader()
    if (!reader) return { success: false, newMessageCount: 0, error: 'No response body' }

    const decoder = new TextDecoder()
    let buffer = ''
    let result: IncrementalImportResult = { success: false, newMessageCount: 0, error: 'Unknown error' }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let eventType = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6))
          if (eventType === 'progress') {
            onProgress?.(data as ImportProgress)
          } else if (eventType === 'done') {
            result = data as IncrementalImportResult
          } else if (eventType === 'error') {
            result = data as IncrementalImportResult
          }
          eventType = ''
        }
      }
    }

    return result
  }
}
