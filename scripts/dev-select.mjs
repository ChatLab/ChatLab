#!/usr/bin/env node

/**
 * Interactive dev mode selector.
 * Usage: node scripts/dev-select.mjs
 *
 * Arrow keys to move, Enter to confirm.
 * Remembers last selection in node_modules/.cache/dev-mode.
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const cacheFile = join(rootDir, 'node_modules', '.cache', 'dev-mode')

const options = [
  { key: 'desktop', label: 'Desktop      (Electron)', command: 'pnpm run dev:desktop' },
  { key: 'cli-web', label: 'CLI Web      (Node + frontend)', command: 'pnpm run dev:cli-web' },
  { key: 'server', label: 'API Server   (CLI Web backend only)', command: 'pnpm run dev:serve' },
  { key: 'web-wasm', label: 'Web WASM     (Browser only)', command: 'pnpm run dev:web-wasm' },
  { key: 'docs', label: 'Docs         (VitePress)', command: 'pnpm run docs:dev' },
]

function loadLastChoice() {
  try {
    const key = readFileSync(cacheFile, 'utf8').trim()
    const idx = options.findIndex((o) => o.key === key)
    return idx >= 0 ? idx : 0
  } catch {
    return 0
  }
}

function saveChoice(key) {
  try {
    mkdirSync(dirname(cacheFile), { recursive: true })
    writeFileSync(cacheFile, key)
  } catch {
    // best-effort
  }
}

let selected = loadLastChoice()

function render() {
  process.stdout.write(`\x1b[${options.length}A`)
  for (let i = 0; i < options.length; i++) {
    const prefix = i === selected ? '\x1b[36m❯\x1b[0m' : ' '
    const text = i === selected ? `\x1b[1m${options[i].label}\x1b[0m` : options[i].label
    process.stdout.write(`\x1b[2K  ${prefix} ${text}\n`)
  }
}

function run() {
  console.log('\n\x1b[1mSelect dev mode:\x1b[0m  (↑↓ to move, Enter to confirm)\n')
  for (let i = 0; i < options.length; i++) process.stdout.write('\n')
  render()

  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')

  process.stdin.on('data', (key) => {
    if (key === '\x1b[A') {
      selected = (selected - 1 + options.length) % options.length
      render()
    } else if (key === '\x1b[B') {
      selected = (selected + 1) % options.length
      render()
    } else if (key === '\r' || key === '\n') {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      const choice = options[selected]
      saveChoice(choice.key)
      console.log(`\n\x1b[32m▶\x1b[0m Running: ${choice.command}\n`)
      try {
        execSync(choice.command, { stdio: 'inherit' })
      } catch {
        process.exit(1)
      }
    } else if (key === '\x03') {
      process.stdin.setRawMode(false)
      console.log()
      process.exit(0)
    }
  })
}

run()
