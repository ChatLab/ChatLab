#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function parseArgs(argv) {
  const options = { sessions: 100, messages: 200 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    const next = () => {
      const value = argv[index + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      index += 1
      return value
    }
    if (arg === '--database-dir') options.databaseDir = resolve(next())
    else if (arg === '--cache-dir') options.cacheDir = resolve(next())
    else if (arg === '--sessions') options.sessions = parsePositiveInteger(next(), arg)
    else if (arg === '--messages') options.messages = parsePositiveInteger(next(), arg)
    else if (arg === '--help') {
      console.log(`Usage: pnpm bench:startup:fixture -- --database-dir <path> --cache-dir <path> [options]

Creates valid group-chat databases and matching overview caches for local
startup benchmarks. Both output directories must be empty.

Options:
  --sessions <count>  Session databases to create (default: 100)
  --messages <count>  Messages in each session (default: 200)
`)
      process.exit(0)
    } else throw new Error(`Unknown option: ${arg}`)
  }
  if (!options.databaseDir || !options.cacheDir) {
    throw new Error('--database-dir and --cache-dir are required')
  }
  return options
}

async function ensureEmptyDirectory(directory) {
  if (existsSync(directory) && (await readdir(directory)).length > 0) {
    throw new Error(`Refusing to write benchmark fixtures into non-empty directory: ${directory}`)
  }
  await mkdir(directory, { recursive: true })
}

const SCHEMA = `
  CREATE TABLE meta (
    name TEXT,
    platform TEXT,
    type TEXT,
    imported_at INTEGER,
    group_id TEXT,
    group_avatar TEXT,
    owner_id TEXT,
    session_gap_threshold INTEGER
  );
  CREATE TABLE member (
    id INTEGER PRIMARY KEY,
    platform_id TEXT,
    account_name TEXT,
    group_nickname TEXT,
    avatar TEXT
  );
  CREATE TABLE message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    ts INTEGER,
    type INTEGER,
    content TEXT,
    platform_message_id TEXT
  );
  CREATE TABLE segment (
    id INTEGER PRIMARY KEY,
    start_ts INTEGER,
    end_ts INTEGER,
    message_count INTEGER,
    is_manual INTEGER DEFAULT 0,
    summary TEXT
  );
`

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await ensureEmptyDirectory(options.databaseDir)
  await ensureEmptyDirectory(options.cacheDir)
  const nativeBinding = fileURLToPath(new URL('../apps/cli/native/better_sqlite3.node', import.meta.url))

  for (let index = 1; index <= options.sessions; index += 1) {
    const sessionId = `benchmark-${String(index).padStart(3, '0')}`
    const db = new Database(resolve(options.databaseDir, `${sessionId}.db`), { nativeBinding })
    try {
      db.exec(SCHEMA)
      db.prepare(
        `INSERT INTO meta (name, platform, type, imported_at, group_id, owner_id)
         VALUES (?, 'benchmark', 'group', ?, ?, NULL)`
      ).run(`Benchmark Session ${index}`, 2_000_000_000 - index, sessionId)
      db.prepare(
        `INSERT INTO member (id, platform_id, account_name, group_nickname, avatar)
         VALUES (1, 'member-1', 'Benchmark Member', 'Benchmark Member', NULL)`
      ).run()

      const insertMessage = db.prepare(
        `INSERT INTO message (sender_id, ts, type, content, platform_message_id)
         VALUES (1, ?, 0, 'benchmark message', ?)`
      )
      db.transaction(() => {
        for (let message = 1; message <= options.messages; message += 1) {
          insertMessage.run(1_700_000_000 + message, `${sessionId}-${message}`)
        }
      })()
    } finally {
      db.close()
    }

    const cache = {
      overview: {
        data: {
          totalMessages: options.messages,
          totalMembers: 1,
          firstMessageTs: 1_700_000_001,
          lastMessageTs: 1_700_000_000 + options.messages,
          maxMessageId: options.messages,
        },
        ts: Math.floor(Date.now() / 1_000),
      },
    }
    await writeFile(resolve(options.cacheDir, `${sessionId}.cache.json`), JSON.stringify(cache), 'utf8')
  }

  console.log(`Created ${options.sessions} cached sessions (${options.messages} messages each).`)
  console.log(`Databases: ${options.databaseDir}`)
  console.log(`Caches:    ${options.cacheDir}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
