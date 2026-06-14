import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { MessageType, type ParsedMessage } from '@openchatlab/shared-types'

const MEDIA_TYPES = new Set<number>([
  MessageType.IMAGE,
  MessageType.VOICE,
  MessageType.VIDEO,
  MessageType.FILE,
  MessageType.EMOJI,
])

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.amr': 'audio/amr',
  '.silk': 'audio/silk',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
}

export interface ArchivedMedia {
  mediaPath: string | null
  mediaMime: string | null
  mediaFilename: string | null
}

export function getMimeTypeForPath(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

export function isMediaMessageType(type: number): boolean {
  return MEDIA_TYPES.has(type)
}

export function getSessionMediaDir(userDataDir: string, sessionId: string): string {
  return path.join(userDataDir, 'media', sessionId)
}

function sanitizeFilename(filename: string): string {
  const sanitized = filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replaceAll(/./g, (char) => (char.charCodeAt(0) < 32 ? '_' : char))
    .trim()
  return sanitized || 'attachment'
}

function resolveSourcePath(sourceRoot: string, sourcePath: string): string {
  return path.resolve(path.isAbsolute(sourcePath) ? sourcePath : path.join(sourceRoot, sourcePath))
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

export function archiveMessageMedia(
  message: ParsedMessage,
  options: {
    sourceRoot: string
    sessionMediaDir: string
    sequence: number
  }
): ArchivedMedia {
  if (!isMediaMessageType(message.type)) {
    return { mediaPath: null, mediaMime: null, mediaFilename: null }
  }

  const sourcePath = message.media?.sourcePath || message.content || ''
  const mediaFilename = message.media?.filename || (sourcePath ? path.basename(sourcePath) : null)
  const mediaMime = message.media?.mimeType || (sourcePath ? getMimeTypeForPath(sourcePath) : null)

  if (!sourcePath) return { mediaPath: null, mediaMime, mediaFilename }

  const resolvedSource = resolveSourcePath(options.sourceRoot, sourcePath)
  if (!isPathInsideRoot(options.sourceRoot, resolvedSource)) {
    return { mediaPath: null, mediaMime, mediaFilename }
  }

  if (!fs.existsSync(resolvedSource)) {
    return { mediaPath: null, mediaMime, mediaFilename }
  }

  const stat = fs.statSync(resolvedSource)
  if (!stat.isFile()) {
    return { mediaPath: null, mediaMime, mediaFilename }
  }

  fs.mkdirSync(options.sessionMediaDir, { recursive: true })
  const basename = sanitizeFilename(mediaFilename || path.basename(resolvedSource))
  const hash = crypto.createHash('sha1').update(resolvedSource).digest('hex').slice(0, 10)
  const archivedName = `${String(options.sequence).padStart(8, '0')}-${hash}-${basename}`
  const archivedPath = path.join(options.sessionMediaDir, archivedName)

  if (!fs.existsSync(archivedPath)) {
    fs.copyFileSync(resolvedSource, archivedPath)
  }

  return {
    mediaPath: archivedName,
    mediaMime: mediaMime || getMimeTypeForPath(resolvedSource),
    mediaFilename: mediaFilename || path.basename(resolvedSource),
  }
}
