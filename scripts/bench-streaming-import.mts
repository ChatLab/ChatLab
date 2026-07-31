/**
 * End-to-end streaming import benchmark.
 *
 * Each measured run executes in a fresh process and writes fresh databases.
 * Fixture generation and result verification are excluded from the timed range.
 *
 * Usage:
 *   pnpm exec tsx scripts/bench-streaming-import.mts single 100000 [runs=3]
 *   pnpm exec tsx scripts/bench-streaming-import.mts batch 100 10000 [runs=3]
 */

import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { copyFileSync, createWriteStream, linkSync, mkdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { CHAT_DB_TABLES } from '@openchatlab/core'
import { BetterSqliteAdapter } from '../packages/node-runtime/src/better-sqlite3-adapter'
import { computeAndSetOverviewCache } from '../packages/node-runtime/src/cache/session-cache'
import {
  streamingImport,
  type ImportStageTimings,
  type StreamImportDeps,
} from '../packages/node-runtime/src/import/streaming-importer'
import { createChatLabTempDir } from './chatlab-temp.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')
const memberCount = 200
const sampleTexts = [
  '今天天气不错，我们出去玩吧！',
  '哈哈哈哈哈哈这也太好笑了',
  '[图片]',
  '好的，收到，明天见。',
  'This is a mixed language message with some English words 和中文混排。',
  '周末有人一起打球吗？地点老地方，时间下午三点，人齐就开打。',
]

interface BenchmarkResult {
  scenario: 'single' | 'batch'
  fileCount: number
  inputMessages: number
  inputBytes: number
  durationMs: number
  peakRssMb: number
  rssDeltaMb: number
  databaseBytes: number
  messagesWritten: number
  membersWritten: number
  outputSignature: string
  timings: ImportStageTimings
}

const zeroTimings = (): ImportStageTimings => ({
  detectionMs: 0,
  preprocessingMs: 0,
  databaseSetupMs: 0,
  parserMs: 0,
  metaWriteMs: 0,
  memberWriteMs: 0,
  messageWriteMs: 0,
  nicknameHistoryMs: 0,
  indexCreationMs: 0,
  ftsMs: 0,
  checkpointMs: 0,
  sessionIndexMs: 0,
  postImportHookMs: 0,
  totalMs: 0,
})

function addTimings(target: ImportStageTimings, source: ImportStageTimings): void {
  for (const key of Object.keys(target) as Array<keyof ImportStageTimings>) target[key] += source[key]
}

async function generateWeflowFixture(filePath: string, count: number): Promise<void> {
  const stream = createWriteStream(filePath, { encoding: 'utf-8' })
  const write = async (chunk: string) => {
    if (!stream.write(chunk)) await once(stream, 'drain')
  }

  await write(
    `{"weflow":{"version":"1.0.0","exportedAt":1704164645},` +
      `"session":{"wxid":"bench@chatroom","nickname":"性能测试群","displayName":"性能测试群","type":"群聊"},` +
      '"avatars":{},"messages":['
  )

  const batch: string[] = []
  for (let index = 0; index < count; index++) {
    const member = index % memberCount
    batch.push(
      JSON.stringify({
        localId: index + 1,
        createTime: 1_704_164_645 + index * 3,
        formattedTime: '2024-01-02 03:04:05',
        type: '文本消息',
        localType: 1,
        content: `${sampleTexts[index % sampleTexts.length]} #${index}`,
        isSend: member === 0 ? 1 : 0,
        senderUsername: `wxid_member_${member}`,
        senderDisplayName: `成员${member}号`,
        senderAvatarKey: `wxid_member_${member}`,
        source: '',
      })
    )
    if (batch.length >= 5000) {
      await write((index + 1 > batch.length ? ',' : '') + batch.join(','))
      batch.length = 0
    }
  }
  if (batch.length > 0) await write((count > batch.length ? ',' : '') + batch.join(','))
  await write(']}')
  stream.end()
  await once(stream, 'finish')
}

function createImportDeps(dbPath: string, cacheDir: string): StreamImportDeps {
  return {
    openDatabase() {
      const raw = new Database(dbPath, { nativeBinding })
      raw.pragma('journal_mode = WAL')
      raw.pragma('synchronous = NORMAL')
      raw.exec(CHAT_DB_TABLES)
      return new BetterSqliteAdapter(raw)
    },
    deleteDatabase() {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(dbPath + suffix)
        } catch {
          /* ignore cleanup failures in a disposable benchmark workspace */
        }
      }
    },
    onProgress() {
      /* benchmark excludes UI transport */
    },
    postImportHook(db, sessionId) {
      computeAndSetOverviewCache(db, sessionId, cacheDir)
    },
  }
}

function inspectDatabase(dbPath: string): {
  messages: number
  members: number
  signature: string
} {
  const db = new Database(dbPath, { readonly: true, nativeBinding })
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM message) AS messages,
         (SELECT COUNT(*) FROM member) AS members,
         (SELECT COALESCE(SUM(ts), 0) FROM message) AS timestampSum,
         (SELECT COALESCE(SUM(sender_id), 0) FROM message) AS senderSum,
         (SELECT COALESCE(SUM(type), 0) FROM message) AS typeSum,
         (SELECT COALESCE(SUM(LENGTH(content)), 0) FROM message) AS contentLengthSum`
    )
    .get() as Record<string, number>
  db.close()
  const signature = createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0, 16)
  return { messages: row.messages, members: row.members, signature }
}

async function runWorker(fileCount: number, messagesPerFile: number): Promise<BenchmarkResult> {
  const root = createChatLabTempDir('bench', 'streaming-import-')
  const fixturePath = path.join(root, 'fixture.json')
  const cacheDir = path.join(root, 'cache')
  mkdirSync(cacheDir, { recursive: true })

  try {
    await generateWeflowFixture(fixturePath, messagesPerFile)
    const inputPaths = [fixturePath]
    for (let index = 1; index < fileCount; index++) {
      const linkedPath = path.join(root, `fixture-${index}.json`)
      try {
        linkSync(fixturePath, linkedPath)
      } catch {
        copyFileSync(fixturePath, linkedPath)
      }
      inputPaths.push(linkedPath)
    }

    global.gc?.()
    const rssStartMb = process.memoryUsage().rss / 1024 / 1024
    const timings = zeroTimings()
    let peakRssMb = rssStartMb
    const dbPaths: string[] = []
    const startedAt = performance.now()

    for (let index = 0; index < inputPaths.length; index++) {
      const dbPath = path.join(root, `session-${index}.db`)
      dbPaths.push(dbPath)
      const result = await streamingImport(
        inputPaths[index],
        createImportDeps(dbPath, cacheDir),
        { formatId: 'weflow' },
        `bench-${index}`
      )
      if (!result.success || !result.diagnostics?.performance) {
        throw new Error(`Import ${index} failed: ${result.error ?? 'missing performance diagnostics'}`)
      }
      addTimings(timings, result.diagnostics.performance.timings)
      peakRssMb = Math.max(peakRssMb, result.diagnostics.performance.rssPeakMb)
    }
    const durationMs = performance.now() - startedAt

    let messagesWritten = 0
    let membersWritten = 0
    let databaseBytes = 0
    const signatures: string[] = []
    for (const dbPath of dbPaths) {
      const inspected = inspectDatabase(dbPath)
      messagesWritten += inspected.messages
      membersWritten += inspected.members
      signatures.push(inspected.signature)
      databaseBytes += statSync(dbPath).size
    }

    return {
      scenario: fileCount === 1 ? 'single' : 'batch',
      fileCount,
      inputMessages: fileCount * messagesPerFile,
      inputBytes: statSync(fixturePath).size * fileCount,
      durationMs,
      peakRssMb,
      rssDeltaMb: Math.max(0, peakRssMb - rssStartMb),
      databaseBytes,
      messagesWritten,
      membersWritten,
      outputSignature: createHash('sha256').update(signatures.sort().join(':')).digest('hex').slice(0, 16),
      timings,
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function runIsolated(fileCount: number, messagesPerFile: number): BenchmarkResult {
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, scriptPath, '--worker', String(fileCount), String(messagesPerFile)],
    {
      cwd: process.cwd(),
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    }
  )
  if (child.status !== 0) {
    throw new Error(`Benchmark worker failed (${child.status}):\n${child.stdout}\n${child.stderr}`)
  }
  const resultLine = child.stdout.split('\n').find((line) => line.startsWith('BENCH_RESULT '))
  if (!resultLine) throw new Error(`Benchmark worker returned no result:\n${child.stdout}\n${child.stderr}`)
  return JSON.parse(resultLine.slice('BENCH_RESULT '.length)) as BenchmarkResult
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function printResult(result: BenchmarkResult, label: string): void {
  console.log(
    `${label}: ${result.durationMs.toFixed(0)} ms | peak RSS ${result.peakRssMb.toFixed(0)} MB ` +
      `(+${result.rssDeltaMb.toFixed(0)} MB) | DB ${formatBytes(result.databaseBytes)} | ` +
      `signature ${result.outputSignature}`
  )
}

async function main(): Promise<void> {
  const [mode, first, second, third] = process.argv.slice(2)
  if (mode === '--worker') {
    const result = await runWorker(Number(first), Number(second))
    console.log(`BENCH_RESULT ${JSON.stringify(result)}`)
    return
  }

  let fileCount: number
  let messagesPerFile: number
  let runs: number
  if (mode === 'single') {
    fileCount = 1
    messagesPerFile = Number(first ?? 100_000)
    runs = Number(second ?? 3)
  } else if (mode === 'batch') {
    fileCount = Number(first ?? 100)
    messagesPerFile = Number(second ?? 10_000)
    runs = Number(third ?? 3)
  } else {
    throw new Error('Usage: single <messages> [runs=3] | batch <files> <messages-per-file> [runs=3]')
  }
  if (![fileCount, messagesPerFile, runs].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('All benchmark counts must be positive integers')
  }

  console.log(
    `Benchmarking ${fileCount} file(s), ${messagesPerFile.toLocaleString()} messages/file, ${runs} isolated run(s)`
  )
  const results: BenchmarkResult[] = []
  for (let index = 0; index < runs; index++) {
    const result = runIsolated(fileCount, messagesPerFile)
    results.push(result)
    printResult(result, `run ${index + 1}`)
  }

  const sorted = [...results].sort((left, right) => left.durationMs - right.durationMs)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (results.some((result) => result.outputSignature !== median.outputSignature)) {
    throw new Error('Output signatures differ between isolated runs')
  }
  if (median.messagesWritten !== fileCount * messagesPerFile) {
    throw new Error(`Expected ${fileCount * messagesPerFile} messages, got ${median.messagesWritten}`)
  }

  printResult(median, 'median')
  const stageRows = Object.entries(median.timings)
    .filter(([stage]) => stage !== 'totalMs')
    .sort(([, left], [, right]) => right - left)
  console.log('Median phase totals:')
  for (const [stage, durationMs] of stageRows) {
    console.log(`  ${stage.padEnd(22)} ${durationMs.toFixed(1).padStart(10)} ms`)
  }
}

await main()
