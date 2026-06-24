import type { Readable } from 'node:stream'
import type { ZipArchiveReader } from './archive-reader'

export interface ArchiveEntrySummary {
  name: string
  compressedSize: number
  uncompressedSize: number
  compressionMethod: number
  isDirectory: boolean
}

export type ArchiveEntryStreamOpener = () => Promise<Readable>

export type ArchiveEntryVisitor = (
  entry: ArchiveEntrySummary,
  openStream: ArchiveEntryStreamOpener
) => Promise<void> | void

export interface ZipArchiveReaderOptions {
  maxEntries?: number
  maxEntryBytes?: number
  maxCompressionRatio?: number
}

export interface PreparedImportChat {
  chatId: string
  name: string
  type: 'private' | 'group'
  messageCount: number
  memberCount: number
}

export interface MaterializedImport {
  manifestPath: string
}

export interface PreparedImportSource {
  sourceId: string
  formatId: string
  platform: string
  chats: PreparedImportChat[]
  expiresAt: number
}

export interface ArchiveResolver {
  readonly id: string
  readonly platform: string
  detect(entries: ArchiveEntrySummary[]): boolean
  scan(reader: ZipArchiveReader): Promise<PreparedImportChat[]>
  materialize(reader: ZipArchiveReader, chat: PreparedImportChat, targetDir: string): Promise<MaterializedImport>
}
