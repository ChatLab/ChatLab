/**
 * End-to-end benchmark for shuakami/qq-chat-exporter V4.
 *
 * Compares the existing production path (slim preprocess + pure TS parser),
 * direct pure TS parsing, the direct Rust kernel/boundary breakdown, and the
 * real production native-first ParseEvent wrapper. Every mode runs in an
 * isolated process so peak RSS is comparable.
 *
 * Usage:
 *   node --import tsx scripts/bench-shuakami-qq-parser.mts [messageCount]
 *
 * Requires a local native build:
 *   cd packages/parser-native && ../../node_modules/.bin/napi build --platform --release
 */

import { once } from 'node:events'
import { createWriteStream, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import type { NativeMember, NativeMessage } from '@openchatlab/parser-native'
import type { ParseEvent, ParsedMember, ParsedMessage, ParsedMeta } from '../packages/parser/src/types'
import { parseShuakamiQqV4, parseShuakamiQqV4Accelerated } from '../packages/parser/src/formats/shuakami-qq-exporter'
import { shuakamiQqPreprocessor } from '../packages/parser/src/formats/shuakami-qq-preprocessor'
import { loadNativeParser } from '../packages/parser/src/native/loader'
import { shuakamiQqAdapter } from '../packages/parser/src/native/shuakami-qq-native'

type Mode = 'ts-production' | 'ts-raw' | 'native-direct' | 'native-production'

interface BenchResult {
  mode: Mode
  totalMs: number
  preprocessMs?: number
  parserMs?: number
  kernelMs?: number
  boundaryMs?: number
  messages: number
  members: number
  hash: string
  baselineRssMb: number
  peakRssMb: number
  peakDeltaRssMb: number
  phasePeakRssMb: Record<string, number>
}

const MEMBER_COUNT = 200
const TEXTS = [
  '今天天气不错，我们出去玩吧！',
  '哈哈哈哈哈哈这也太好笑了',
  '[图片]',
  '好的，收到，明天见。',
  'This is a mixed language message 和中文混排。',
  '周末有人一起打球吗？地点老地方。',
]
const HTML_PADDING = 'H'.repeat(96)
const RAW_PADDING = 'R'.repeat(96)

async function generateFixture(filePath: string, count: number): Promise<void> {
  const stream = createWriteStream(filePath, { encoding: 'utf-8' })
  const write = async (chunk: string) => {
    if (!stream.write(chunk)) await once(stream, 'drain')
  }

  const senders = Array.from({ length: MEMBER_COUNT }, (_, index) => ({
    uid: `uid_${index}`,
    name: `成员${index}号`,
    messageCount: Math.ceil(count / MEMBER_COUNT),
    percentage: 1 / MEMBER_COUNT,
  }))
  await write(
    JSON.stringify({
      metadata: { name: 'QQChatExporter V6', version: '6.0.3', exportTime: '2026-07-30T00:00:00.000Z' },
      chatInfo: { name: 'QQ Rust 性能测试群', type: 'group', avatar: 'data:image/png;base64,GROUP' },
      statistics: { totalMessages: count, senders },
      messages: [],
    }).slice(0, -2) + '\n'
  )

  const batch: string[] = []
  for (let index = 0; index < count; index++) {
    const member = index % MEMBER_COUNT
    const resourceType =
      index % 25 === 0 ? ['image', 'video', 'voice', 'file', 'location'][Math.floor(index / 25) % 5] : undefined
    const message = {
      messageId: `msg_${index}`,
      timestamp: index % 2 === 0 ? '2026-07-10T12:00:00.123Z' : '2026-07-10T20:00:00.123+08:00',
      sender: { uin: String(10_000 + member), uid: `uid_${member}`, name: `成员${member}号` },
      messageType: index % 41 === 0 ? 9 : 2,
      system: index % 20_000 === 3,
      isSystemMessage: index % 10_000 === 1,
      recalled: index % 20_000 === 4,
      isRecalled: index % 10_000 === 2,
      content: {
        text: `${TEXTS[index % TEXTS.length]} #${index}`,
        ...(resourceType ? { resources: [{ type: resourceType, url: `https://invalid.local/${index}` }] } : {}),
        ...(index % 37 === 0 ? { emojis: [{ type: 'face', data: 'ignored' }] } : {}),
        ...(index % 997 === 0 ? { reply: { referencedMessageId: `msg_${Math.max(0, index - 1)}` } } : {}),
        html: `<div data-index="${index}">${HTML_PADDING}</div>`,
        raw: { payload: RAW_PADDING, sequence: index },
      },
      rawMessage: {
        sendNickName: `QQ昵称${member}`,
        ...(index % 3 === 0 ? { sendMemberName: `群昵称${member}` } : {}),
      },
    }
    batch.push(JSON.stringify(message))
    if (batch.length === 2_000) {
      await write((index + 1 > batch.length ? ',' : '') + batch.join(','))
      batch.length = 0
    }
  }
  if (batch.length > 0) {
    await write((count > batch.length ? ',' : '') + batch.join(','))
  }

  const avatars = Object.fromEntries(
    Array.from({ length: MEMBER_COUNT }, (_, index) => [
      String(10_000 + index),
      `data:image/jpeg;base64,${String(index).padStart(4, '0')}${'A'.repeat(128)}`,
    ])
  )
  await write(`\n],"avatars":${JSON.stringify(avatars)}}`)
  stream.end()
  await once(stream, 'finish')
}

class OutputHash {
  private value = 0x811c9dc5

  add(value: unknown): void {
    const text = value === undefined ? '<undefined>' : value === null ? '<null>' : String(value)
    for (let index = 0; index < text.length; index++) {
      this.value ^= text.charCodeAt(index)
      this.value = Math.imul(this.value, 0x01000193)
    }
    this.value ^= 0xff
    this.value = Math.imul(this.value, 0x01000193)
  }

  digest(): string {
    return (this.value >>> 0).toString(16).padStart(8, '0')
  }
}

function hashMeta(hash: OutputHash, meta: ParsedMeta): void {
  hash.add(meta.name)
  hash.add(meta.platform)
  hash.add(meta.type)
  hash.add(meta.groupAvatar)
}

function hashMember(hash: OutputHash, member: ParsedMember): void {
  hash.add(member.platformId)
  hash.add(member.accountName)
  hash.add(member.groupNickname)
  hash.add(member.avatar)
}

function hashMessage(hash: OutputHash, message: ParsedMessage): void {
  hash.add(message.platformMessageId)
  hash.add(message.senderPlatformId)
  hash.add(message.senderAccountName)
  hash.add(message.senderGroupNickname)
  hash.add(message.timestamp)
  hash.add(message.type)
  hash.add(message.content)
  hash.add(message.replyToMessageId)
}

function startRssSampler() {
  let phase = 'setup'
  const phasePeaks: Record<string, number> = {}
  const sample = () => {
    const rssMb = process.memoryUsage().rss / 1024 / 1024
    phasePeaks[phase] = Math.max(phasePeaks[phase] ?? 0, rssMb)
  }
  sample()
  const timer = setInterval(sample, 5)
  return {
    setPhase(next: string) {
      phase = next
      sample()
    },
    stop() {
      sample()
      clearInterval(timer)
      return phasePeaks
    },
  }
}

async function consumeEvents(events: AsyncGenerator<ParseEvent, void, unknown>, hash: OutputHash) {
  let messages = 0
  let members = 0
  for await (const event of events) {
    if (event.type === 'meta') hashMeta(hash, event.data)
    if (event.type === 'members') {
      members += event.data.length
      for (const member of event.data) hashMember(hash, member)
    }
    if (event.type === 'messages') {
      messages += event.data.length
      for (const message of event.data) hashMessage(hash, message)
    }
  }
  return { messages, members }
}

function mapAndHashNativeMember(hash: OutputHash, member: NativeMember): void {
  const [mapped] = shuakamiQqAdapter.mapMembers([member], {})
  hashMember(hash, mapped)
}

function mapAndHashNativeMessage(hash: OutputHash, message: NativeMessage, meta: unknown): void {
  hashMessage(hash, shuakamiQqAdapter.mapMessage(message, meta))
}

async function runWorker(mode: Mode, filePath: string): Promise<BenchResult> {
  global.gc?.()
  const baselineRssMb = process.memoryUsage().rss / 1024 / 1024
  const sampler = startRssSampler()
  const hash = new OutputHash()
  let messages = 0
  let members = 0
  let preprocessMs: number | undefined
  let parserMs: number | undefined
  let kernelMs: number | undefined
  let boundaryMs: number | undefined
  const totalStart = performance.now()

  if (mode === 'ts-production') {
    process.env.CHATLAB_DISABLE_NATIVE_PERF = '1'
    sampler.setPhase('preprocess')
    const preprocessStart = performance.now()
    const slimPath = await shuakamiQqPreprocessor.preprocess(filePath)
    preprocessMs = performance.now() - preprocessStart
    try {
      sampler.setPhase('parse-and-deliver')
      const parseStart = performance.now()
      ;({ messages, members } = await consumeEvents(parseShuakamiQqV4({ filePath: slimPath, batchSize: 5_000 }), hash))
      parserMs = performance.now() - parseStart
    } finally {
      shuakamiQqPreprocessor.cleanup(slimPath)
    }
  } else if (mode === 'ts-raw') {
    process.env.CHATLAB_DISABLE_NATIVE_PERF = '1'
    sampler.setPhase('parse-and-deliver')
    const parseStart = performance.now()
    ;({ messages, members } = await consumeEvents(parseShuakamiQqV4({ filePath, batchSize: 5_000 }), hash))
    parserMs = performance.now() - parseStart
  } else if (mode === 'native-direct') {
    delete process.env.CHATLAB_DISABLE_NATIVE_PERF
    const native = loadNativeParser()
    if (!native) throw new Error('Native module is unavailable')
    const parser = new native.NativeParser('shuakami-qq-exporter', filePath)
    sampler.setPhase('kernel')
    const kernelStart = performance.now()
    await parser.parse()
    kernelMs = performance.now() - kernelStart

    sampler.setPhase('boundary-and-adapter')
    const boundaryStart = performance.now()
    const metaJson: unknown = JSON.parse(parser.metaJson())
    hashMeta(hash, shuakamiQqAdapter.mapMeta(metaJson))
    const nativeMembers = parser.takeMembers()
    members = nativeMembers.length
    for (const member of nativeMembers) mapAndHashNativeMember(hash, member)
    while (true) {
      const batch = parser.takeBatch(5_000)
      if (!batch) break
      messages += batch.length
      for (const message of batch) mapAndHashNativeMessage(hash, message, metaJson)
      await new Promise((resolve) => setImmediate(resolve))
    }
    boundaryMs = performance.now() - boundaryStart
  } else {
    delete process.env.CHATLAB_DISABLE_NATIVE_PERF
    sampler.setPhase('parse-and-deliver')
    const parseStart = performance.now()
    ;({ messages, members } = await consumeEvents(parseShuakamiQqV4Accelerated({ filePath, batchSize: 5_000 }), hash))
    parserMs = performance.now() - parseStart
  }

  const totalMs = performance.now() - totalStart
  const phasePeakRssMb = sampler.stop()
  const peakRssMb = Math.max(...Object.values(phasePeakRssMb))
  return {
    mode,
    totalMs,
    preprocessMs,
    parserMs,
    kernelMs,
    boundaryMs,
    messages,
    members,
    hash: hash.digest(),
    baselineRssMb,
    peakRssMb,
    peakDeltaRssMb: peakRssMb - baselineRssMb,
    phasePeakRssMb,
  }
}

function runIsolated(mode: Mode, filePath: string): BenchResult {
  const scriptPath = fileURLToPath(import.meta.url)
  const child = spawnSync(
    process.execPath,
    ['--expose-gc', '--import', 'tsx', scriptPath, '--worker', mode, filePath],
    {
      cwd: process.cwd(),
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }
  )
  if (child.status !== 0) {
    throw new Error(`${mode} worker failed:\n${child.stdout}\n${child.stderr}`)
  }
  const line = child.stdout
    .trim()
    .split('\n')
    .findLast((candidate) => candidate.startsWith('{'))
  if (!line) throw new Error(`${mode} worker returned no JSON: ${child.stdout}`)
  return JSON.parse(line) as BenchResult
}

function runMedian(mode: Mode, filePath: string, runs: number): BenchResult {
  const results = Array.from({ length: runs }, () => runIsolated(mode, filePath))
  const first = results[0]
  if (
    results.some(
      (result) => result.hash !== first.hash || result.messages !== first.messages || result.members !== first.members
    )
  ) {
    throw new Error(`${mode} produced inconsistent output across benchmark runs`)
  }
  return results.toSorted((left, right) => left.totalMs - right.totalMs)[Math.floor(results.length / 2)]
}

function formatResult(result: BenchResult): string {
  const stages = [
    result.preprocessMs === undefined ? '' : `preprocess=${result.preprocessMs.toFixed(0)}ms`,
    result.parserMs === undefined ? '' : `parser=${result.parserMs.toFixed(0)}ms`,
    result.kernelMs === undefined ? '' : `kernel=${result.kernelMs.toFixed(0)}ms`,
    result.boundaryMs === undefined ? '' : `boundary=${result.boundaryMs.toFixed(0)}ms`,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    `${result.mode.padEnd(13)} total=${result.totalMs.toFixed(0).padStart(6)}ms (${stages}) | ` +
    `peak=${result.peakRssMb.toFixed(0)}MB (+${result.peakDeltaRssMb.toFixed(0)}MB) | ` +
    `${result.messages.toLocaleString()} messages, ${result.members} members, hash=${result.hash}`
  )
}

async function main(): Promise<void> {
  if (process.argv[2] === '--worker') {
    const mode = process.argv[3] as Mode
    const filePath = process.argv[4]
    console.log(JSON.stringify(await runWorker(mode, filePath)))
    return
  }

  const messageCount = Number(process.argv[2] ?? 500_000)
  const runs = Number(process.argv[3] ?? 1)
  if (!Number.isInteger(runs) || runs < 1 || runs % 2 === 0) {
    throw new Error('Benchmark runs must be a positive odd integer')
  }
  const directory = mkdtempSync(join(tmpdir(), 'chatlab-shuakami-qq-bench-'))
  const filePath = join(directory, 'shuakami-qq-v4-benchmark.json')
  try {
    console.log(`Generating ${messageCount.toLocaleString()}-message shuakami/qq-chat-exporter V4 fixture...`)
    await generateFixture(filePath, messageCount)
    console.log(`Fixture: ${basename(filePath)}, ${(statSync(filePath).size / 1024 / 1024).toFixed(1)} MB`)
    if (runs > 1) console.log(`Reporting the median of ${runs} isolated runs per mode.`)

    const results = [
      runMedian('ts-raw', filePath, runs),
      runMedian('ts-production', filePath, runs),
      runMedian('native-direct', filePath, runs),
      runMedian('native-production', filePath, runs),
    ]
    for (const result of results) console.log(formatResult(result))

    const [tsRaw, tsProduction, nativeDirect, nativeProduction] = results
    for (const native of [nativeDirect, nativeProduction]) {
      if (tsRaw.hash !== native.hash || tsRaw.messages !== native.messages || tsRaw.members !== native.members) {
        throw new Error(`${native.mode} output does not match the pure TS raw-file reference`)
      }
      if (
        tsProduction.hash !== native.hash ||
        tsProduction.messages !== native.messages ||
        tsProduction.members !== native.members
      ) {
        throw new Error(`${native.mode} output does not match the production preprocess + TS path`)
      }
    }

    console.log(`Speedup vs current production path: ${(tsProduction.totalMs / nativeProduction.totalMs).toFixed(2)}x`)
    console.log(
      `Peak RSS delta ratio (TS/native): ${(tsProduction.peakDeltaRssMb / nativeProduction.peakDeltaRssMb).toFixed(2)}x`
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

await main()
