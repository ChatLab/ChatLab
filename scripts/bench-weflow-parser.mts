/**
 * Benchmark: Rust native WeFlow parser vs pure-TS stream-json parser.
 *
 * Generates a synthetic WeFlow export and parses it with both paths.
 *
 * Usage:
 *   pnpm exec tsx scripts/bench-weflow-parser.mts [messageCount]
 *
 * Requires the native module to be built first: pnpm build:native
 */

import { createWriteStream, mkdtempSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'

import { parseFileSync } from '../packages/parser/src/index'
import { loadNativeParser } from '../packages/parser/src/native/loader'

const ENV_KEY = 'CHATLAB_DISABLE_NATIVE_PERF'
const messageCount = Number(process.argv[2] ?? 500_000)

const MEMBER_COUNT = 200
const TYPES = ['文本消息', '图片消息', '语音消息', '引用消息', '动画表情', '系统消息']
const SAMPLE_TEXTS = [
  '今天天气不错，我们出去玩吧！',
  '哈哈哈哈哈哈这也太好笑了',
  '[图片]',
  '好的，收到，明天见。',
  'This is a mixed language message with some English words 和中文混排。',
  '周末有人一起打球吗？地点老地方，时间下午三点，人齐就开打。',
]

async function generateFixture(filePath: string, count: number): Promise<void> {
  const stream = createWriteStream(filePath, { encoding: 'utf-8' })
  const write = async (chunk: string) => {
    if (!stream.write(chunk)) await once(stream, 'drain')
  }

  const avatars: Record<string, string> = {}
  for (let i = 0; i < 20; i++) {
    avatars[`wxid_member_${i}`] = `data:image/jpeg;base64,${'A'.repeat(2000)}`
  }

  await write(
    `{"weflow":{"version":"1.0.0","exportedAt":1704164645},` +
      `"session":{"wxid":"bench@chatroom","nickname":"性能测试群","displayName":"性能测试群","type":"群聊"},` +
      `"avatars":${JSON.stringify(avatars)},"messages":[`
  )

  const batch: string[] = []
  for (let i = 0; i < count; i++) {
    const member = i % MEMBER_COUNT
    const message = {
      localId: i + 1,
      createTime: 1704164645 + i * 3,
      formattedTime: '2024-01-02 03:04:05',
      type: TYPES[i % TYPES.length],
      localType: 1,
      content: `${SAMPLE_TEXTS[i % SAMPLE_TEXTS.length]} #${i}`,
      isSend: member === 0 ? 1 : 0,
      senderUsername: `wxid_member_${member}`,
      senderDisplayName: `成员${member}号`,
      senderAvatarKey: `wxid_member_${member}`,
      source: '',
    }
    batch.push(JSON.stringify(message))
    if (batch.length >= 5000) {
      await write((i + 1 > batch.length ? ',' : '') + batch.join(','))
      batch.length = 0
    }
  }
  if (batch.length > 0) {
    await write((count > batch.length ? ',' : '') + batch.join(','))
  }
  await write(']}')
  stream.end()
  await once(stream, 'finish')
}

interface BenchResult {
  label: string
  durationMs: number
  messages: number
  members: number
  rssMb: number
}

async function benchOnce(label: string, filePath: string, disableNative: boolean): Promise<BenchResult> {
  if (disableNative) {
    process.env[ENV_KEY] = '1'
  } else {
    delete process.env[ENV_KEY]
  }
  global.gc?.()
  const start = performance.now()
  const result = await parseFileSync(filePath)
  const durationMs = performance.now() - start
  return {
    label,
    durationMs,
    messages: result.messages.length,
    members: result.members.length,
    rssMb: process.memoryUsage().rss / 1024 / 1024,
  }
}

async function main() {
  const saved = process.env[ENV_KEY]
  delete process.env[ENV_KEY]
  const nativeAvailable = loadNativeParser() !== null
  if (saved !== undefined) process.env[ENV_KEY] = saved
  if (!nativeAvailable) {
    console.error('Native module not built. Run: pnpm build:native')
    process.exit(1)
  }

  const dir = mkdtempSync(join(tmpdir(), 'chatlab-weflow-bench-'))
  const filePath = join(dir, 'bench.json')
  try {
    console.log(`Generating fixture with ${messageCount.toLocaleString()} messages...`)
    await generateFixture(filePath, messageCount)
    const sizeMb = statSync(filePath).size / 1024 / 1024
    console.log(`Fixture size: ${sizeMb.toFixed(1)} MB\n`)

    const results: BenchResult[] = []
    // Interleave runs to be fair about cache warmth: TS, native, TS, native.
    results.push(await benchOnce('ts #1', filePath, true))
    results.push(await benchOnce('native #1', filePath, false))
    results.push(await benchOnce('ts #2', filePath, true))
    results.push(await benchOnce('native #2', filePath, false))

    for (const r of results) {
      console.log(
        `${r.label.padEnd(10)} ${r.durationMs.toFixed(0).padStart(8)} ms | ` +
          `${r.messages.toLocaleString()} messages, ${r.members} members | rss ${r.rssMb.toFixed(0)} MB`
      )
    }

    const tsBest = Math.min(...results.filter((r) => r.label.startsWith('ts')).map((r) => r.durationMs))
    const nativeBest = Math.min(...results.filter((r) => r.label.startsWith('native')).map((r) => r.durationMs))
    console.log(`\nSpeedup (best of 2): ${(tsBest / nativeBest).toFixed(2)}x`)

    const tsMessages = results[0].messages
    const nativeMessages = results[1].messages
    if (tsMessages !== nativeMessages) {
      console.error(`Output mismatch: ts=${tsMessages} native=${nativeMessages}`)
      process.exit(1)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

main()
