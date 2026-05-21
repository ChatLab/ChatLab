import * as fs from 'fs'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'

export function registerCacheRoutes(server: FastifyInstance, downloadsDir: string): void {
  server.post<{
    Body: { filename: string; dataUrl: string }
  }>('/_web/cache/save-to-downloads', async (request) => {
    const { filename, dataUrl } = request.body
    if (!filename || !dataUrl) {
      return { success: false, error: 'filename and dataUrl are required' }
    }

    const base64Prefix = dataUrl.indexOf(',')
    const base64Data = base64Prefix >= 0 ? dataUrl.slice(base64Prefix + 1) : dataUrl
    const buffer = Buffer.from(base64Data, 'base64')

    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true })
    }

    const filePath = path.join(downloadsDir, filename)
    fs.writeFileSync(filePath, buffer)

    return { success: true, filePath }
  })

  server.post<{
    Body: { filePath: string }
  }>('/_web/cache/show-in-folder', async (request) => {
    const { filePath } = request.body
    if (!filePath) {
      return { success: false, error: 'filePath is required' }
    }

    const { exec } = await import('child_process')
    const platform = process.platform
    const dir = path.dirname(filePath)

    if (platform === 'darwin') {
      exec(`open -R "${filePath}"`)
    } else if (platform === 'win32') {
      exec(`explorer /select,"${filePath}"`)
    } else {
      exec(`xdg-open "${dir}"`)
    }

    return { success: true }
  })
}
