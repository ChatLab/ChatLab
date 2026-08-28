/**
 * 词库管理器（Node.js 实现）
 *
 * 接收 nlpDir 参数而非依赖 Electron app 模块。
 * Electron 和 Server 各自传入自己的 nlpDir 路径。
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import type { DictInfo } from '@openchatlab/core'
import { clearJiebaInstance } from './segmenter'

const DICT_DOWNLOAD_URL_BASE = 'https://chatlab.fun/assets/nlp'
const DICT_SHA256: Record<string, string> = {
  'zh-CN': '139519822fe8ab9e10d9d07e68ea0451045380aedaf54ecc51e2a28c6b42a13f',
  'zh-TW': 'a63ec7e388f16f1b486dcd948a9f1a3b492be5d9b6bdab786a95e59966786dfd',
}

const AVAILABLE_DICTS: Array<{ id: string; label: string; locale: string }> = [
  { id: 'zh-CN', label: '简体中文', locale: 'zh-CN' },
  { id: 'zh-TW', label: '繁體中文', locale: 'zh-TW' },
]

function getDictFilePath(nlpDir: string, dictId: string): string {
  return path.join(nlpDir, `${dictId}.dict`)
}

export function isDictDownloaded(nlpDir: string, dictId: string): boolean {
  return fs.existsSync(getDictFilePath(nlpDir, dictId))
}

export function getDictList(nlpDir: string): DictInfo[] {
  return AVAILABLE_DICTS.map((d) => {
    const filePath = getDictFilePath(nlpDir, d.id)
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

export function loadDictBuffer(nlpDir: string, dictId: string): Buffer | null {
  const filePath = getDictFilePath(nlpDir, dictId)
  if (!fs.existsSync(filePath)) return null
  try {
    return fs.readFileSync(filePath)
  } catch (error) {
    console.error(`[NLP DictManager] Failed to read dict file: ${filePath}`, error)
    return null
  }
}

export async function downloadDict(
  nlpDir: string,
  dictId: string,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; error?: string }> {
  if (!AVAILABLE_DICTS.find((d) => d.id === dictId)) {
    return { success: false, error: `Unknown dict: ${dictId}` }
  }

  fs.mkdirSync(nlpDir, { recursive: true })
  const url = `${DICT_DOWNLOAD_URL_BASE}/${dictId}.dict`
  const filePath = getDictFilePath(nlpDir, dictId)
  const tmpPath = filePath + '.tmp'

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`)

    const total = Number(response.headers.get('content-length') || 0)
    let buffer: Buffer

    if (!response.body) {
      buffer = Buffer.from(await response.arrayBuffer())
    } else {
      const reader = response.body.getReader()
      const chunks: Buffer[] = []
      let loaded = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        chunks.push(chunk)
        loaded += chunk.length
        if (total > 0 && onProgress) onProgress(Math.round((loaded / total) * 100))
      }
      buffer = Buffer.concat(chunks)
    }

    const MIN_DICT_SIZE = 1_000_000
    if (buffer.length < MIN_DICT_SIZE) {
      return { success: false, error: `Downloaded file is invalid (${buffer.length} bytes)` }
    }
    const head = buffer.subarray(0, 50).toString('utf-8').trim()
    if (head.startsWith('<!') || head.startsWith('<html')) {
      return { success: false, error: 'Downloaded file is HTML, not a dictionary file' }
    }

    const expectedSha256 = DICT_SHA256[dictId]
    if (!expectedSha256) {
      return { success: false, error: `Missing SHA256 checksum for dict: ${dictId}` }
    }
    const actualSha256 = createHash('sha256').update(buffer).digest('hex')
    if (actualSha256 !== expectedSha256) {
      return { success: false, error: 'Dictionary integrity check failed (SHA256 mismatch)' }
    }

    fs.writeFileSync(tmpPath, buffer)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    fs.renameSync(tmpPath, filePath)
    clearJiebaInstance(dictId as any)

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

export function deleteDict(nlpDir: string, dictId: string): { success: boolean; error?: string } {
  const filePath = getDictFilePath(nlpDir, dictId)
  if (!fs.existsSync(filePath)) return { success: true }
  try {
    fs.unlinkSync(filePath)
    clearJiebaInstance(dictId as any)
    console.log(`[NLP DictManager] Dict deleted: ${dictId}`)
    return { success: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[NLP DictManager] Delete failed for ${dictId}:`, msg)
    return { success: false, error: msg }
  }
}

/**
 * 自动下载默认词库（应用启动时调用）
 */
export async function ensureDefaultDict(nlpDir: string, bundledDictDir?: string): Promise<void> {
  if (isDictDownloaded(nlpDir, 'zh-CN')) return
  if (bundledDictDir) {
    const bundledPath = getDictFilePath(bundledDictDir, 'zh-CN')
    if (fs.existsSync(bundledPath)) {
      fs.mkdirSync(nlpDir, { recursive: true })
      const filePath = getDictFilePath(nlpDir, 'zh-CN')
      const tmpPath = filePath + '.tmp'
      fs.copyFileSync(bundledPath, tmpPath)
      fs.renameSync(tmpPath, filePath)
      console.log('[NLP DictManager] Installed bundled zh-CN dictionary')
      return
    }
  }
  console.log('[NLP DictManager] zh-CN dict not found, starting background download...')
  const result = await downloadDict(nlpDir, 'zh-CN')
  if (result.success) {
    console.log('[NLP DictManager] zh-CN dict auto-downloaded successfully')
  } else {
    console.warn('[NLP DictManager] zh-CN dict auto-download failed:', result.error)
  }
}
