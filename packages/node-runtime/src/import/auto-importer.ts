import { appLogger } from '../logging/app-logger'
import {
  resolveAutoImportTarget,
  type AutoImportDecision,
  type AutoImportCreateReason,
  type AutoImportMatcherDeps,
  type AutoImportMatchMethod,
} from './auto-import-matcher'
import type { IncrementalImportResult } from './incremental-importer'
import type { IncrementalAnalyzeResult } from './incremental-importer'
import type { AnalyzeNewImportResult, ImportDiagnostics, StreamImportResult } from './streaming-importer'
import { isValidImportSessionId } from './session-id'

export interface AutoImportOptions {
  explicitSessionId?: string
  formatOptions?: Record<string, unknown>
}

export interface AutoImportDeps extends AutoImportMatcherDeps {
  sessionExists(sessionId: string): boolean
  createSession(
    filePath: string,
    formatOptions?: Record<string, unknown>,
    sessionId?: string
  ): Promise<StreamImportResult>
  appendSession(
    sessionId: string,
    filePath: string,
    formatOptions?: Record<string, unknown>
  ): Promise<IncrementalImportResult>
  resolveTarget?: typeof resolveAutoImportTarget
}

export interface AutoImportAnalysisDeps extends AutoImportMatcherDeps {
  sessionExists(sessionId: string): boolean
  analyzeCreateSession(filePath: string, formatOptions?: Record<string, unknown>): Promise<AnalyzeNewImportResult>
  analyzeAppendSession(
    sessionId: string,
    filePath: string,
    formatOptions?: Record<string, unknown>
  ): Promise<IncrementalAnalyzeResult>
  resolveTarget?: typeof resolveAutoImportTarget
}

export interface AutoImportResult {
  success: boolean
  sessionId?: string
  importMode?: 'created' | 'incremental'
  matchedBy?: AutoImportMatchMethod
  createReason?: AutoImportCreateReason
  newMessageCount?: number
  duplicateCount?: number
  batch?:
    | NonNullable<IncrementalImportResult['batch']>
    | { receivedCount: number; writtenCount: number; duplicateCount: number }
  session?: IncrementalImportResult['session']
  updates?: IncrementalImportResult['updates']
  diagnostics?: ImportDiagnostics
  error?: string
}

export interface AutoImportAnalysisResult {
  success: boolean
  importMode?: 'created' | 'incremental'
  sessionId?: string
  matchedBy?: AutoImportMatchMethod
  createReason?: AutoImportCreateReason
  totalMessageCount?: number
  newMessageCount?: number
  duplicateCount?: number
  totalMemberCount?: number
  meta?: AnalyzeNewImportResult['meta']
  error?: string
}

type AutoImportPlan =
  | { action: 'incremental'; sessionId: string; matchedBy?: AutoImportMatchMethod }
  | { action: 'create'; sessionId?: string; reason?: AutoImportCreateReason }

async function planAutoImport(
  filePath: string,
  deps: Pick<AutoImportDeps, 'listSessionIds' | 'openReadonly' | 'onProgress' | 'sessionExists' | 'resolveTarget'>,
  options: AutoImportOptions
): Promise<AutoImportPlan> {
  if (options.explicitSessionId) {
    if (!isValidImportSessionId(options.explicitSessionId)) {
      throw new Error('sessionId contains invalid characters')
    }
    return deps.sessionExists(options.explicitSessionId)
      ? { action: 'incremental', sessionId: options.explicitSessionId }
      : { action: 'create', sessionId: options.explicitSessionId }
  }

  const decision: AutoImportDecision = await (deps.resolveTarget ?? resolveAutoImportTarget)(
    filePath,
    deps,
    options.formatOptions
  )
  return decision.action === 'incremental'
    ? { action: 'incremental', sessionId: decision.sessionId, matchedBy: decision.matchedBy }
    : { action: 'create', reason: decision.reason }
}

function mapCreateResult(result: StreamImportResult, createReason?: AutoImportCreateReason): AutoImportResult {
  if (!result.success || !result.sessionId) {
    return { success: false, error: result.error, diagnostics: result.diagnostics }
  }
  return {
    success: true,
    sessionId: result.sessionId,
    importMode: 'created',
    ...(createReason ? { createReason } : {}),
    newMessageCount: result.diagnostics?.messagesWritten ?? 0,
    duplicateCount: result.diagnostics?.duplicateCount ?? 0,
    batch: result.diagnostics
      ? {
          receivedCount: result.diagnostics.messagesReceived,
          writtenCount: result.diagnostics.messagesWritten,
          duplicateCount: result.diagnostics.duplicateCount,
        }
      : undefined,
    diagnostics: result.diagnostics,
  }
}

function mapIncrementalResult(
  sessionId: string,
  result: IncrementalImportResult,
  matchedBy?: AutoImportMatchMethod
): AutoImportResult {
  if (!result.success) return { success: false, sessionId, error: result.error }
  return {
    success: true,
    sessionId,
    importMode: 'incremental',
    ...(matchedBy ? { matchedBy } : {}),
    newMessageCount: result.newMessageCount,
    duplicateCount: result.batch?.duplicateCount ?? 0,
    batch: result.batch,
    session: result.session,
    updates: result.updates,
  }
}

export async function autoImportFile(
  filePath: string,
  deps: AutoImportDeps,
  options: AutoImportOptions = {}
): Promise<AutoImportResult> {
  try {
    if (!options.explicitSessionId) {
      appLogger.info('import', 'Automatic session matching started', {
        candidateCount: deps.listSessionIds().length,
      })
    }
    const plan = await planAutoImport(filePath, deps, options)

    if (plan.action === 'incremental') {
      const result = mapIncrementalResult(
        plan.sessionId,
        await deps.appendSession(plan.sessionId, filePath, options.formatOptions),
        plan.matchedBy
      )
      appLogger.info('import', 'Incremental import completed', {
        sessionId: plan.sessionId,
        matchedBy: plan.matchedBy,
        success: result.success,
        newMessageCount: result.newMessageCount,
        duplicateCount: result.duplicateCount,
      })
      return result
    }

    const result = mapCreateResult(
      await deps.createSession(filePath, options.formatOptions, plan.sessionId),
      plan.reason
    )
    appLogger.info('import', 'Import created a new session', {
      reason: plan.reason,
      sessionId: result.sessionId,
      success: result.success,
    })
    return result
  } catch (error) {
    appLogger.error('import', 'Automatic import failed', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function analyzeAutoImportFile(
  filePath: string,
  deps: AutoImportAnalysisDeps,
  options: AutoImportOptions = {}
): Promise<AutoImportAnalysisResult> {
  try {
    const plan = await planAutoImport(filePath, deps, options)

    if (plan.action === 'incremental') {
      const analysis = await deps.analyzeAppendSession(plan.sessionId, filePath, options.formatOptions)
      if (analysis.error) return { success: false, error: analysis.error }
      const result: AutoImportAnalysisResult = {
        success: true,
        importMode: 'incremental',
        sessionId: plan.sessionId,
        ...(plan.matchedBy ? { matchedBy: plan.matchedBy } : {}),
        totalMessageCount: analysis.totalInFile,
        newMessageCount: analysis.newMessageCount,
        duplicateCount: analysis.duplicateCount,
      }
      appLogger.info('import', 'Incremental import analysis completed', {
        sessionId: plan.sessionId,
        matchedBy: plan.matchedBy,
        newMessageCount: analysis.newMessageCount,
        duplicateCount: analysis.duplicateCount,
      })
      return result
    }

    const analysis = await deps.analyzeCreateSession(filePath, options.formatOptions)
    if (analysis.error) return { success: false, error: analysis.error }
    const result: AutoImportAnalysisResult = {
      success: true,
      importMode: 'created',
      ...(plan.sessionId ? { sessionId: plan.sessionId } : {}),
      ...(plan.reason ? { createReason: plan.reason } : {}),
      totalMessageCount: analysis.totalMessages,
      newMessageCount: analysis.newMessageCount,
      duplicateCount: analysis.duplicateCount,
      totalMemberCount: analysis.totalMembers,
      meta: analysis.meta,
    }
    appLogger.info('import', 'New session import analysis completed', {
      reason: plan.reason,
      messageCount: analysis.totalMessages,
      memberCount: analysis.totalMembers,
    })
    return result
  } catch (error) {
    appLogger.error('import', 'Automatic import analysis failed', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
