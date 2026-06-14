/**
 * Main process English translations
 *
 * AI shared translations imported from @openchatlab/node-runtime;
 * Electron-specific translations defined here.
 */
import aiLocale from '@openchatlab/node-runtime/src/ai/i18n/locales/en-US'

export default {
  // ===== Common =====
  common: {
    error: 'Error',
  },

  // ===== P0: Update dialogs =====
  update: {
    newVersionTitle: 'New version v{{version}} available',
    newVersionMessage: 'New version v{{version}} available',
    newVersionDetail: 'Would you like to download and install the new version?',
    downloadNow: 'Download Now',
    cancel: 'Cancel',
    downloadComplete: 'Download Complete',
    readyToInstall: 'The new version is ready. Install now?',
    install: 'Install',
    remindLater: 'Remind Later',
    installOnQuit: 'Later (auto-install on quit)',
    upToDate: 'You are up to date',
  },

  // ===== P0: File/directory dialogs =====
  dialog: {
    selectChatFile: 'Select Chat Record File',
    chatRecords: 'Chat Records',
    allFiles: 'All Files',
    import: 'Import',
    selectDirectory: 'Select Directory',
    selectFolder: 'Select Folder',
    selectFolderError: 'Error selecting folder: ',
  },

  // ===== P1: Database migrations =====
  database: {
    migrationV1Desc: 'Add owner_id field to meta table',
    migrationV1Message: 'Support "Owner" feature to set your identity in the member list',
    migrationV2Desc: 'Add roles, reply_to_message_id, platform_message_id fields',
    migrationV2Message: 'Support member roles, message reply relationships and reply preview',
    migrationV3Desc: 'Add session index tables (segment, message_context) and session_gap_threshold field',
    migrationV3Message: 'Support session timeline browsing and AI-enhanced analysis',
    migrationV4Desc: 'Create FTS5 full-text search index (message_fts) and build index data',
    migrationV4Message: 'Enable full-text search for significantly faster keyword search',
    migrationV5Desc: 'Repair legacy member and message fields',
    migrationV5Message: 'Update legacy database fields for compatibility with the current version',
    migrationV6Desc: 'Upgrade the session index to the segment schema',
    migrationV6Message: 'Upgrade the session index structure while preserving existing indexes and summaries',
    migrationV7Desc: 'Repair missing session message mappings',
    migrationV7Message: 'Repair missing session index mappings while preserving existing sessions and summaries',
    integrityError:
      'Database structure is incomplete: missing meta table. Please delete this database file and re-import.',
    checkFailed: 'Database check failed: {{error}}',
  },

  // ===== Tool system =====
  tools: {
    notRegistered: 'Tool "{{toolName}}" is not registered',
  },

  // AI shared translations (from @openchatlab/node-runtime)
  ...aiLocale,
}
