import fs from 'node:fs'
import type { Command } from 'commander'
import {
  IMPORT_IN_PROGRESS_ERROR_KEY,
  PreferencesManager,
  createDatabaseManagerAdapter,
  logNativeParserStatus,
  ownerProfileService,
  type AutoImportAnalysisResult,
  type AutoImportResult,
} from '@openchatlab/node-runtime'
import { initRuntime, resolveNativeBinding } from '../runtime'
import { analyzeAutoImport, autoImport, detectFormat } from './index'

interface ImportCommandOptions {
  sessionId?: string
  format?: string
  dryRun?: boolean
  json?: boolean
}

interface ImportCommandEnvelope {
  ok: boolean
  command: 'import'
  data?: AutoImportResult | AutoImportAnalysisResult
  error?: {
    code: string
    message: string
    hint?: string
  }
  meta: {
    dryRun: boolean
    apiVersion: 1
  }
}

function normalizeImportError(message: string): NonNullable<ImportCommandEnvelope['error']> {
  if (message.startsWith('File not found:')) {
    return {
      code: 'FILE_NOT_FOUND',
      message,
      hint: 'Pass an absolute path or a path relative to the current working directory.',
    }
  }
  if (message === IMPORT_IN_PROGRESS_ERROR_KEY) {
    return {
      code: 'IMPORT_IN_PROGRESS',
      message: 'Another import is already in progress.',
      hint: 'Wait for the active import to finish, then retry.',
    }
  }
  if (message === 'error.unrecognized_format' || message.toLowerCase().includes('unrecognized')) {
    return {
      code: 'UNRECOGNIZED_FORMAT',
      message: 'The chat export format could not be recognized.',
      hint: 'Run "chatlab formats" and retry with --format <id>.',
    }
  }
  if (message.includes('sessionId contains invalid characters')) {
    return {
      code: 'INVALID_SESSION_ID',
      message,
      hint: 'Use only letters, numbers, underscores, and hyphens (maximum 128 characters).',
    }
  }
  return { code: 'IMPORT_FAILED', message }
}

export function buildImportCommandEnvelope(
  result: AutoImportResult | AutoImportAnalysisResult,
  dryRun: boolean
): ImportCommandEnvelope {
  return result.success
    ? { ok: true, command: 'import', data: result, meta: { dryRun, apiVersion: 1 } }
    : {
        ok: false,
        command: 'import',
        error: normalizeImportError(result.error || 'Import failed'),
        meta: { dryRun, apiVersion: 1 },
      }
}

function printHumanResult(result: AutoImportResult | AutoImportAnalysisResult, dryRun: boolean): void {
  if (!result.success) {
    const error = normalizeImportError(result.error || 'Import failed')
    console.error(`\n\nImport failed: ${error.message}`)
    if (error.hint) console.error(`  Hint: ${error.hint}`)
    return
  }

  console.log(dryRun ? '\n\nDry run completed.' : '\n\nImport succeeded!')
  console.log(`  Mode: ${result.importMode ?? 'unknown'}`)
  if (result.sessionId) console.log(`  Session ID: ${result.sessionId}`)
  if (result.matchedBy) console.log(`  Matched by: ${result.matchedBy}`)
  if (result.createReason) console.log(`  Create reason: ${result.createReason}`)
  if (dryRun && 'totalMessageCount' in result && result.totalMessageCount !== undefined) {
    console.log(`  Messages scanned: ${result.totalMessageCount}`)
  }
  console.log(`  New messages: ${result.newMessageCount ?? 0}`)
  console.log(`  Duplicates skipped: ${result.duplicateCount ?? 0}`)
}

function printJsonResult(result: AutoImportResult | AutoImportAnalysisResult, dryRun: boolean): void {
  process.stdout.write(`${JSON.stringify(buildImportCommandEnvelope(result, dryRun))}\n`)
}

export async function withJsonDiagnosticsOnStderr<T>(enabled: boolean, run: () => Promise<T>): Promise<T> {
  if (!enabled) return run()

  const originalConsoleLog = console.log
  console.log = (...args: unknown[]) => console.error(...args)
  try {
    return await run()
  } finally {
    console.log = originalConsoleLog
  }
}

async function applyOwnerProfile(
  result: AutoImportResult,
  systemDir: string,
  dbManager: ReturnType<typeof initRuntime>['dbManager']
) {
  if (!result.sessionId) return
  try {
    const applied = ownerProfileService.tryApplyOwnerProfile(
      createDatabaseManagerAdapter(dbManager),
      new PreferencesManager(systemDir),
      result.sessionId
    )
    if (applied.applied) console.error(`Owner auto-detected: ${applied.ownerId}`)
  } catch (error) {
    console.error(`Owner profile apply skipped: ${error instanceof Error ? error.message : error}`)
  }
}

export function registerImportCommand(program: Command): void {
  program
    .command('import <file>')
    .description('Import a chat history file (14+ formats: QQ/WeChat/Telegram/WhatsApp/LINE/Discord, etc.)')
    .option('--session-id <id>', 'Force an existing session target, or create with this ID if missing')
    .option('--format <id>', 'Specify the input format ID (skip auto-detection)')
    .option('--dry-run', 'Analyze the target and message counts without writing data')
    .option('--json', 'Output one machine-readable JSON envelope')
    .action(async (file: string, options: ImportCommandOptions) => {
      if (!fs.existsSync(file)) {
        const result: AutoImportAnalysisResult = { success: false, error: `File not found: ${file}` }
        if (options.json) printJsonResult(result, Boolean(options.dryRun))
        else printHumanResult(result, Boolean(options.dryRun))
        process.exitCode = 3
        return
      }

      const result = await withJsonDiagnosticsOnStderr(Boolean(options.json), async () => {
        let dbManager: ReturnType<typeof initRuntime>['dbManager'] | undefined

        try {
          const runtime = initRuntime()
          dbManager = runtime.dbManager
          const nativeBinding = resolveNativeBinding()
          logNativeParserStatus()

          const detectedFormat = options.format ? undefined : detectFormat(file)
          if (!detectedFormat && !options.format) {
            return { success: false, error: 'error.unrecognized_format' } satisfies AutoImportAnalysisResult
          }

          if (!options.json) {
            console.log(`${options.dryRun ? 'Analyzing' : 'Importing'}: ${file}`)
            if (detectedFormat) console.log(`  Format: ${detectedFormat.name} (${detectedFormat.platform})`)
            else if (options.format) console.log(`  Format ID: ${options.format} (explicit)`)
          }

          const importOptions = {
            formatId: options.format,
            sessionId: options.sessionId,
            nativeBinding,
            onProgress: options.json
              ? undefined
              : (progress: { stage: string; progress: number }) => {
                  process.stdout.write(`\r  ${progress.stage}: ${progress.progress}%`)
                },
          }
          const importResult = options.dryRun
            ? await analyzeAutoImport(dbManager, file, importOptions)
            : await autoImport(dbManager, file, importOptions)

          if (importResult.success && !options.dryRun) {
            await applyOwnerProfile(importResult as AutoImportResult, runtime.pathProvider.getSystemDir(), dbManager)
          }
          return importResult
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          } satisfies AutoImportAnalysisResult
        } finally {
          dbManager?.closeAll()
        }
      })

      if (options.json) printJsonResult(result, Boolean(options.dryRun))
      else printHumanResult(result, Boolean(options.dryRun))

      if (!result.success) {
        if (result.error === 'error.unrecognized_format') process.exitCode = 2
        else process.exitCode = result.error === IMPORT_IN_PROGRESS_ERROR_KEY ? 4 : 1
      }
    })
}
