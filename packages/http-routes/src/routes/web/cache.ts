import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import type { RuntimeRouteContext } from '../../context/runtime'
import type { StorageRouteContext } from '../../context/storage'

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
    /* directory inaccessible */
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
    /* directory inaccessible */
  }
  return count
}

function hasChatLabDatabases(dirPath: string): boolean {
  try {
    const markerPath = path.join(dirPath, '.chatlab')
    const dbDir = path.join(dirPath, 'databases')
    if (!fs.existsSync(markerPath) || !fs.existsSync(dbDir)) return false
    return fs.readdirSync(dbDir).some((file) => file.endsWith('.db'))
  } catch {
    return false
  }
}

type CacheRouteContext = Pick<RuntimeRouteContext, 'pathProvider'> & StorageRouteContext

export function registerCacheRoutes(server: FastifyInstance, ctx: CacheRouteContext): void {
  const pp = ctx.pathProvider
  const downloadsDir = ctx.downloadsDir ?? pp.getDownloadsDir()

  server.get('/_web/cache/info', async () => {
    const directories = [
      {
        id: 'databases',
        name: 'settings.storage.cache.databases.name',
        description: 'settings.storage.cache.databases.description',
        path: pp.getDatabaseDir(),
        scope: 'user-data',
        rootPath: pp.getUserDataDir(),
        icon: 'i-heroicons-circle-stack',
        canClear: false,
      },
      {
        id: 'ai',
        name: 'settings.storage.cache.ai.name',
        description: 'settings.storage.cache.ai.description',
        path: pp.getAiDataDir(),
        scope: 'system-data',
        rootPath: pp.getSystemDir(),
        icon: 'i-heroicons-sparkles',
        canClear: false,
      },
      {
        id: 'cache',
        name: 'settings.storage.cache.statsCache.name',
        description: 'settings.storage.cache.statsCache.description',
        path: pp.getCacheDir(),
        scope: 'system-data',
        rootPath: pp.getSystemDir(),
        icon: 'i-heroicons-bolt',
        canClear: true,
      },
      {
        id: 'logs',
        name: 'settings.storage.cache.logs.name',
        description: 'settings.storage.cache.logs.description',
        path: pp.getLogsDir(),
        scope: 'system-data',
        rootPath: pp.getSystemDir(),
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
      baseDir: pp.getSystemDir(),
      directories: results,
      totalSize: results.reduce((sum, d) => sum + d.size, 0),
    }
  })

  server.post<{ Body: { cacheId: string } }>('/_web/cache/clear', async (request) => {
    const { cacheId } = request.body
    const allowedDirs: Record<string, string> = {
      cache: pp.getCacheDir(),
      logs: pp.getLogsDir(),
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

  server.get('/_web/cache/data-dir', async () => {
    const pending = ctx.getPendingDataDirMigration?.()
    return {
      path: pp.getUserDataDir(),
      defaultPath: ctx.defaultUserDataDir,
      isCustom: ctx.isCustomDataDir ?? false,
      canSetDataDir: ctx.canSetDataDir ?? Boolean(ctx.setDataDir),
      managedScope: 'chat-databases',
      managedDescription: 'settings.storage.dataLocation.managedDescription',
      hasLegacyDataAtDefaultDir:
        Boolean(ctx.defaultUserDataDir) &&
        path.resolve(pp.getUserDataDir()) !== path.resolve(ctx.defaultUserDataDir ?? '') &&
        hasChatLabDatabases(ctx.defaultUserDataDir ?? ''),
      pendingMigration: pending
        ? {
            from: pending.from,
            to: pending.to,
            createdAt: pending.createdAt,
          }
        : undefined,
    }
  })

  server.post<{ Body: { path?: string | null; migrate?: boolean } }>('/_web/cache/data-dir', async (request, reply) => {
    if (!ctx.setDataDir) {
      return reply.code(501).send({ success: false, error: 'Data directory changes are not supported' })
    }

    const targetPath = typeof request.body?.path === 'string' ? request.body.path : null
    const migrate = request.body?.migrate !== false
    return ctx.setDataDir(targetPath, migrate)
  })

  server.get('/_web/cache/latest-import-log', async () => {
    const importLogDir = path.join(pp.getLogsDir(), 'import')
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

  server.post<{ Body: { filename: string; dataUrl: string } }>('/_web/cache/save-to-downloads', async (request) => {
    const { filename, dataUrl } = request.body
    if (!filename || !dataUrl) {
      return { success: false, error: 'filename and dataUrl are required' }
    }

    let buffer: Buffer
    if (dataUrl.includes(';base64,')) {
      const base64Data = dataUrl.split(';base64,')[1]
      buffer = Buffer.from(base64Data, 'base64')
    } else if (dataUrl.includes('charset=utf-8,')) {
      const textData = dataUrl.split('charset=utf-8,')[1]
      buffer = Buffer.from(decodeURIComponent(textData), 'utf-8')
    } else {
      const base64Data = dataUrl.replace(/^data:[^,]+,/, '')
      buffer = Buffer.from(base64Data, 'base64')
    }

    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true })
    }

    const filePath = path.join(downloadsDir, filename)
    fs.writeFileSync(filePath, buffer)

    return { success: true, filePath }
  })

  // Shell operations — require platform-specific callbacks

  server.post<{ Body: { cacheId: string } }>('/_web/cache/open-dir', async (request, reply) => {
    if (!ctx.openDirectory) return reply.code(501).send({ success: false, error: 'Not supported' })

    const { cacheId } = request.body
    const dirPaths: Record<string, string> = {
      base: pp.getSystemDir(),
      userData: pp.getUserDataDir(),
      databases: pp.getDatabaseDir(),
      cache: pp.getCacheDir(),
      ai: pp.getAiDataDir(),
      logs: pp.getLogsDir(),
      downloads: downloadsDir,
    }
    const dirPath = dirPaths[cacheId]
    if (!dirPath) return { success: false, error: 'Unknown directory' }

    if (!fs.existsSync(dirPath)) {
      await fsp.mkdir(dirPath, { recursive: true })
    }

    try {
      await ctx.openDirectory(dirPath)
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
    return { success: true }
  })

  server.post<{ Body: { filePath: string } }>('/_web/cache/show-in-folder', async (request, reply) => {
    if (!ctx.showInFolder) return reply.code(501).send({ success: false, error: 'Not supported' })

    const { filePath } = request.body
    if (!filePath) return { success: false, error: 'filePath is required' }

    try {
      await ctx.showInFolder(filePath)
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
    return { success: true }
  })
}
