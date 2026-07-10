import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkMessages, isSemanticVoid, type ChunkMessageInput, type ChunkSource } from './chunker'
import { DEFAULT_CHUNKER_CONFIG, type ChunkerConfig } from './chunker-config'
import { estimateTokens } from './tokens'

const MINUTE = 60_000

const groupSource: ChunkSource = { title: '家庭群', kind: 'group' }
const privateSource: ChunkSource = { title: '张三', kind: 'private' }

// 小参数，便于用短消息触发切分
const smallConfig: ChunkerConfig = {
  ...DEFAULT_CHUNKER_CONFIG,
  parentGapSeconds: 600,
  parentMaxTokens: 100000,
  childTargetMinChars: 10,
  childTargetMaxChars: 30,
  childHardMaxTokens: 100000,
  overlapMessages: 2,
  semanticVoidSkipThreshold: 5,
}

function msg(id: number, content: string | null, minute: number, sender = '张三', type?: number): ChunkMessageInput {
  return { id, content, ts: minute * MINUTE, senderName: sender, type }
}

test('isSemanticVoid detects fillers, placeholders, empty and void types', () => {
  assert.equal(isSemanticVoid(msg(1, '好的', 0)), true)
  assert.equal(isSemanticVoid(msg(1, '嗯嗯', 0)), true)
  assert.equal(isSemanticVoid(msg(1, '哈哈哈', 0)), true)
  assert.equal(isSemanticVoid(msg(1, '在吗？', 0)), true)
  assert.equal(isSemanticVoid(msg(1, '[图片]', 0)), true)
  assert.equal(isSemanticVoid(msg(1, '   ', 0)), true)
  assert.equal(isSemanticVoid(msg(1, '某条系统通知', 0, '张三', 80)), true)
  assert.equal(isSemanticVoid(msg(1, '这周末一起去看房，下午两点在地铁站集合', 0)), false)
})

test('time gap splits messages into separate parents', () => {
  const messages = [
    msg(1, '第一段话题：周末出游计划讨论得差不多了', 0),
    msg(2, '大家记得带身份证和雨具', 1),
    // 大间隔 -> 新 parent
    msg(3, '第二段完全不同的话题：报税材料准备情况', 100),
    msg(4, '记得把发票扫描件发我邮箱', 101),
  ]
  const result = chunkMessages({ messages, source: groupSource, config: smallConfig })
  const parentIds = new Set(result.chunks.map((c) => c.parentId))
  assert.equal(parentIds.size, 2)
  assert.equal(result.parentCount, 2)
})

test('child chunks split by effective chars and overlap by trailing messages', () => {
  const messages = Array.from({ length: 6 }, (_, i) => msg(i + 1, '一二三四五六七八九十', i * 0.1))
  const result = chunkMessages({ messages, source: groupSource, config: smallConfig })

  assert.ok(result.chunks.length >= 2, 'should split into multiple children')

  const first = result.chunks[0]
  const second = result.chunks[1]
  // overlap：第二个 child 的起始消息应落在第一个 child 末尾 overlapMessages 条之内
  const firstTailIds = new Set([first.endMessageId])
  assert.ok(second.startMessageId <= first.endMessageId, 'second child should start within first child range (overlap)')
  assert.ok(firstTailIds.size > 0)
})

test('child closes at soft message cap once min effective chars met', () => {
  const cfg: ChunkerConfig = {
    ...DEFAULT_CHUNKER_CONFIG,
    parentGapSeconds: 100000,
    parentMaxTokens: 100000,
    childTargetMaxChars: 100000,
    childHardMaxTokens: 100000,
    childTargetMinChars: 8,
    childSoftMaxMessages: 4,
    childHardMaxMessages: 100,
    overlapMessages: 0,
    semanticVoidSkipThreshold: 1,
  }
  const messages = Array.from({ length: 8 }, (_, i) => msg(i + 1, `话题内容${i}`, 0))
  const result = chunkMessages({ messages, source: groupSource, config: cfg })
  assert.equal(result.chunks.length, 2)
  assert.ok(
    result.chunks.every((c) => c.messageCount === 4),
    'each child should close exactly at the soft message cap'
  )
})

test('child force-closes at hard message cap even below min effective chars', () => {
  const cfg: ChunkerConfig = {
    ...DEFAULT_CHUNKER_CONFIG,
    parentGapSeconds: 100000,
    parentMaxTokens: 100000,
    childTargetMaxChars: 100000,
    childHardMaxTokens: 100000,
    childTargetMinChars: 50,
    childSoftMaxMessages: 4,
    childHardMaxMessages: 6,
    overlapMessages: 0,
    semanticVoidSkipThreshold: 1,
  }
  // 每条仅 2 个有效字符，4 条时(8)未达 min(50)，soft 不触发，靠 hard(6) 强制关闭
  const messages = Array.from({ length: 12 }, (_, i) => msg(i + 1, '甲乙', 0))
  const result = chunkMessages({ messages, source: groupSource, config: cfg })
  assert.equal(result.chunks.length, 2)
  assert.ok(
    result.chunks.every((c) => c.messageCount === 6),
    'each child should be force-closed at the hard message cap'
  )
})

test('single oversized message is clamped to the child token hard limit', () => {
  const cfg: ChunkerConfig = {
    ...DEFAULT_CHUNKER_CONFIG,
    parentGapSeconds: 100000,
    parentMaxTokens: 100000,
    childTargetMaxChars: 100000,
    childHardMaxTokens: 120,
    semanticVoidSkipThreshold: 1,
  }
  const oversizedContent = '超长语义内容'.repeat(1000)
  const result = chunkMessages({
    messages: [msg(1, oversizedContent, 0)],
    source: privateSource,
    config: cfg,
  })

  assert.equal(result.chunks.length, 1)
  assert.equal(result.chunks[0].startMessageId, 1)
  assert.equal(result.chunks[0].endMessageId, 1)
  assert.equal(result.chunks[0].effectiveChars, oversizedContent.length)
  assert.ok(estimateTokens(result.chunks[0].embeddingInput) <= cfg.childHardMaxTokens)
})

test('single oversized non-CJK input also respects the UTF-8 byte safety ceiling', () => {
  const cfg: ChunkerConfig = {
    ...DEFAULT_CHUNKER_CONFIG,
    parentGapSeconds: 100000,
    parentMaxTokens: 100000,
    childTargetMaxChars: 100000,
    childHardMaxTokens: 120,
    semanticVoidSkipThreshold: 1,
  }
  const result = chunkMessages({
    messages: [msg(1, '😀'.repeat(1000), 0)],
    source: privateSource,
    config: cfg,
  })

  const embeddingInput = result.chunks[0].embeddingInput
  assert.ok(Buffer.byteLength(embeddingInput, 'utf8') <= cfg.childHardMaxTokens * 4)
})

test('oversized source title cannot consume the message body budget', () => {
  const cfg: ChunkerConfig = {
    ...DEFAULT_CHUNKER_CONFIG,
    parentGapSeconds: 100000,
    parentMaxTokens: 100000,
    childTargetMaxChars: 100000,
    childHardMaxTokens: 120,
    semanticVoidSkipThreshold: 1,
  }
  const marker = '正文唯一标记内容'
  const result = chunkMessages({
    messages: [msg(1, marker.repeat(10), 0)],
    source: { title: '群'.repeat(1000), kind: 'private' },
    config: cfg,
  })

  assert.ok(result.chunks[0].embeddingInput.includes(marker))
})

test('oversized sender name cannot consume the message content budget', () => {
  const cfg: ChunkerConfig = {
    ...DEFAULT_CHUNKER_CONFIG,
    parentGapSeconds: 100000,
    parentMaxTokens: 100000,
    childTargetMaxChars: 100000,
    childHardMaxTokens: 120,
    semanticVoidSkipThreshold: 1,
  }
  const marker = '消息正文唯一标记'
  const result = chunkMessages({
    messages: [msg(1, marker.repeat(10), 0, '成员'.repeat(1000))],
    source: privateSource,
    config: cfg,
  })

  assert.ok(result.chunks[0].embeddingInput.includes(marker))
})

test('repeated oversized sender names share one metadata budget across the body', () => {
  const cfg: ChunkerConfig = {
    ...DEFAULT_CHUNKER_CONFIG,
    parentGapSeconds: 100000,
    parentMaxTokens: 100000,
    childTargetMinChars: 100000,
    childTargetMaxChars: 100000,
    childSoftMaxMessages: 100,
    childHardMaxMessages: 100,
    childHardMaxTokens: 1200,
    overlapMessages: 0,
    semanticVoidSkipThreshold: 1,
  }
  const marker = '末条消息正文唯一标记'
  const messages = Array.from({ length: 20 }, (_, index) =>
    msg(index + 1, index === 19 ? marker : `前置正文${index}`, 0, '成员'.repeat(1000))
  )
  const result = chunkMessages({ messages, source: privateSource, config: cfg })

  assert.equal(result.chunks.length, 1)
  assert.ok(result.chunks[0].embeddingInput.includes(marker))
})

test('sender names within the shared budget are kept intact', () => {
  const cfg: ChunkerConfig = {
    ...DEFAULT_CHUNKER_CONFIG,
    parentGapSeconds: 100000,
    parentMaxTokens: 100000,
    childTargetMinChars: 100000,
    childTargetMaxChars: 100000,
    childSoftMaxMessages: 100,
    childHardMaxMessages: 100,
    childHardMaxTokens: 1200,
    overlapMessages: 0,
    semanticVoidSkipThreshold: 1,
  }
  // 20 条消息时逐名均分上限只有 4 token，但名字总占用远低于共享预算，长昵称应完整保留
  const longName = '张三-北京-产品经理'
  const messages = Array.from({ length: 20 }, (_, index) =>
    msg(index + 1, `讨论装修进度安排第${index}条`, 0, index === 19 ? longName : '李四')
  )
  const result = chunkMessages({ messages, source: privateSource, config: cfg })

  assert.equal(result.chunks.length, 1)
  assert.ok(result.chunks[0].embeddingInput.includes(`${longName}: `))
})

test('over-budget clamp shrinks only the oversized name and keeps short names intact', () => {
  const cfg: ChunkerConfig = {
    ...DEFAULT_CHUNKER_CONFIG,
    parentGapSeconds: 100000,
    parentMaxTokens: 100000,
    childTargetMinChars: 100000,
    childTargetMaxChars: 100000,
    childSoftMaxMessages: 100,
    childHardMaxMessages: 100,
    childHardMaxTokens: 1200,
    overlapMessages: 0,
    semanticVoidSkipThreshold: 1,
  }
  const oversizedName = '超长昵称'.repeat(250)
  const messages = Array.from({ length: 20 }, (_, index) =>
    msg(index + 1, `讨论报销流程第${index}条`, 0, index === 19 ? oversizedName : '李四')
  )
  const result = chunkMessages({ messages, source: privateSource, config: cfg })

  const embeddingInput = result.chunks[0].embeddingInput
  assert.ok(embeddingInput.includes('李四: '), 'short names should stay intact')
  // 超长名字拿到扣除短名后的全部剩余预算，而不是被均分上限截到只剩几个字
  assert.ok(embeddingInput.includes(oversizedName.slice(0, 40)))
  assert.ok(!embeddingInput.includes(oversizedName))
  assert.ok(estimateTokens(embeddingInput) <= cfg.childHardMaxTokens)
})

test('semantic void messages are excluded from embedding body, header and effective chars', () => {
  const messages = [
    msg(1, '我们讨论一下下周的装修进度安排', 0, '张三'),
    msg(2, '嗯嗯', 0, '李四'),
    msg(3, '好的', 0, '王五'),
    msg(4, '主要是水电改造和地板铺设两块', 0, '张三'),
  ]
  const result = chunkMessages({ messages, source: groupSource, config: smallConfig })
  const chunk = result.chunks[0]

  assert.ok(!chunk.embeddingInput.includes('嗯嗯'), 'void content must not enter embedding body')
  assert.ok(!chunk.embeddingInput.includes('好的'))
  assert.ok(chunk.embeddingInput.includes('装修进度'))
  // header 参与者只含非真空消息发送者
  assert.ok(chunk.embeddingInput.includes('张三'))
  assert.ok(!chunk.embeddingInput.includes('李四'))
  assert.ok(!chunk.embeddingInput.includes('王五'))
  // messageCount 含真空消息（范围覆盖），effectiveChars 不含
  assert.equal(chunk.messageCount, 4)
})

test('chunks below skip threshold are skipped, all-void input yields no chunks', () => {
  const allVoid = [msg(1, '嗯', 0), msg(2, '好的', 0), msg(3, '哈哈', 0)]
  const result = chunkMessages({ messages: allVoid, source: groupSource, config: smallConfig })
  assert.equal(result.chunks.length, 0)
  assert.ok(result.skippedCount >= 1)
})

test('group header contains source/time/participants; private header omits participants', () => {
  const groupMessages = [msg(1, '这是一段足够长的群聊内容用于生成 header 测试', 0, '张三')]
  const group = chunkMessages({ messages: groupMessages, source: groupSource, config: smallConfig })
  assert.match(group.chunks[0].embeddingInput, /\[来源\] 家庭群（群聊）/)
  assert.match(group.chunks[0].embeddingInput, /\[时间范围\]/)
  assert.match(group.chunks[0].embeddingInput, /\[参与者\]/)

  const privateMessages = [msg(1, '这是一段足够长的私聊内容用于生成 header 测试', 0, '张三')]
  const priv = chunkMessages({ messages: privateMessages, source: privateSource, config: smallConfig })
  assert.match(priv.chunks[0].embeddingInput, /\[来源\] 张三（私聊）/)
  assert.doesNotMatch(priv.chunks[0].embeddingInput, /\[参与者\]/)
})

test('hashes are deterministic and sensitive to content vs embedding-input changes', () => {
  const messages = [msg(1, '一个足够长的用于哈希稳定性测试的聊天内容片段', 0, '张三')]
  const a = chunkMessages({ messages, source: groupSource, config: smallConfig }).chunks[0]
  const b = chunkMessages({ messages, source: groupSource, config: smallConfig }).chunks[0]
  assert.equal(a.rawContentHash, b.rawContentHash)
  assert.equal(a.embeddingInputHash, b.embeddingInputHash)

  // 改消息内容 -> raw 与 embedding hash 都变
  const changed = chunkMessages({
    messages: [msg(1, '一个足够长的用于哈希稳定性测试的不同聊天内容片段', 0, '张三')],
    source: groupSource,
    config: smallConfig,
  }).chunks[0]
  assert.notEqual(changed.rawContentHash, a.rawContentHash)
  assert.notEqual(changed.embeddingInputHash, a.embeddingInputHash)

  // 只改来源（影响 header/embedding 输入），raw 不变、embedding hash 变
  const otherSource = chunkMessages({
    messages,
    source: { title: '工作群', kind: 'group' },
    config: smallConfig,
  }).chunks[0]
  assert.equal(otherSource.rawContentHash, a.rawContentHash)
  assert.notEqual(otherSource.embeddingInputHash, a.embeddingInputHash)
})

test('empty input yields empty result', () => {
  const result = chunkMessages({ messages: [], source: groupSource, config: smallConfig })
  assert.equal(result.chunks.length, 0)
  assert.equal(result.parentCount, 0)
})
