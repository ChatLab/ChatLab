import fs from 'node:fs'
import type { Command } from 'commander'
import { validateChatLabFile, type ChatLabValidationReport } from '@openchatlab/parser'
import { appLogger } from '@openchatlab/node-runtime'

interface ValidateCommandOptions {
  json?: boolean
}

interface ValidateCommandEnvelope {
  ok: boolean
  command: 'validate'
  data?: ChatLabValidationReport
  error?: {
    code: string
    message: string
    hint?: string
  }
  meta: {
    apiVersion: 1
  }
}

function buildEnvelope(report: ChatLabValidationReport): ValidateCommandEnvelope {
  return report.valid
    ? { ok: true, command: 'validate', data: report, meta: { apiVersion: 1 } }
    : {
        ok: false,
        command: 'validate',
        data: report,
        error: {
          code: 'INVALID_CHATLAB_FORMAT',
          message: `Validation found ${report.errorCount} error(s).`,
          hint: 'Fix every error, rerun validation, then preview the import with "chatlab import <file> --dry-run --json".',
        },
        meta: { apiVersion: 1 },
      }
}

function buildFileError(file: string): ValidateCommandEnvelope {
  return {
    ok: false,
    command: 'validate',
    error: {
      code: 'FILE_NOT_FOUND',
      message: `File not found: ${file}`,
      hint: 'Pass an absolute path or a path relative to the current working directory.',
    },
    meta: { apiVersion: 1 },
  }
}

function printHumanReport(report: ChatLabValidationReport): void {
  const status = report.valid ? 'Validation passed.' : 'Validation failed.'
  console.log(status)
  console.log(`  Format: ${report.format}`)
  if (report.version) console.log(`  Version: ${report.version}`)
  console.log(`  Members: ${report.stats.memberCount}`)
  console.log(`  Messages: ${report.stats.messageCount}`)
  console.log(`  Errors: ${report.errorCount}`)
  console.log(`  Warnings: ${report.warningCount}`)

  for (const issue of report.issues) {
    const location = [issue.line ? `line ${issue.line}` : '', issue.path ?? ''].filter(Boolean).join(', ')
    console.log(
      `  [${issue.severity.toUpperCase()}] ${issue.code}${location ? ` (${location})` : ''}: ${issue.message}`
    )
  }
  if (report.truncatedIssueCount > 0) {
    console.log(`  ... ${report.truncatedIssueCount} more issue(s) not shown`)
  }
}

export function registerValidateCommand(program: Command): void {
  program
    .command('validate <file>')
    .description('Strictly validate a ChatLab JSON or JSONL file without importing it')
    .option('--json', 'Output one machine-readable JSON envelope')
    .action(async (file: string, options: ValidateCommandOptions) => {
      if (!fs.existsSync(file)) {
        const envelope = buildFileError(file)
        if (options.json) process.stdout.write(`${JSON.stringify(envelope)}\n`)
        else {
          console.error(envelope.error?.message)
          if (envelope.error?.hint) console.error(`  Hint: ${envelope.error.hint}`)
        }
        process.exitCode = 3
        return
      }

      try {
        appLogger.info('validate', 'ChatLab format validation started', {
          extension: file.toLowerCase().endsWith('.jsonl')
            ? '.jsonl'
            : file.toLowerCase().endsWith('.json')
              ? '.json'
              : 'other',
          fileSize: fs.statSync(file).size,
        })
        const report = await validateChatLabFile(file)
        const envelope = buildEnvelope(report)
        if (options.json) process.stdout.write(`${JSON.stringify(envelope)}\n`)
        else printHumanReport(report)

        appLogger.info('validate', 'ChatLab format validation completed', {
          valid: report.valid,
          errors: report.errorCount,
          warnings: report.warningCount,
          members: report.stats.memberCount,
          messages: report.stats.messageCount,
        })
        if (!report.valid) process.exitCode = 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const envelope: ValidateCommandEnvelope = {
          ok: false,
          command: 'validate',
          error: { code: 'VALIDATION_FAILED', message },
          meta: { apiVersion: 1 },
        }
        if (options.json) process.stdout.write(`${JSON.stringify(envelope)}\n`)
        else console.error(`Validation failed: ${message}`)
        appLogger.error('validate', 'ChatLab format validation failed', error)
        process.exitCode = 1
      }
    })
}
