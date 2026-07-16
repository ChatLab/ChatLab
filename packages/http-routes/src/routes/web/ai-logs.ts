import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { AiRouteContext } from '../../context/ai'
import type { RuntimeRouteContext } from '../../context/runtime'
import type { StorageRouteContext } from '../../context/storage'

type AiLogRouteContext = Pick<RuntimeRouteContext, 'pathProvider'> &
  Pick<AiRouteContext, 'getCurrentAiLogPath'> &
  Pick<StorageRouteContext, 'showInFolder'>

function findLatestAiLogPath(logsDir: string): string | null {
  const aiLogDir = path.join(logsDir, 'ai')
  if (!fs.existsSync(aiLogDir)) return null

  const latest = fs
    .readdirSync(aiLogDir)
    .filter((name) => name.startsWith('ai_') && name.endsWith('.log'))
    .map((name) => {
      const filePath = path.join(aiLogDir, name)
      const stat = fs.statSync(filePath)
      return { path: filePath, mtimeMs: stat.mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]

  return latest?.path ?? null
}

function resolveAiLogPath(ctx: AiLogRouteContext): string | null {
  const currentPath = ctx.getCurrentAiLogPath?.()
  if (currentPath && fs.existsSync(currentPath)) return currentPath
  return findLatestAiLogPath(ctx.pathProvider.getLogsDir())
}

function isLoopbackAddress(address?: string): boolean {
  if (!address) return true
  const normalized = address.replace(/^::ffff:/, '')
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized.startsWith('127.')
  )
}

export function registerAiLogRoutes(server: FastifyInstance, ctx: AiLogRouteContext): void {
  server.post('/_web/ai/logs/show', async (request, reply) => {
    if (!ctx.showInFolder) return reply.code(501).send({ success: false, error: 'Not supported' })
    if (!isLoopbackAddress(request.ip)) {
      return { success: false, error: 'Opening AI logs is only supported on this device' }
    }

    const logPath = resolveAiLogPath(ctx)
    if (!logPath) return { success: false, error: 'No AI log files found' }

    try {
      await ctx.showInFolder(logPath)
      return { success: true, path: logPath }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
