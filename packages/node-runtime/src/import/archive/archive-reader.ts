import * as fs from 'node:fs'
import * as path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Entry, ZipFile } from 'yauzl'
import { openPromise } from 'yauzl'
import { ArchiveImportError } from './errors'
import type {
  ArchiveEntryStreamOpener,
  ArchiveEntrySummary,
  ArchiveEntryVisitor,
  ZipArchiveReaderOptions,
} from './types'

const DEFAULT_MAX_ENTRIES = 100_000
const DEFAULT_MAX_ENTRY_BYTES = 20 * 1024 * 1024 * 1024
const DEFAULT_MAX_COMPRESSION_RATIO = 10_000

export function validateArchiveEntryName(fileName: string): void {
  if (
    fileName.startsWith('/') ||
    /^[A-Za-z]:\//.test(fileName) ||
    fileName.includes('\\') ||
    fileName.split('/').includes('..')
  ) {
    throw new ArchiveImportError('error.archive_unsafe_path', `Unsafe archive entry path: ${fileName}`)
  }
}

function mapArchiveError(error: unknown): ArchiveImportError {
  if (error instanceof ArchiveImportError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new ArchiveImportError('error.archive_corrupt', `Invalid ZIP archive: ${message}`, {
    cause: error,
  })
}

function toSummary(entry: Entry): ArchiveEntrySummary {
  return {
    name: entry.fileName,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    compressionMethod: entry.compressionMethod,
    isDirectory: entry.fileName.endsWith('/'),
  }
}

/**
 * 对 ZIP 中央目录和条目元数据做统一校验。所有调用方必须经过这里，
 * 防止 resolver 在看到恶意路径或异常压缩比后继续处理。
 */
function validateEntry(entry: Entry, options: Required<ZipArchiveReaderOptions>): void {
  validateArchiveEntryName(entry.fileName)

  if (entry.isEncrypted()) {
    throw new ArchiveImportError('error.archive_encrypted', `Encrypted ZIP entry is not supported: ${entry.fileName}`)
  }
  if (!entry.canDecodeFileData() || (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)) {
    throw new ArchiveImportError(
      'error.archive_unsupported',
      `Unsupported ZIP compression method for entry: ${entry.fileName}`
    )
  }
  if (entry.uncompressedSize > options.maxEntryBytes) {
    throw new ArchiveImportError('error.archive_limit_exceeded', `ZIP entry exceeds the size limit: ${entry.fileName}`)
  }

  if (entry.uncompressedSize > 0) {
    const ratio = entry.compressedSize === 0 ? Number.POSITIVE_INFINITY : entry.uncompressedSize / entry.compressedSize
    if (ratio > options.maxCompressionRatio) {
      throw new ArchiveImportError(
        'error.archive_limit_exceeded',
        `ZIP entry exceeds the compression ratio limit: ${entry.fileName}`
      )
    }
  }
}

export class ZipArchiveReader {
  private readonly options: Required<ZipArchiveReaderOptions>

  constructor(
    private readonly archivePath: string,
    options: ZipArchiveReaderOptions = {}
  ) {
    this.options = {
      maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      maxEntryBytes: options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES,
      maxCompressionRatio: options.maxCompressionRatio ?? DEFAULT_MAX_COMPRESSION_RATIO,
    }
  }

  private async open(): Promise<ZipFile> {
    try {
      return await openPromise(this.archivePath, {
        autoClose: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      })
    } catch (error) {
      throw mapArchiveError(error)
    }
  }

  async listEntries(): Promise<ArchiveEntrySummary[]> {
    const entries: ArchiveEntrySummary[] = []
    await this.visitEntries((entry) => {
      entries.push(entry)
    })
    return entries
  }

  /**
   * 每次只推进一个 ZIP 条目；visitor 若打开流，必须等待流消费结束后返回。
   * 这样大 ZIP 不会同时创建大量 inflate stream。
   */
  async visitEntries(visitor: ArchiveEntryVisitor): Promise<void> {
    const zipFile = await this.open()
    let count = 0
    try {
      for await (const entry of zipFile.eachEntry()) {
        count++
        if (count > this.options.maxEntries) {
          throw new ArchiveImportError('error.archive_limit_exceeded', 'ZIP archive contains too many entries')
        }
        validateEntry(entry, this.options)

        let opened = false
        const openStream: ArchiveEntryStreamOpener = async () => {
          if (opened) {
            throw new ArchiveImportError('error.archive_corrupt', `ZIP entry stream opened twice: ${entry.fileName}`)
          }
          opened = true
          try {
            return await zipFile.openReadStreamPromise(entry)
          } catch (error) {
            throw mapArchiveError(error)
          }
        }
        await visitor(toSummary(entry), openStream)
      }
    } catch (error) {
      throw mapArchiveError(error)
    } finally {
      if (zipFile.isOpen) zipFile.close()
    }
  }

  async pipeEntries(targets: ReadonlyMap<string, string>): Promise<void> {
    const remaining = new Set(targets.keys())
    await this.visitEntries(async (entry, openStream) => {
      const destination = targets.get(entry.name)
      if (!destination || entry.isDirectory) return
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      await pipeline(await openStream(), fs.createWriteStream(destination, { flags: 'wx' }))
      remaining.delete(entry.name)
    })

    if (remaining.size > 0) {
      throw new ArchiveImportError(
        'error.archive_corrupt',
        `ZIP archive is missing expected entries: ${Array.from(remaining).join(', ')}`
      )
    }
  }
}
