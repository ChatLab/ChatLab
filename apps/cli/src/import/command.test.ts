import assert from 'node:assert/strict'
import test from 'node:test'
import { Command } from 'commander'
import { buildImportCommandEnvelope, registerImportCommand, withJsonDiagnosticsOnStderr } from './command'

test('buildImportCommandEnvelope exposes a stable dry-run success contract', () => {
  assert.deepEqual(
    buildImportCommandEnvelope(
      {
        success: true,
        importMode: 'incremental',
        sessionId: 'existing',
        matchedBy: 'stable-id',
        totalMessageCount: 12,
        newMessageCount: 4,
        duplicateCount: 8,
      },
      true
    ),
    {
      ok: true,
      command: 'import',
      data: {
        success: true,
        importMode: 'incremental',
        sessionId: 'existing',
        matchedBy: 'stable-id',
        totalMessageCount: 12,
        newMessageCount: 4,
        duplicateCount: 8,
      },
      meta: { dryRun: true, apiVersion: 1 },
    }
  )
})

test('buildImportCommandEnvelope maps import-lock failures for agents', () => {
  assert.deepEqual(buildImportCommandEnvelope({ success: false, error: 'error.import_in_progress' }, false), {
    ok: false,
    command: 'import',
    error: {
      code: 'IMPORT_IN_PROGRESS',
      message: 'Another import is already in progress.',
      hint: 'Wait for the active import to finish, then retry.',
    },
    meta: { dryRun: false, apiVersion: 1 },
  })
})

test('withJsonDiagnosticsOnStderr keeps runtime diagnostics out of machine-readable stdout', async () => {
  const stdout: string[] = []
  const stderr: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: unknown[]) => stdout.push(args.join(' '))
  console.error = (...args: unknown[]) => stderr.push(args.join(' '))

  try {
    await withJsonDiagnosticsOnStderr(true, async () => {
      console.log('[Parser V2] Using parser: ChatLab JSON')
    })
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  assert.deepEqual(stdout, [])
  assert.deepEqual(stderr, ['[Parser V2] Using parser: ChatLab JSON'])
})

test('import rejects --session-id together with --new-session before touching the data directory', async () => {
  const program = new Command()
  program.exitOverride()
  registerImportCommand(program)

  const stdout: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const originalExitCode = process.exitCode
  process.stdout.write = ((chunk: string) => {
    stdout.push(String(chunk))
    return true
  }) as typeof process.stdout.write

  try {
    await program.parseAsync(['import', 'missing-file.json', '--json', '--session-id', 'target', '--new-session'], {
      from: 'user',
    })
  } finally {
    process.stdout.write = originalWrite
    process.exitCode = originalExitCode
  }

  assert.deepEqual(JSON.parse(stdout.join('')), {
    ok: false,
    command: 'import',
    error: {
      code: 'CONFLICTING_TARGET_OPTIONS',
      message: 'Use either --session-id or --new-session, not both',
      hint: '--session-id appends to an existing session; --new-session always creates a separate one.',
    },
    meta: { dryRun: false, apiVersion: 1 },
  })
})
