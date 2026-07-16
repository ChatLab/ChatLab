/**
 * Demo 示例数据下载与导入 IPC 处理器
 */

import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { createChatLabTempDir } from '@openchatlab/node-runtime/temp-workspace'
import * as worker from '../worker/workerManager'
import type { IpcContext } from './types'

const DEMO_BASE_URL = 'https://chatlab.fun/assets/demo'

interface DemoProgress {
  stage: 'downloading' | 'importing' | 'done' | 'error'
  /** 当前处理的文件序号 (1-based) */
  current: number
  total: number
  message?: string
}

function getDemoTempDir(): string {
  return createChatLabTempDir('imports', 'desktop-demo-')
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const tmpPath = destPath + '.tmp'
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < 100) {
    throw new Error(`Downloaded file too small (${buffer.length} bytes)`)
  }

  fs.writeFileSync(tmpPath, buffer)
  fs.renameSync(tmpPath, destPath)
}

function cleanupDemoTemp(tempDir: string): void {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
}

export function registerDemoHandlers(ctx: IpcContext): void {
  const { win } = ctx

  /**
   * 下载并导入 Demo 示例数据
   * 返回群聊和私聊的 sessionId
   */
  const DEMO_FILES = [
    'demo-group.json',
    'demo-private-A-cuilan.json',
    'demo-private-B-wukong.json',
    'demo-private-C-spider.json',
  ]

  ipcMain.handle(
    'demo:downloadAndImport',
    async (
      _,
      locale: string
    ): Promise<{
      success: boolean
      groupSessionId?: string
      privateSessionIds?: string[]
      error?: string
    }> => {
      const tempDir = getDemoTempDir()
      const total = DEMO_FILES.length

      const sendProgress = (progress: DemoProgress) => {
        win.webContents.send('demo:progress', progress)
      }

      try {
        const localPaths: string[] = []
        for (let i = 0; i < total; i++) {
          sendProgress({ stage: 'downloading', current: i + 1, total })
          const localPath = path.join(tempDir, DEMO_FILES[i])
          await downloadFile(`${DEMO_BASE_URL}/${locale}/${DEMO_FILES[i]}`, localPath)
          localPaths.push(localPath)
        }

        sendProgress({ stage: 'importing', current: 1, total })
        const groupResult = await worker.streamImport(localPaths[0])
        if (!groupResult.success || !groupResult.sessionId) {
          throw new Error(groupResult.error || 'Failed to import group demo')
        }

        const privateSessionIds: string[] = []
        for (let i = 1; i < localPaths.length; i++) {
          sendProgress({ stage: 'importing', current: i + 1, total })
          const result = await worker.streamImport(localPaths[i])
          if (!result.success || !result.sessionId) {
            throw new Error(result.error || `Failed to import private demo: ${DEMO_FILES[i]}`)
          }
          privateSessionIds.push(result.sessionId)
        }

        sendProgress({ stage: 'done', current: total, total })

        return {
          success: true,
          groupSessionId: groupResult.sessionId,
          privateSessionIds,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[Demo] Download and import failed:', message)
        sendProgress({ stage: 'error', current: 0, total, message })
        return { success: false, error: message }
      } finally {
        cleanupDemoTemp(tempDir)
      }
    }
  )
}
