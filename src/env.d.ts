/// <reference types="vite/client" />

declare const __IS_ELECTRON__: boolean | undefined
declare const __IS_WEB_WASM__: boolean | undefined

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // 使用 Record<string, never> 避免 {} 被 ESLint 判定为过宽类型。
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

import type { FileParseInfo, ConflictCheckResult, MergeParams, MergeResult } from './types/format'

interface MergeApi {
  exportSessionsToTempFiles: (
    sessionIds: string[]
  ) => Promise<{ success: boolean; tempFiles: string[]; error?: string }>
  cleanupTempExportFiles: (filePaths: string[]) => Promise<{ success: boolean; error?: string }>
  parseFileInfo: (filePath: string) => Promise<FileParseInfo>
  checkConflicts: (filePaths: string[]) => Promise<ConflictCheckResult>
  mergeFiles: (params: MergeParams) => Promise<MergeResult>
  clearCache: (filePath?: string) => Promise<boolean>
}

declare global {
  interface Window {
    mergeApi: MergeApi
  }
}
