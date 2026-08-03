/**
 * End-to-end streaming import benchmark.
 *
 * Each measured run executes in a fresh process and writes fresh databases.
 * Fixture generation and result verification are excluded from the timed range.
 *
 * Usage:
 *   pnpm exec tsx scripts/bench-streaming-import.mts single 100000 [runs=3] [delta|full]
 *   pnpm exec tsx scripts/bench-streaming-import.mts batch 100 10000 [runs=3] [concurrency=1]
 *
 * Single-file runs also append 1,000 messages incrementally and measure a
 * representative LIKE query against the final database.
 */

import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { copyFileSync, createWriteStream, linkSync, mkdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { CHAT_DB_TABLES } from '@openchatlab/core'
import { getNativeParserStatus, isNativeFormatAvailable, type NativeParserStatus } from '@openchatlab/parser'
import { BetterSqliteAdapter } from '../packages/node-runtime/src/better-sqlite3-adapter'
import { computeAndSetOverviewCache } from '../packages/node-runtime/src/cache/session-cache'
import { runKeyedBatch } from '../packages/node-runtime/src/import/batch-coordinator'
import {
  analyzeIncrementalImport,
  incrementalImport,
  type IncrementalImportDeps,
} from '../packages/node-runtime/src/import/incremental-importer'
import {
  streamingImport,
  type ImportLogger,
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

interface BenchmarkParser {
  formatId: 'weflow'
  implementation: 'rust-native'
  nativeModuleAvailable: true
}

interface BenchmarkResult {
  scenario: 'single' | 'batch'
  parser: BenchmarkParser
  fileCount: number
  concurrency: number
  inputMessages: number
  inputBytes: number
  durationMs: number
  incrementalMode: 'delta' | 'full' | null
  incrementalInputMessages: number
  incrementalMessages: number
  incrementalDuplicateMessages: number
  incrementalAnalyzeDurationMs: number
  incrementalAnalyzeRssDeltaMb: number
  incrementalDurationMs: number
  incrementalImportRssDeltaMb: number
  sampledPeakRssMb: number
  sampledRssDeltaMb: number
  databaseBytes: number
  messagesWritten: number
  membersWritten: number
  outputSignature: string
  likeSearch: {
    coldMs: number
    warmMedianMs: number
    resultCount: number
    resultSignature: string
  }
  timings: ImportStageTimings
}

export interface BenchmarkParserMonitor {
  logger: ImportLogger
  assertRustNativeCompleted(importIndex: number): void
}

export function resolveBenchmarkParser(status: NativeParserStatus, nativeFormatAvailable: boolean): BenchmarkParser {
  if (!status.available || !nativeFormatAvailable) {
    const reason = status.disabled
      ? 'CHATLAB_DISABLE_NATIVE_PERF=1 disables the native parser'
      : status.error
        ? `native parser failed to load: ${status.error}`
        : 'the native parser does not provide the WeFlow kernel'
    throw new Error(
      `Streaming import benchmark requires the Rust Native WeFlow parser; ${reason}. ` +
        'Run pnpm build:native before collecting a baseline.'
    )
  }

  return {
    formatId: 'weflow',
    implementation: 'rust-native',
    nativeModuleAvailable: true,
  }
}

export function createBenchmarkParserMonitor(): BenchmarkParserMonitor {
  let nativeStarted = false
  let fallbackDetected = false
  const ignoreNonParserLog = () => undefined

  const inspectMessage = (message: string) => {
    if (message.includes('[NativeParser] Parsing WeFlow export with Rust kernel')) {
      nativeStarted = true
    }
    if (message.includes('[NativeParser]') && message.includes('falling back to TS parser')) {
      fallbackDetected = true
    }
  }

  return {
    logger: {
      info: inspectMessage,
      error: inspectMessage,
      perf: ignoreNonParserLog,
      perfDetail: ignoreNonParserLog,
      summary: ignoreNonParserLog,
      reset() {
        nativeStarted = false
        fallbackDetected = false
      },
      init: ignoreNonParserLog,
      getCurrentLogFile() {
        return null
      },
    },
    assertRustNativeCompleted(importIndex: number) {
      if (fallbackDetected) {
        throw new Error(`Import ${importIndex} fell back to the TypeScript WeFlow parser; benchmark result rejected`)
      }
      if (!nativeStarted) {
        throw new Error(`Import ${importIndex} did not start the Rust Native WeFlow parser; benchmark result rejected`)
      }
    },
  }
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
  checkpointMs: 0,
  sessionIndexMs: 0,
  postImportHookMs: 0,
  totalMs: 0,
})

function addTimings(target: ImportStageTimings, source: ImportStageTimings): void {
  for (const key of Object.keys(target) as Array<keyof ImportStageTimings>) target[key] += source[key]
}

async function generateWeflowFixture(filePath: string, count: number, startIndex = 0): Promise<void> {
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
    const absoluteIndex = startIndex + index
    const member = absoluteIndex % memberCount
    batch.push(
      JSON.stringify({
        localId: absoluteIndex + 1,
        createTime: 1_704_164_645 + absoluteIndex * 3,
        formattedTime: '2024-01-02 03:04:05',
        type: '文本消息',
        localType: 1,
        content: `${sampleTexts[absoluteIndex % sampleTexts.length]} #${absoluteIndex}`,
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

function createIncrementalDeps(
  dbPath: string,
  onSampleRss: () => void,
  onParserLog: NonNullable<IncrementalImportDeps['onParserLog']>
): IncrementalImportDeps {
  return {
    openDatabase() {
      const raw = new Database(dbPath, { nativeBinding })
      raw.pragma('journal_mode = WAL')
      raw.pragma('synchronous = NORMAL')
      return new BetterSqliteAdapter(raw)
    },
    onProgress() {
      onSampleRss()
    },
    onParserLog,
  }
}

function createImportDeps(dbPath: string, cacheDir: string, logger: ImportLogger): StreamImportDeps {
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
    logger,
    postImportHook(db, sessionId) {
      computeAndSetOverviewCache(db, sessionId, cacheDir)
    },
  }
}

export function inspectDatabase(dbPath: string): {
  messages: number
  members: number
  signature: string
} {
  const db = new Database(dbPath, { readonly: true, nativeBinding })
  const hash = createHash('sha256')
  const hashRows = (label: string, query: string): number => {
    hash.update(`table:${label}\n`)
    let count = 0
    let chunk = ''
    for (const row of db.prepare(query).raw().iterate() as Iterable<unknown[]>) {
      chunk += `${JSON.stringify(row)}\n`
      count++
      if (chunk.length >= 1024 * 1024) {
        hash.update(chunk)
        chunk = ''
      }
    }
    if (chunk) hash.update(chunk)
    return count
  }

  try {
    hashRows(
      'meta',
      `SELECT name, platform, type, group_id, group_avatar, owner_id, schema_version, session_gap_threshold
       FROM meta ORDER BY rowid`
    )
    const members = hashRows(
      'member',
      `SELECT id, platform_id, account_name, group_nickname, aliases, avatar, roles
       FROM member ORDER BY id`
    )
    hashRows(
      'member_name_history',
      `SELECT id, member_id, name_type, name, start_ts, end_ts
       FROM member_name_history ORDER BY id`
    )
    const messages = hashRows(
      'message',
      `SELECT id, sender_id, sender_account_name, sender_group_nickname, ts, type, content,
              reply_to_message_id, platform_message_id
       FROM message ORDER BY id`
    )
    hashRows(
      'segment',
      `SELECT id, start_ts, end_ts, message_count, is_manual, summary
       FROM segment ORDER BY id`
    )
    hashRows(
      'message_context',
      `SELECT message_id, segment_id, topic_id
       FROM message_context ORDER BY message_id`
    )
    const legacyFts = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_fts'").get()
    if (legacyFts) throw new Error('Benchmark database unexpectedly contains message_fts')
    return { messages, members, signature: hash.digest('hex') }
  } finally {
    db.close()
  }
}

function measureLikeSearch(dbPath: string): BenchmarkResult['likeSearch'] {
  const db = new Database(dbPath, { readonly: true, nativeBinding })
  const statement = db.prepare(
    `SELECT id, content
     FROM message
     WHERE content LIKE ? ESCAPE '\\'
     ORDER BY ts DESC, id DESC
     LIMIT 50`
  )
  // Match only the oldest synthetic row so ORDER BY cannot stop after finding
  // a few recent matches. This measures the existing LIKE path's full-scan cost.
  const params = ['%#0']
  const run = () => {
    const startedAt = performance.now()
    const rows = statement.all(...params) as Array<{ id: number; content: string }>
    return { durationMs: performance.now() - startedAt, rows }
  }

  try {
    const cold = run()
    const warmRuns = Array.from({ length: 5 }, run).sort((left, right) => left.durationMs - right.durationMs)
    const warmMedian = warmRuns[Math.floor(warmRuns.length / 2)]
    return {
      coldMs: cold.durationMs,
      warmMedianMs: warmMedian.durationMs,
      resultCount: cold.rows.length,
      resultSignature: createHash('sha256').update(JSON.stringify(cold.rows)).digest('hex').slice(0, 16),
    }
  } finally {
    db.close()
  }
}

async function runWorker(
  fileCount: number,
  messagesPerFile: number,
  concurrency: number,
  incrementalMode: 'delta' | 'full' | null
): Promise<BenchmarkResult> {
  if (typeof global.gc !== 'function') {
    throw new Error('Benchmark worker requires Node.js --expose-gc')
  }

  const parser = resolveBenchmarkParser(getNativeParserStatus(), isNativeFormatAvailable('weflow'))
  const root = createChatLabTempDir('bench', 'streaming-import-')
  const fixturePath = path.join(root, 'fixture.json')
  const incrementalFixturePath = path.join(root, 'incremental.json')
  const cacheDir = path.join(root, 'cache')
  mkdirSync(cacheDir, { recursive: true })

  try {
    await generateWeflowFixture(fixturePath, messagesPerFile)
    const incrementalMessages = fileCount === 1 ? 1000 : 0
    const incrementalInputMessages =
      incrementalMessages === 0
        ? 0
        : incrementalMode === 'full'
          ? messagesPerFile + incrementalMessages
          : incrementalMessages
    const incrementalDuplicateMessages = incrementalMode === 'full' ? messagesPerFile : 0
    if (incrementalMessages > 0) {
      if (incrementalMode === 'full') {
        await generateWeflowFixture(incrementalFixturePath, incrementalInputMessages)
      } else {
        await generateWeflowFixture(incrementalFixturePath, incrementalMessages, messagesPerFile)
      }
    }
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

    global.gc()
    const rssStartMb = process.memoryUsage().rss / 1024 / 1024
    const timings = zeroTimings()
    let sampledPeakRssMb = rssStartMb
    const dbPaths: string[] = []
    const startedAt = performance.now()

    await runKeyedBatch(
      inputPaths.map((inputPath, index) => ({
        value: { inputPath, index },
        key: `session:${index}`,
      })),
      {
        concurrency,
        async run({ inputPath, index }) {
          const dbPath = path.join(root, `session-${index}.db`)
          dbPaths[index] = dbPath
          const parserMonitor = createBenchmarkParserMonitor()
          const result = await streamingImport(
            inputPath,
            createImportDeps(dbPath, cacheDir, parserMonitor.logger),
            { formatId: 'weflow' },
            `bench-${index}`
          )
          if (!result.success || !result.diagnostics?.performance) {
            throw new Error(`Import ${index} failed: ${result.error ?? 'missing performance diagnostics'}`)
          }
          parserMonitor.assertRustNativeCompleted(index)
          addTimings(timings, result.diagnostics.performance.timings)
          sampledPeakRssMb = Math.max(sampledPeakRssMb, result.diagnostics.performance.rssSampledPeakMb)
        },
      }
    )
    const durationMs = performance.now() - startedAt

    let incrementalAnalyzeDurationMs = 0
    let incrementalAnalyzeRssDeltaMb = 0
    let incrementalDurationMs = 0
    let incrementalImportRssDeltaMb = 0
    if (incrementalMessages > 0) {
      global.gc()
      let rssStartMb = process.memoryUsage().rss / 1024 / 1024
      let rssPeakMb = rssStartMb
      const sampleIncrementalRss = () => {
        rssPeakMb = Math.max(rssPeakMb, process.memoryUsage().rss / 1024 / 1024)
      }
      const incrementalParserMonitor = createBenchmarkParserMonitor()
      const incrementalDeps = createIncrementalDeps(dbPaths[0], sampleIncrementalRss, (_level, message) => {
        incrementalParserMonitor.logger.info(message)
      })

      incrementalParserMonitor.logger.reset()
      const analyzeStartedAt = performance.now()
      const analysis = await analyzeIncrementalImport('bench-0', incrementalFixturePath, incrementalDeps, {
        formatId: 'weflow',
      })
      incrementalAnalyzeDurationMs = performance.now() - analyzeStartedAt
      incrementalParserMonitor.assertRustNativeCompleted(0)
      sampleIncrementalRss()
      incrementalAnalyzeRssDeltaMb = Math.max(0, rssPeakMb - rssStartMb)
      if (
        analysis.newMessageCount !== incrementalMessages ||
        analysis.duplicateCount !== incrementalDuplicateMessages ||
        analysis.totalInFile !== incrementalInputMessages
      ) {
        throw new Error(
          `Incremental analysis mismatch: expected ${incrementalMessages} new/${incrementalDuplicateMessages} duplicate/${incrementalInputMessages} total, ` +
            `got ${analysis.newMessageCount}/${analysis.duplicateCount}/${analysis.totalInFile}`
        )
      }

      global.gc()
      rssStartMb = process.memoryUsage().rss / 1024 / 1024
      rssPeakMb = rssStartMb
      incrementalParserMonitor.logger.reset()
      const incrementalStartedAt = performance.now()
      const result = await incrementalImport('bench-0', incrementalFixturePath, incrementalDeps, {
        formatId: 'weflow',
      })
      incrementalDurationMs = performance.now() - incrementalStartedAt
      incrementalParserMonitor.assertRustNativeCompleted(0)
      sampleIncrementalRss()
      incrementalImportRssDeltaMb = Math.max(0, rssPeakMb - rssStartMb)
      if (
        !result.success ||
        result.newMessageCount !== incrementalMessages ||
        result.batch?.duplicateCount !== incrementalDuplicateMessages
      ) {
        throw new Error(
          `Incremental import failed: expected ${incrementalMessages} new/${incrementalDuplicateMessages} duplicate, ` +
            `got ${result.newMessageCount}/${result.batch?.duplicateCount ?? 'missing'} (${result.error ?? 'unknown error'})`
        )
      }
    }

    let messagesWritten = 0
    let membersWritten = 0
    let databaseBytes = 0
    const signatures: string[] = []
    let likeSearch: BenchmarkResult['likeSearch'] | undefined
    for (const dbPath of dbPaths) {
      const inspected = inspectDatabase(dbPath)
      messagesWritten += inspected.messages
      membersWritten += inspected.members
      signatures.push(inspected.signature)
      databaseBytes += statSync(dbPath).size
      likeSearch ??= measureLikeSearch(dbPath)
    }

    return {
      scenario: fileCount === 1 ? 'single' : 'batch',
      parser,
      fileCount,
      concurrency,
      inputMessages: fileCount * messagesPerFile,
      inputBytes: statSync(fixturePath).size * fileCount,
      durationMs,
      incrementalMode,
      incrementalInputMessages,
      incrementalMessages,
      incrementalDuplicateMessages,
      incrementalAnalyzeDurationMs,
      incrementalAnalyzeRssDeltaMb,
      incrementalDurationMs,
      incrementalImportRssDeltaMb,
      sampledPeakRssMb,
      sampledRssDeltaMb: Math.max(0, sampledPeakRssMb - rssStartMb),
      databaseBytes,
      messagesWritten,
      membersWritten,
      outputSignature: createHash('sha256').update(signatures.sort().join(':')).digest('hex'),
      likeSearch: likeSearch!,
      timings,
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function runIsolated(
  fileCount: number,
  messagesPerFile: number,
  concurrency: number,
  incrementalMode: 'delta' | 'full' | null
): BenchmarkResult {
  const child = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      ...process.execArgv,
      scriptPath,
      '--worker',
      String(fileCount),
      String(messagesPerFile),
      String(concurrency),
      incrementalMode ?? 'none',
    ],
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

function medianNumber(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint]
}

function buildMedianResult(results: BenchmarkResult[]): BenchmarkResult {
  const representative = results[0]
  const medianTiming = (key: keyof ImportStageTimings) => medianNumber(results.map((result) => result.timings[key]))

  return {
    ...representative,
    inputBytes: medianNumber(results.map((result) => result.inputBytes)),
    durationMs: medianNumber(results.map((result) => result.durationMs)),
    incrementalAnalyzeDurationMs: medianNumber(results.map((result) => result.incrementalAnalyzeDurationMs)),
    incrementalAnalyzeRssDeltaMb: medianNumber(results.map((result) => result.incrementalAnalyzeRssDeltaMb)),
    incrementalDurationMs: medianNumber(results.map((result) => result.incrementalDurationMs)),
    incrementalImportRssDeltaMb: medianNumber(results.map((result) => result.incrementalImportRssDeltaMb)),
    sampledPeakRssMb: medianNumber(results.map((result) => result.sampledPeakRssMb)),
    sampledRssDeltaMb: medianNumber(results.map((result) => result.sampledRssDeltaMb)),
    databaseBytes: medianNumber(results.map((result) => result.databaseBytes)),
    likeSearch: {
      ...representative.likeSearch,
      coldMs: medianNumber(results.map((result) => result.likeSearch.coldMs)),
      warmMedianMs: medianNumber(results.map((result) => result.likeSearch.warmMedianMs)),
    },
    timings: {
      detectionMs: medianTiming('detectionMs'),
      preprocessingMs: medianTiming('preprocessingMs'),
      databaseSetupMs: medianTiming('databaseSetupMs'),
      parserMs: medianTiming('parserMs'),
      metaWriteMs: medianTiming('metaWriteMs'),
      memberWriteMs: medianTiming('memberWriteMs'),
      messageWriteMs: medianTiming('messageWriteMs'),
      nicknameHistoryMs: medianTiming('nicknameHistoryMs'),
      indexCreationMs: medianTiming('indexCreationMs'),
      checkpointMs: medianTiming('checkpointMs'),
      sessionIndexMs: medianTiming('sessionIndexMs'),
      postImportHookMs: medianTiming('postImportHookMs'),
      totalMs: medianTiming('totalMs'),
    },
  }
}

function printResult(result: BenchmarkResult, label: string): void {
  console.log(
    `${label}: parser ${result.parser.implementation} | ${result.durationMs.toFixed(0)} ms | ` +
      `incremental ${result.incrementalMode ?? 'none'} ` +
      `${result.incrementalAnalyzeDurationMs.toFixed(0)} ms analyze/${result.incrementalDurationMs.toFixed(0)} ms import ` +
      `(${result.incrementalMessages} new/${result.incrementalDuplicateMessages} duplicate) | ` +
      `incremental RSS +${result.incrementalAnalyzeRssDeltaMb.toFixed(0)} MB analyze/` +
      `+${result.incrementalImportRssDeltaMb.toFixed(0)} MB import | ` +
      `sampled peak RSS ${result.sampledPeakRssMb.toFixed(0)} MB ` +
      `(+${result.sampledRssDeltaMb.toFixed(0)} MB) | DB ${formatBytes(result.databaseBytes)} | ` +
      `LIKE ${result.likeSearch.coldMs.toFixed(1)} ms cold/${result.likeSearch.warmMedianMs.toFixed(1)} ms warm | ` +
      `signature ${result.outputSignature}`
  )
}

async function main(): Promise<void> {
  const [mode, first, second, third, fourth] = process.argv.slice(2)
  if (mode === '--worker') {
    const workerIncrementalMode = fourth === 'delta' || fourth === 'full' ? fourth : null
    const result = await runWorker(Number(first), Number(second), Number(third), workerIncrementalMode)
    console.log(`BENCH_RESULT ${JSON.stringify(result)}`)
    return
  }

  let fileCount: number
  let messagesPerFile: number
  let runs: number
  let concurrency: number
  let incrementalMode: 'delta' | 'full' | null
  if (mode === 'single') {
    fileCount = 1
    messagesPerFile = Number(first ?? 100_000)
    runs = Number(second ?? 3)
    concurrency = 1
    incrementalMode = third === 'full' ? 'full' : 'delta'
    if (third !== undefined && third !== 'delta' && third !== 'full') {
      throw new Error('Incremental mode must be delta or full')
    }
  } else if (mode === 'batch') {
    fileCount = Number(first ?? 100)
    messagesPerFile = Number(second ?? 10_000)
    runs = Number(third ?? 3)
    concurrency = Number(fourth ?? 1)
    incrementalMode = null
  } else {
    throw new Error(
      'Usage: single <messages> [runs=3] [incremental-mode=delta|full] | ' +
        'batch <files> <messages-per-file> [runs=3] [concurrency=1]'
    )
  }
  if (![fileCount, messagesPerFile, runs, concurrency].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('All benchmark counts must be positive integers')
  }

  console.log(
    `Benchmarking ${fileCount} file(s), ${messagesPerFile.toLocaleString()} messages/file, concurrency ${concurrency}, ${runs} isolated run(s)`
  )
  const results: BenchmarkResult[] = []
  for (let index = 0; index < runs; index++) {
    const result = runIsolated(fileCount, messagesPerFile, concurrency, incrementalMode)
    results.push(result)
    printResult(result, `run ${index + 1}`)
  }

  const median = buildMedianResult(results)
  const parserSignatures = new Set(results.map((result) => JSON.stringify(result.parser)))
  if (parserSignatures.size !== 1) {
    throw new Error('Parser implementations differ between isolated runs')
  }
  if (results.some((result) => result.outputSignature !== median.outputSignature)) {
    throw new Error('Output signatures differ between isolated runs')
  }
  if (
    results.some(
      (result) =>
        result.likeSearch.resultCount !== 1 || result.likeSearch.resultSignature !== median.likeSearch.resultSignature
    )
  ) {
    throw new Error('LIKE search results differ between isolated runs or do not match the expected fixture row')
  }
  const expectedMessages = fileCount * messagesPerFile + median.incrementalMessages
  if (median.messagesWritten !== expectedMessages) {
    throw new Error(`Expected ${expectedMessages} messages, got ${median.messagesWritten}`)
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

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
