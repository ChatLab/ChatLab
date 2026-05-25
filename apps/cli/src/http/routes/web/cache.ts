import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import { loadConfig } from '@openchatlab/config'

async function getDirSize(dirPath: string): Promise<number> {
  let totalSize = 0
  try {
    if (!fs.existsSync(dirPath)) return 0
    const files = await fsp.readdir(dirPath, { withFileTypes: true })
    for (const file of files) {
      const filePath = path.join(dirPath, file.name)
      if (file.isDirectory()) {
        totalSize += await getDirSize(filePath)
      } else {
        const stat = await fsp.stat(filePath)
        totalSize += stat.size
      }
    }
  } catch {
    // directory inaccessible
  }
  return totalSize
}

async function getFileCount(dirPath: string): Promise<number> {
  let count = 0
  try {
    if (!fs.existsSync(dirPath)) return 0
    const files = await fsp.readdir(dirPath, { withFileTypes: true })
    for (const file of files) {
      const filePath = path.join(dirPath, file.name)
      if (file.isDirectory()) {
        count += await getFileCount(filePath)
      } else {
        count++
      }
    }
  } catch {
    // directory inaccessible
  }
  return count
}

export function registerCacheRoutes(server: FastifyInstance, pathProvider: PathProvider): void {
  const downloadsDir = pathProvider.getDownloadsDir()

  // --- Storage management endpoints ---

  server.get('/_web/cache/info', async () => {
    const directories = [
      {
        id: 'databases',
        name: 'settings.storage.cache.databases.name',
        description: 'settings.storage.cache.databases.description',
        path: pathProvider.getDatabaseDir(),
        icon: 'i-heroicons-circle-stack',
        canClear: false,
      },
      {
        id: 'ai',
        name: 'settings.storage.cache.ai.name',
        description: 'settings.storage.cache.ai.description',
        path: pathProvider.getAiDataDir(),
        icon: 'i-heroicons-sparkles',
        canClear: false,
      },
      {
        id: 'cache',
        name: 'settings.storage.cache.statsCache.name',
        description: 'settings.storage.cache.statsCache.description',
        path: pathProvider.getCacheDir(),
        icon: 'i-heroicons-bolt',
        canClear: true,
      },
      {
        id: 'logs',
        name: 'settings.storage.cache.logs.name',
        description: 'settings.storage.cache.logs.description',
        path: pathProvider.getLogsDir(),
        icon: 'i-heroicons-document-text',
        canClear: true,
      },
    ]

    const results = await Promise.all(
      directories.map(async (dir) => {
        const [size, fileCount] = await Promise.all([getDirSize(dir.path), getFileCount(dir.path)])
        return { ...dir, size, fileCount, exists: fs.existsSync(dir.path) }
      })
    )

    return {
      baseDir: pathProvider.getUserDataDir(),
      systemDir: pathProvider.getSystemDir(),
      directories: results,
      totalSize: results.reduce((sum, d) => sum + d.size, 0),
    }
  })

  server.post<{ Body: { cacheId: string } }>('/_web/cache/clear', async (request) => {
    const { cacheId } = request.body
    const allowedDirs: Record<string, string> = {
      cache: pathProvider.getCacheDir(),
      logs: pathProvider.getLogsDir(),
    }
    const dirPath = allowedDirs[cacheId]
    if (!dirPath) return { success: false, error: 'Not allowed to clear this directory' }

    if (!fs.existsSync(dirPath)) return { success: true }

    const files = await fsp.readdir(dirPath)
    for (const file of files) {
      const filePath = path.join(dirPath, file)
      const stat = await fsp.stat(filePath)
      if (stat.isDirectory()) {
        await fsp.rm(filePath, { recursive: true })
      } else {
        await fsp.unlink(filePath)
      }
    }
    return { success: true }
  })

  server.post<{ Body: { cacheId: string } }>('/_web/cache/open-dir', async (request) => {
    const { cacheId } = request.body
    const dirPaths: Record<string, string> = {
      base: pathProvider.getUserDataDir(),
      system: pathProvider.getSystemDir(),
      databases: pathProvider.getDatabaseDir(),
      cache: pathProvider.getCacheDir(),
      ai: pathProvider.getAiDataDir(),
      logs: pathProvider.getLogsDir(),
      downloads: downloadsDir,
    }
    const dirPath = dirPaths[cacheId]
    if (!dirPath) return { success: false, error: 'Unknown directory' }

    if (!fs.existsSync(dirPath)) {
      await fsp.mkdir(dirPath, { recursive: true })
    }

    const { exec } = await import('child_process')
    const platform = process.platform
    if (platform === 'darwin') {
      exec(`open "${dirPath}"`)
    } else if (platform === 'win32') {
      exec(`explorer "${dirPath}"`)
    } else {
      exec(`xdg-open "${dirPath}"`)
    }
    return { success: true }
  })

  server.get('/_web/cache/data-dir', async () => {
    const config = loadConfig()
    const isCustom = Boolean(config.data.user_data_dir || process.env.CHATLAB_DATA_DIR)
    return { path: pathProvider.getUserDataDir(), isCustom }
  })

  server.get('/_web/cache/latest-import-log', async () => {
    const importLogDir = path.join(pathProvider.getLogsDir(), 'import')
    if (!fs.existsSync(importLogDir)) {
      return { success: false, error: 'Log directory not found' }
    }

    const files = await fsp.readdir(importLogDir)
    const logFiles = files.filter((f) => f.startsWith('import_') && f.endsWith('.log'))
    if (logFiles.length === 0) {
      return { success: false, error: 'No import logs found' }
    }

    const fileStats = await Promise.all(
      logFiles.map(async (f) => {
        const filePath = path.join(importLogDir, f)
        const stat = await fsp.stat(filePath)
        return { name: f, path: filePath, mtime: stat.mtime.getTime() }
      })
    )
    fileStats.sort((a, b) => b.mtime - a.mtime)

    return { success: true, path: fileStats[0].path, name: fileStats[0].name }
  })

  // --- Existing endpoints ---

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
