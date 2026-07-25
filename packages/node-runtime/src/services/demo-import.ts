import * as fs from 'node:fs'
import * as path from 'node:path'
import { rebaseChatLabDemoDocuments } from '@openchatlab/parser'
import { appLogger } from '../logging/app-logger'
import { createChatLabTempDir, removeChatLabTempDir } from '../temp-workspace'

const DEMO_BASE_URL = 'https://chatlab.fun/assets/demo'
const DEMO_FILES = [
  'demo-group.json',
  'demo-private-A-cuilan.json',
  'demo-private-B-wukong.json',
  'demo-private-C-spider.json',
] as const

export interface DemoImportProgress {
  stage: 'downloading' | 'importing' | 'done' | 'error'
  current: number
  total: number
  message?: string
}

export interface DemoImportFileResult {
  success: boolean
  sessionId?: string
  error?: string
}

export interface DemoImportResult {
  success: boolean
  groupSessionId?: string
  privateSessionIds?: string[]
  error?: string
}

export interface ImportDemoSessionsOptions {
  locale: 'cn' | 'en'
  tempPrefix: string
  importFile: (filePath: string) => Promise<DemoImportFileResult>
  onProgress?: (progress: DemoImportProgress) => void
  fetchImpl?: typeof fetch
  now?: () => Date
}

/**
 * Download, rebase and import the official Demo sessions for Node runtimes.
 * Electron and CLI Web provide only their platform-specific import callback.
 */
export async function importDemoSessions(options: ImportDemoSessionsOptions): Promise<DemoImportResult> {
  const total = DEMO_FILES.length
  const fetchImpl = options.fetchImpl ?? fetch
  let tempDir: string | undefined

  try {
    const createdTempDir = createChatLabTempDir('imports', options.tempPrefix)
    tempDir = createdTempDir
    appLogger.info('demo-import', 'Demo import started', { locale: options.locale, sessionCount: total })

    const downloaded: string[] = []
    for (let index = 0; index < total; index++) {
      const filename = DEMO_FILES[index]
      options.onProgress?.({ stage: 'downloading', current: index + 1, total })
      const response = await fetchImpl.call(globalThis, `${DEMO_BASE_URL}/${options.locale}/${filename}`, {
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) throw new Error(`Download demo failed (${filename}): HTTP ${response.status}`)

      const content = Buffer.from(await response.arrayBuffer())
      if (content.byteLength < 100) {
        throw new Error(`Downloaded demo file is too small (${filename})`)
      }
      downloaded.push(content.toString('utf8'))
    }

    const rebased = rebaseChatLabDemoDocuments(downloaded, options.now?.() ?? new Date())
    const localPaths = rebased.documents.map((document, index) => {
      const localPath = path.join(createdTempDir, DEMO_FILES[index])
      fs.writeFileSync(localPath, document, 'utf8')
      return localPath
    })

    appLogger.info('demo-import', 'Demo timeline prepared', {
      sessionCount: total,
      offsetSeconds: rebased.offsetSeconds,
      latestTimestamp: rebased.latestTimestamp,
    })

    const sessionIds: string[] = []
    for (let index = 0; index < localPaths.length; index++) {
      options.onProgress?.({ stage: 'importing', current: index + 1, total })
      const result = await options.importFile(localPaths[index])
      if (!result.success || !result.sessionId) {
        throw new Error(result.error || `Failed to import demo: ${DEMO_FILES[index]}`)
      }
      sessionIds.push(result.sessionId)
    }

    const [groupSessionId, ...privateSessionIds] = sessionIds
    options.onProgress?.({ stage: 'done', current: total, total })
    appLogger.info('demo-import', 'Demo import completed', { sessionCount: sessionIds.length })
    return { success: true, groupSessionId, privateSessionIds }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.onProgress?.({ stage: 'error', current: 0, total, message })
    appLogger.error('demo-import', 'Demo import failed', error)
    return { success: false, error: message }
  } finally {
    if (tempDir) {
      try {
        removeChatLabTempDir(tempDir, 'imports')
      } catch (error) {
        appLogger.warn('demo-import', 'Failed to clean up Demo temporary directory', error)
      }
    }
  }
}
