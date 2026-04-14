/**
 * NLP 词库管理器
 * 负责自定义词库的下载、查询、删除
 * 词库存储在 userData/nlp/ 目录下
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { app } from 'electron'
import axios from 'axios'

const NLP_DIR_NAME = 'nlp'
const DICT_DOWNLOAD_URL_BASE = 'https://chatlab.fun/assets/nlp'
const DICT_SHA256: Record<string, string> = {
  'zh-CN': '139519822fe8ab9e10d9d07e68ea0451045380aedaf54ecc51e2a28c6b42a13f',
  'zh-TW': 'a63ec7e388f16f1b486dcd948a9f1a3b492be5d9b6bdab786a95e59966786dfd',
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export interface DictInfo {
  id: string
  label: string
  locale: string
  downloaded: boolean
  fileSize?: number
}

const AVAILABLE_DICTS: Omit<DictInfo, 'downloaded' | 'fileSize'>[] = [
  { id: 'zh-CN', label: '简体中文', locale: 'zh-CN' },
  { id: 'zh-TW', label: '繁體中文', locale: 'zh-TW' },
]

export function getNlpDir(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'data', NLP_DIR_NAME)
}

function ensureNlpDir(): void {
  const dir = getNlpDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function getDictFilePath(dictId: string): string {
  return path.join(getNlpDir(), `${dictId}.dict`)
}

function getDictDownloadUrl(dictId: string): string {
  return `${DICT_DOWNLOAD_URL_BASE}/${dictId}.dict`
}

export function isDictDownloaded(dictId: string): boolean {
  return fs.existsSync(getDictFilePath(dictId))
}

export function getDictList(): DictInfo[] {
  return AVAILABLE_DICTS.map((d) => {
    const filePath = getDictFilePath(d.id)
    const downloaded = fs.existsSync(filePath)
    let fileSize: number | undefined
    if (downloaded) {
      try {
        fileSize = fs.statSync(filePath).size
      } catch {
        /* ignore */
      }
    }
    return { ...d, downloaded, fileSize }
  })
}

export function loadDictBuffer(dictId: string): Buffer | null {
  const filePath = getDictFilePath(dictId)
  if (!fs.existsSync(filePath)) return null
  try {
    return fs.readFileSync(filePath)
  } catch (error) {
    console.error(`[NLP DictManager] Failed to read dict file: ${filePath}`, error)
    return null
  }
}

export async function downloadDict(
  dictId: string,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; error?: string }> {
  const dictDef = AVAILABLE_DICTS.find((d) => d.id === dictId)
  if (!dictDef) {
    return { success: false, error: `Unknown dict: ${dictId}` }
  }

  ensureNlpDir()
  const url = getDictDownloadUrl(dictId)
  const filePath = getDictFilePath(dictId)
  const tmpPath = filePath + '.tmp'

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 120_000,
      onDownloadProgress: (progressEvent) => {
        if (progressEvent.total && onProgress) {
          onProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100))
        }
      },
    })

    const buffer = Buffer.from(response.data)

    // 词库文件至少应 > 1MB，且不应以 HTML 标签开头
    const MIN_DICT_SIZE = 1_000_000
    if (buffer.length < MIN_DICT_SIZE) {
      const preview = buffer.subarray(0, 200).toString('utf-8')
      console.error(`[NLP DictManager] Downloaded file too small (${buffer.length} bytes), preview: ${preview}`)
      return {
        success: false,
        error: `Downloaded file is invalid (${buffer.length} bytes). The dictionary URL may not be available yet.`,
      }
    }

    const head = buffer.subarray(0, 50).toString('utf-8').trim()
    if (head.startsWith('<!') || head.startsWith('<html')) {
      console.error(`[NLP DictManager] Downloaded file appears to be HTML, not a dict file`)
      return {
        success: false,
        error: 'Downloaded file is HTML, not a dictionary file. The URL may not be deployed yet.',
      }
    }

    const expectedSha256 = DICT_SHA256[dictId]
    if (!expectedSha256) {
      return {
        success: false,
        error: `Missing SHA256 checksum for dict: ${dictId}`,
      }
    }

    const actualSha256 = sha256Hex(buffer)
    if (actualSha256 !== expectedSha256) {
      console.error(
        `[NLP DictManager] SHA256 mismatch for ${dictId}, expected=${expectedSha256}, actual=${actualSha256}`
      )
      return {
        success: false,
        error: 'Dictionary integrity check failed (SHA256 mismatch).',
      }
    }

    fs.writeFileSync(tmpPath, buffer)

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    fs.renameSync(tmpPath, filePath)

    console.log(`[NLP DictManager] Dict downloaded: ${dictId} (${fs.statSync(filePath).size} bytes)`)
    return { success: true }
  } catch (error) {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
    }
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[NLP DictManager] Download failed for ${dictId}:`, msg)
    return { success: false, error: msg }
  }
}

/**
 * 应用启动时调用，自动后台下载简体中文词库（如未下载）
 */
export async function ensureDefaultDict(): Promise<void> {
  if (isDictDownloaded('zh-CN')) return

  console.log('[NLP DictManager] zh-CN dict not found, starting background download...')
  const result = await downloadDict('zh-CN')
  if (result.success) {
    console.log('[NLP DictManager] zh-CN dict auto-downloaded successfully')
  } else {
    console.warn('[NLP DictManager] zh-CN dict auto-download failed:', result.error)
  }
}

export function deleteDict(dictId: string): { success: boolean; error?: string } {
  const filePath = getDictFilePath(dictId)
  if (!fs.existsSync(filePath)) {
    return { success: true }
  }
  try {
    fs.unlinkSync(filePath)
    console.log(`[NLP DictManager] Dict deleted: ${dictId}`)
    return { success: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[NLP DictManager] Delete failed for ${dictId}:`, msg)
    return { success: false, error: msg }
  }
}
