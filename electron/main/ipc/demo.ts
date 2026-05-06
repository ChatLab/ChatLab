/**
 * Demo 示例数据下载与导入 IPC 处理器
 */

import { ipcMain, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'
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
  const tempDir = path.join(app.getPath('userData'), 'temp', 'demo')
  fs.mkdirSync(tempDir, { recursive: true })
  return tempDir
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const tmpPath = destPath + '.tmp'
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60_000,
  })

  const buffer = Buffer.from(response.data)
  if (buffer.length < 100) {
    throw new Error(`Downloaded file too small (${buffer.length} bytes)`)
  }

  fs.writeFileSync(tmpPath, buffer)
  fs.renameSync(tmpPath, destPath)
}

function cleanupDemoTemp(tempDir: string): void {
  try {
    if (fs.existsSync(tempDir)) {
      for (const file of fs.readdirSync(tempDir)) {
        fs.unlinkSync(path.join(tempDir, file))
      }
      fs.rmdirSync(tempDir)
    }
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
  ipcMain.handle(
    'demo:downloadAndImport',
    async (
      _,
      locale: string
    ): Promise<{
      success: boolean
      groupSessionId?: string
      privateSessionId?: string
      error?: string
    }> => {
      const tempDir = getDemoTempDir()
      const groupPath = path.join(tempDir, 'demo-group.json')
      const privatePath = path.join(tempDir, 'demo-private.json')

      const sendProgress = (progress: DemoProgress) => {
        win.webContents.send('demo:progress', progress)
      }

      try {
        // Phase 1: Download
        sendProgress({ stage: 'downloading', current: 1, total: 2 })
        await downloadFile(`${DEMO_BASE_URL}/${locale}/demo-group.json`, groupPath)

        sendProgress({ stage: 'downloading', current: 2, total: 2 })
        await downloadFile(`${DEMO_BASE_URL}/${locale}/demo-private.json`, privatePath)

        // Phase 2: Import group chat
        sendProgress({ stage: 'importing', current: 1, total: 2 })
        const groupResult = await worker.streamImport(groupPath)

        if (!groupResult.success || !groupResult.sessionId) {
          throw new Error(groupResult.error || 'Failed to import group demo')
        }

        // Phase 3: Import private chat
        sendProgress({ stage: 'importing', current: 2, total: 2 })
        const privateResult = await worker.streamImport(privatePath)

        if (!privateResult.success || !privateResult.sessionId) {
          throw new Error(privateResult.error || 'Failed to import private demo')
        }

        sendProgress({ stage: 'done', current: 2, total: 2 })

        return {
          success: true,
          groupSessionId: groupResult.sessionId,
          privateSessionId: privateResult.sessionId,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[Demo] Download and import failed:', message)
        sendProgress({ stage: 'error', current: 0, total: 2, message })
        return { success: false, error: message }
      } finally {
        cleanupDemoTemp(tempDir)
      }
    }
  )
}
