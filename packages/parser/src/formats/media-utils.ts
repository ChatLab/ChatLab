import * as path from 'path'
import { MessageType } from '@openchatlab/shared-types'

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

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'])
const VOICE_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.amr', '.silk'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi'])
const FILE_EXTS = new Set(
  Object.keys(MIME_BY_EXT).filter((ext) => !IMAGE_EXTS.has(ext) && !VOICE_EXTS.has(ext) && !VIDEO_EXTS.has(ext))
)

const INFERABLE_TYPES = new Set<number>([MessageType.TEXT, MessageType.OTHER])
const MEDIA_TYPES = new Set<number>([
  MessageType.IMAGE,
  MessageType.VOICE,
  MessageType.VIDEO,
  MessageType.FILE,
  MessageType.EMOJI,
])
const URL_PROTOCOL_REGEX = /^[a-z][a-z0-9+.-]*:\/\//i
const WINDOWS_ABSOLUTE_PATH_REGEX = /^[a-z]:[\\/]/i

export interface InferredMedia {
  type: MessageType
  sourcePath: string
  filename: string
  mimeType: string
}

export function getMimeTypeForPath(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function looksLikeLocalExportPath(value: string): boolean {
  if (URL_PROTOCOL_REGEX.test(value)) return false
  if (value.includes('\n') || value.includes('\r')) return false

  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('./') || normalized.startsWith('../')) return true
  if (normalized.includes('/')) return true
  if (path.isAbsolute(value) || WINDOWS_ABSOLUTE_PATH_REGEX.test(value)) return true

  return !/\s/.test(value)
}

export function inferMediaFromContent(content: string | null, type: number | null | undefined): InferredMedia | null {
  if (!content) return null

  const trimmed = content.trim()
  const firstChar = trimmed[0]
  const lastChar = trimmed[trimmed.length - 1]
  if (!trimmed || ((firstChar === '[' || firstChar === '【') && (lastChar === ']' || lastChar === '】'))) {
    return null
  }

  const ext = path.extname(trimmed).toLowerCase()
  if (!ext) return null

  let inferredType: MessageType | null = null
  if (type != null && MEDIA_TYPES.has(type)) inferredType = type as MessageType
  else if (type == null || INFERABLE_TYPES.has(type)) {
    if (!looksLikeLocalExportPath(trimmed)) return null
    if (IMAGE_EXTS.has(ext)) inferredType = MessageType.IMAGE
    else if (VOICE_EXTS.has(ext)) inferredType = MessageType.VOICE
    else if (VIDEO_EXTS.has(ext)) inferredType = MessageType.VIDEO
    else if (FILE_EXTS.has(ext)) inferredType = MessageType.FILE
  }

  if (inferredType == null) return null

  return {
    type: inferredType,
    sourcePath: trimmed,
    filename: path.basename(trimmed),
    mimeType: getMimeTypeForPath(trimmed),
  }
}
