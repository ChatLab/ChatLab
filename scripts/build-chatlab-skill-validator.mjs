import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = mkdtempSync(path.join(tmpdir(), 'chatlab-skill-validator-'))
const entryPath = path.join(tempDir, 'entry.ts')
const outputPath = path.join(tempDir, 'validate-chatlab.mjs')
const validatorPath = path.join(rootDir, 'packages/parser/src/chatlab-validator.ts')

const entrySource = `
import { existsSync } from 'node:fs'
import path from 'node:path'
import { validateChatLabFile } from ${JSON.stringify(validatorPath)}

const input = process.argv[2]

function write(envelope: unknown): void {
  process.stdout.write(\`${'${JSON.stringify(envelope)}'}\\n\`)
}

if (!input) {
  write({
    ok: false,
    command: 'validate',
    error: {
      code: 'MISSING_FILE',
      message: 'Usage: node validate-chatlab.mjs <file>',
    },
    meta: { apiVersion: 1, standalone: true },
  })
  process.exitCode = 2
} else {
  const file = path.resolve(input)
  if (!existsSync(file)) {
    write({
      ok: false,
      command: 'validate',
      error: {
        code: 'FILE_NOT_FOUND',
        message: \`File not found: ${'${file}'}\`,
        hint: 'Pass an absolute path or a path relative to the current working directory.',
      },
      meta: { apiVersion: 1, standalone: true },
    })
    process.exitCode = 3
  } else {
    try {
      const report = await validateChatLabFile(file)
      write(
        report.valid
          ? {
              ok: true,
              command: 'validate',
              data: report,
              meta: { apiVersion: 1, standalone: true },
            }
          : {
              ok: false,
              command: 'validate',
              data: report,
              error: {
                code: 'INVALID_CHATLAB_FORMAT',
                message: \`Validation found ${'${report.errorCount}'} error(s).\`,
                hint: 'Fix every error before importing the file into ChatLab.',
              },
              meta: { apiVersion: 1, standalone: true },
            }
      )
      if (!report.valid) process.exitCode = 1
    } catch (error) {
      write({
        ok: false,
        command: 'validate',
        error: {
          code: 'VALIDATION_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
        meta: { apiVersion: 1, standalone: true },
      })
      process.exitCode = 1
    }
  }
}
`

try {
  writeFileSync(entryPath, entrySource)
  execFileSync(
    'pnpm',
    [
      'exec',
      'esbuild',
      entryPath,
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--target=node20',
      '--minify',
      `--outfile=${outputPath}`,
      '--banner:js=#!/usr/bin/env node\n// Generated from the canonical ChatLab validator. Do not edit directly.',
    ],
    { cwd: rootDir, stdio: 'inherit' }
  )

  for (const skillName of ['chatlab-convert', 'chatlab-convert-cn']) {
    const scriptsDir = path.join(rootDir, 'skills', skillName, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    copyFileSync(outputPath, path.join(scriptsDir, 'validate-chatlab.mjs'))
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
