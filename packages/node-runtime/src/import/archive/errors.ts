export type ArchiveImportErrorCode =
  | 'error.archive_unsupported'
  | 'error.archive_encrypted'
  | 'error.archive_corrupt'
  | 'error.archive_unsafe_path'
  | 'error.archive_limit_exceeded'
  | 'error.google_chat_structure_not_found'
  | 'error.google_chat_conversation_incomplete'
  | 'error.import_source_not_found'
  | 'error.import_source_expired'

export class ArchiveImportError extends Error {
  constructor(
    readonly code: ArchiveImportErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ArchiveImportError'
  }
}
