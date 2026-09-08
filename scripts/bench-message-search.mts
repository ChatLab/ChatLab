/**
 * Message keyword search benchmark.
 *
 * Builds a synthetic chat database directly with better-sqlite3 and the shared
 * CHAT_DB_SCHEMA (no parser involved), then measures the core keyword search
 * path — searchMessagesByKeywords() — over a fixed twelve-query set.
 *
 * When @openchatlab/core exports ensureMessageSearchIndex the index is built
 * after the rows are inserted and its duration is recorded. On code that does
 * not export it the run is a baseline measurement of the LIKE-only path and
 * `searchIndex` is null.
 *
 * Every query is measured once on a fresh connection (cold) and then `runs`
 * times on that connection (warm). The sha256 of the full sorted hit-id set is
 * recorded so that before/after runs can be compared for recall.
 *
 * Usage:
 *   pnpm exec tsx scripts/bench-message-search.mts [messages=100000] [runs=5] [--out <json>]
 */

import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { CHAT_DB_SCHEMA, searchMessagesByKeywords, type DatabaseAdapter } from '@openchatlab/core'
import * as coreExports from '@openchatlab/core'
import { MessageType } from '@openchatlab/shared-types'
import { BetterSqliteAdapter } from '../packages/node-runtime/src/better-sqlite3-adapter'
import { createChatLabTempDir } from './chatlab-temp.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

/** Corpus is fully determined by this seed plus the message count. */
const CORPUS_SEED = 0x5ea2_c1ab
const BASE_TIMESTAMP = 1_704_164_645
const TIMESTAMP_STEP_SECONDS = 3
const MEMBER_COUNT = 20
const INSERT_CHUNK_SIZE = 100_000
const IMAGE_PLACEHOLDER = '[图片]'
const IMAGE_RATIO = 0.05
/** Result page size for the timed runs; matches searchMessagesByKeywords' own default. */
const QUERY_LIMIT = 50

/** The six sentences used by scripts/bench-streaming-import.mts. */
const SAMPLE_TEXTS = [
  '今天天气不错，我们出去玩吧！',
  '哈哈哈哈哈哈这也太好笑了',
  IMAGE_PLACEHOLDER,
  '好的，收到，明天见。',
  'This is a mixed language message with some English words 和中文混排。',
  '周末有人一起打球吗？地点老地方，时间下午三点，人齐就开打。',
]

/** 300 common Chinese characters, used to synthesize high-entropy short sentences. */
const CHINESE_CHARACTERS =
  '的一了是我不在人们有来他这上着个地到大里说就去子得也和那要下看天时过出小么起你都把好还多没为又可家学只以主会样年想生同老中十从自面前头道它后然走很像见两用她国动进成回什边作对开而己些现山民候经发工向事命给长水几义三声于高手知理眼志点心战二问但身方实吃做叫当住听革打呢真全才四已所敌之最光产情路分总条白话东席次亲如被花口放儿常气五第使写军吧文运再果怎定许快明行因别飞外树物活部门无往船望新带队先力完却站代员机更九您每风级跟笑啊孩万少直意夜比阶连车重便斗马哪化太指变社似士者干石满日决百原拿群究各六本思解立河村八难早论吗根共让相研今其书坐接应关信觉步反处记将千找争领或师结块跑谁草越字加脚紧爱等习阵怕月青'

/** 200 common English words, used to synthesize short English sentences. */
const ENGLISH_WORDS =
  `about after again always another answer around because before begin better between bring build change check class close company could country course create decide different drive during early education enough every example family first follow friend general great group happen happy house however important include interest large learn leave letter level light little local market member minute money month morning mother music never night nothing number offer office often order other paper parent party people person phone place point police possible power problem program project provide public question quick quite reach ready reason receive record remember report result return right school science season second service several share short should simple since small social sound speak special spend sport start state still story student study support system table teach thank thing think through today together tomorrow tonight travel under understand until value video visit voice watch water weekend welcome where which while white whole window woman wonder world write young back best book both call care case city come deal does down draw easy face fact feel find food form free game give good grow hand hard head hear help high hold home hope hour idea keep kind know land last`.split(
    ' '
  )

type BenchSort = 'asc' | 'desc' | 'relevance'
type SearchOptions = NonNullable<Parameters<typeof searchMessagesByKeywords>[2]>

interface QuerySpec {
  id: number
  keywords: string[]
  matchMode: 'any' | 'all'
  sort: BenchSort
  /** Only query 11 restricts the time range. */
  window: { startTs: number; endTs: number } | null
}

interface QueryResult {
  id: number
  label: string
  keywords: string[]
  matchMode: 'any' | 'all'
  sort: BenchSort
  startTs: number | null
  endTs: number | null
  total: number
  coldMs: number
  warmMs: number[]
  p50Ms: number
  p95Ms: number
  hitCount: number
  hitIdsSha256: string
}

interface SearchIndexResult {
  rebuilt: boolean
  rows: number
  durationMs: number
}

interface BenchmarkReport {
  generatedAt: string
  machine: { cpu: string; totalMemBytes: number; platform: string; arch: string }
  nodeVersion: string
  sqliteVersion: string
  corpusSeed: number
  messageCount: number
  memberCount: number
  queryLimit: number
  warmRuns: number
  corpusBuildMs: number
  databaseBytes: number
  hasMessageFts: boolean
  searchIndex: SearchIndexResult | null
  peakRssMb: number
  queries: QueryResult[]
}

type EnsureMessageSearchIndex = (db: DatabaseAdapter) => SearchIndexResult

/**
 * The FTS index helper only exists after the search-index change lands, so it is
 * resolved at runtime instead of imported. A missing export means baseline mode.
 */
function resolveSearchIndexBuilder(): EnsureMessageSearchIndex | null {
  const candidate = (coreExports as Record<string, unknown>).ensureMessageSearchIndex
  return typeof candidate === 'function' ? (candidate as EnsureMessageSearchIndex) : null
}

/** mulberry32: small, fast, fully reproducible from a 32-bit seed. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function buildContent(index: number, random: () => number): { content: string; type: number } {
  const roll = random()
  if (roll < IMAGE_RATIO) return { content: IMAGE_PLACEHOLDER, type: MessageType.IMAGE }

  const bucket = Math.floor(((roll - IMAGE_RATIO) / (1 - IMAGE_RATIO)) * 3)
  if (bucket === 0) {
    const content = SAMPLE_TEXTS[index % SAMPLE_TEXTS.length]
    return { content, type: content === IMAGE_PLACEHOLDER ? MessageType.IMAGE : MessageType.TEXT }
  }
  if (bucket === 1) {
    const length = 6 + Math.floor(random() * 15)
    let content = ''
    for (let position = 0; position < length; position++) {
      content += CHINESE_CHARACTERS[Math.floor(random() * CHINESE_CHARACTERS.length)]
    }
    return { content, type: MessageType.TEXT }
  }
  const wordCount = 3 + Math.floor(random() * 6)
  const words: string[] = []
  for (let position = 0; position < wordCount; position++) {
    words.push(ENGLISH_WORDS[Math.floor(random() * ENGLISH_WORDS.length)])
  }
  return { content: words.join(' '), type: MessageType.TEXT }
}

function buildCorpus(dbPath: string, messageCount: number): number {
  const startedAt = performance.now()
  const raw = new Database(dbPath, { nativeBinding })
  try {
    raw.pragma('journal_mode = WAL')
    raw.pragma('synchronous = NORMAL')
    raw.exec(CHAT_DB_SCHEMA)

    // schema_version defaults to CURRENT_SCHEMA_VERSION in the shared DDL.
    raw
      .prepare(`INSERT INTO meta (name, platform, type, imported_at, group_id) VALUES (?, ?, ?, ?, ?)`)
      .run('搜索基准群', 'wechat', '群聊', Math.floor(Date.now() / 1000), 'bench@chatroom')

    const insertMember = raw.prepare(
      `INSERT INTO member (id, platform_id, account_name, group_nickname, aliases, avatar, roles)
       VALUES (?, ?, ?, ?, '[]', NULL, '[]')`
    )
    raw.transaction(() => {
      for (let index = 0; index < MEMBER_COUNT; index++) {
        insertMember.run(index + 1, `wxid_member_${index}`, `member_${index}`, `成员${index}号`)
      }
    })()

    const insertMessage = raw.prepare(
      `INSERT INTO message (id, sender_id, sender_account_name, sender_group_nickname, ts, type, content,
                            reply_to_message_id, platform_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    )
    const random = createRandom(CORPUS_SEED)
    const insertChunk = raw.transaction((from: number, to: number) => {
      for (let index = from; index < to; index++) {
        const member = index % MEMBER_COUNT
        const { content, type } = buildContent(index, random)
        insertMessage.run(
          index + 1,
          member + 1,
          `member_${member}`,
          `成员${member}号`,
          BASE_TIMESTAMP + index * TIMESTAMP_STEP_SECONDS,
          type,
          content
        )
      }
    })
    for (let from = 0; from < messageCount; from += INSERT_CHUNK_SIZE) {
      insertChunk(from, Math.min(from + INSERT_CHUNK_SIZE, messageCount))
    }

    raw.pragma('wal_checkpoint(TRUNCATE)')
    return performance.now() - startedAt
  } finally {
    raw.close()
  }
}

function buildQuerySpecs(window: { startTs: number; endTs: number }): QuerySpec[] {
  const spec = (
    id: number,
    keywords: string[],
    overrides?: Partial<Omit<QuerySpec, 'id' | 'keywords'>>
  ): QuerySpec => ({
    id,
    keywords,
    matchMode: overrides?.matchMode ?? 'any',
    sort: overrides?.sort ?? 'desc',
    window: overrides?.window ?? null,
  })

  return [
    spec(1, ['project']),
    spec(2, ['tomorrow']),
    spec(3, ['weekend']),
    spec(4, ['老地方']),
    spec(5, ['天气不错']),
    spec(6, ['人齐就开打']),
    spec(7, ['天气']),
    spec(8, ['收到']),
    spec(9, ['周末', '打球']),
    spec(10, ['周末', '打球'], { matchMode: 'all' }),
    spec(11, ['天气'], { window }),
    spec(12, ['打球'], { sort: 'relevance' }),
  ]
}

function toSearchOptions(spec: QuerySpec, limit: number): SearchOptions {
  // `sort: 'relevance'` only exists once the FTS change lands; the cast keeps this
  // script compiling against both the baseline and the updated core signature.
  return {
    limit,
    offset: 0,
    matchMode: spec.matchMode,
    sort: spec.sort,
    startTs: spec.window?.startTs,
    endTs: spec.window?.endTs,
  } as SearchOptions
}

function percentile(sortedValues: number[], fraction: number): number {
  const rank = Math.max(1, Math.ceil(fraction * sortedValues.length))
  return sortedValues[Math.min(rank, sortedValues.length) - 1]
}

function runQuery(dbPath: string, spec: QuerySpec, warmRuns: number, sampleRss: () => void): QueryResult {
  const raw = new Database(dbPath, { readonly: true, nativeBinding })
  try {
    const db = new BetterSqliteAdapter(raw)
    const pagedOptions = toSearchOptions(spec, QUERY_LIMIT)
    const measure = () => {
      const startedAt = performance.now()
      const page = searchMessagesByKeywords(db, spec.keywords, pagedOptions)
      return { durationMs: performance.now() - startedAt, total: page.total ?? 0 }
    }

    const cold = measure()
    const warm: number[] = []
    for (let run = 0; run < warmRuns; run++) {
      const result = measure()
      if (result.total !== cold.total) {
        throw new Error(`Query ${spec.id} returned an unstable total: ${cold.total} then ${result.total}`)
      }
      warm.push(result.durationMs)
    }
    sampleRss()

    const full = searchMessagesByKeywords(db, spec.keywords, toSearchOptions(spec, Math.max(cold.total, 1)))
    const hitIds = full.messages.map((message) => message.id).sort((left, right) => left - right)
    if (cold.total > 0 && hitIds.length !== cold.total) {
      throw new Error(`Query ${spec.id} returned ${hitIds.length} ids for a reported total of ${cold.total}`)
    }
    sampleRss()

    const sortedWarm = [...warm].sort((left, right) => left - right)
    return {
      id: spec.id,
      label: spec.keywords.join(spec.matchMode === 'all' ? ' AND ' : ' OR '),
      keywords: spec.keywords,
      matchMode: spec.matchMode,
      sort: spec.sort,
      startTs: spec.window?.startTs ?? null,
      endTs: spec.window?.endTs ?? null,
      total: cold.total,
      coldMs: cold.durationMs,
      warmMs: warm,
      p50Ms: percentile(sortedWarm, 0.5),
      p95Ms: percentile(sortedWarm, 0.95),
      hitCount: hitIds.length,
      hitIdsSha256: createHash('sha256').update(hitIds.join(',')).digest('hex'),
    }
  } finally {
    raw.close()
  }
}

function readDatabaseFacts(dbPath: string): { sqliteVersion: string; hasMessageFts: boolean } {
  const raw = new Database(dbPath, { readonly: true, nativeBinding })
  try {
    const version = raw.prepare('select sqlite_version() as version').get() as { version: string }
    const table = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_fts'").get() as
      | { name: string }
      | undefined
    return { sqliteVersion: version.version, hasMessageFts: table !== undefined }
  } finally {
    raw.close()
  }
}

/** Terminal cell width: CJK and fullwidth code points occupy two columns. */
const WIDE_CODE_POINT = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/

function padColumn(text: string, width: number): string {
  let displayWidth = 0
  for (const char of text) displayWidth += WIDE_CODE_POINT.test(char) ? 2 : 1
  return text + ' '.repeat(Math.max(0, width - displayWidth))
}

function printSummary(report: BenchmarkReport): void {
  const indexLine = report.searchIndex
    ? `${report.searchIndex.durationMs.toFixed(0)} ms (${report.searchIndex.rebuilt ? 'rebuilt' : 'reused'}, ${report.searchIndex.rows.toLocaleString()} rows)`
    : 'not available (baseline)'
  console.log(
    `\nMessage search benchmark — ${report.messageCount.toLocaleString()} messages, ${report.memberCount} members, seed 0x${report.corpusSeed.toString(16)}`
  )
  console.log(
    `  machine   ${report.machine.cpu} | ${(report.machine.totalMemBytes / 1024 ** 3).toFixed(1)} GB | ` +
      `${report.machine.platform}/${report.machine.arch}`
  )
  console.log(`  runtime   Node ${report.nodeVersion} | SQLite ${report.sqliteVersion}`)
  console.log(
    `  database  ${(report.databaseBytes / 1024 ** 2).toFixed(1)} MB | message_fts ${report.hasMessageFts ? 'present' : 'absent'} | ` +
      `built in ${report.corpusBuildMs.toFixed(0)} ms`
  )
  console.log(`  index     ${indexLine}`)
  console.log(
    `  queries   limit ${report.queryLimit}, 1 cold + ${report.warmRuns} warm run(s) each | peak RSS ${report.peakRssMb.toFixed(0)} MB\n`
  )

  const header = [
    '#'.padStart(3),
    padColumn('keywords', 30),
    'mode'.padEnd(4),
    'sort'.padEnd(9),
    'total'.padStart(9),
    'cold ms'.padStart(9),
    'p50 ms'.padStart(8),
    'p95 ms'.padStart(8),
    'hits sha256',
  ].join('  ')
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const query of report.queries) {
    console.log(
      [
        String(query.id).padStart(3),
        padColumn(query.startTs === null ? query.label : `${query.label} (first 10% ts)`, 30),
        query.matchMode.padEnd(4),
        query.sort.padEnd(9),
        query.total.toLocaleString().padStart(9),
        query.coldMs.toFixed(2).padStart(9),
        query.p50Ms.toFixed(2).padStart(8),
        query.p95Ms.toFixed(2).padStart(8),
        query.hitIdsSha256.slice(0, 16),
      ].join('  ')
    )
  }
}

async function main(): Promise<void> {
  const positional: string[] = []
  let outPath: string | null = null
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--out') {
      outPath = args[++index] ?? null
      if (!outPath) throw new Error('--out requires a file path')
    } else {
      positional.push(args[index])
    }
  }

  const messageCount = Number(positional[0] ?? 100_000)
  const warmRuns = Number(positional[1] ?? 5)
  if (![messageCount, warmRuns].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('Usage: bench-message-search.mts [messages=100000] [runs=5] [--out <json>]')
  }

  const root = createChatLabTempDir('bench', 'message-search-')
  const dbPath = path.join(root, 'session.db')
  let peakRssMb = process.memoryUsage().rss / 1024 / 1024
  const sampleRss = () => {
    peakRssMb = Math.max(peakRssMb, process.memoryUsage().rss / 1024 / 1024)
  }

  try {
    console.log(`Building ${messageCount.toLocaleString()} synthetic messages in ${dbPath}`)
    const corpusBuildMs = buildCorpus(dbPath, messageCount)
    sampleRss()

    const buildSearchIndex = resolveSearchIndexBuilder()
    let searchIndex: SearchIndexResult | null = null
    if (buildSearchIndex) {
      const raw = new Database(dbPath, { nativeBinding })
      try {
        searchIndex = buildSearchIndex(new BetterSqliteAdapter(raw))
        raw.pragma('wal_checkpoint(TRUNCATE)')
      } finally {
        raw.close()
      }
      sampleRss()
    }

    const facts = readDatabaseFacts(dbPath)
    const window = {
      startTs: BASE_TIMESTAMP,
      endTs: BASE_TIMESTAMP + Math.floor((messageCount - 1) * TIMESTAMP_STEP_SECONDS * 0.1),
    }
    const queries = buildQuerySpecs(window).map((spec) => runQuery(dbPath, spec, warmRuns, sampleRss))

    const report: BenchmarkReport = {
      generatedAt: new Date().toISOString(),
      machine: {
        cpu: os.cpus()[0]?.model ?? 'unknown',
        totalMemBytes: os.totalmem(),
        platform: process.platform,
        arch: process.arch,
      },
      nodeVersion: process.version,
      sqliteVersion: facts.sqliteVersion,
      corpusSeed: CORPUS_SEED,
      messageCount,
      memberCount: MEMBER_COUNT,
      queryLimit: QUERY_LIMIT,
      warmRuns,
      corpusBuildMs,
      databaseBytes: statSync(dbPath).size,
      hasMessageFts: facts.hasMessageFts,
      searchIndex,
      peakRssMb,
      queries,
    }

    printSummary(report)
    if (outPath) {
      const resolved = path.resolve(outPath)
      mkdirSync(path.dirname(resolved), { recursive: true })
      writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
      console.log(`\nWrote ${resolved}`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
