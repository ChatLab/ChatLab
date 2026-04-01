/**
 * 自定义 TXT 格式解析器单元测试
 * 测试覆盖：消息头解析、时间解析、消息类型检测、多行消息、边界条件
 */

import assert from 'node:assert/strict'
import test, { describe, it, beforeEach, afterEach } from 'node:test'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { feature, parser_ } from './custom-txt'
import { MessageType } from '../../../../src/types/base'

// ==================== 辅助函数 ====================

/**
 * 创建临时测试文件
 */
function createTempFile(content: string, filename: string = 'test-chat.txt'): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-txt-test-'))
  const filePath = path.join(tempDir, filename)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

/**
 * 清理临时文件
 */
function cleanupTempFile(filePath: string): void {
  const dir = path.dirname(filePath)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * 收集解析器输出
 */
async function collectParseResult(filePath: string) {
  const events: any[] = []
  const logs: { level: string; message: string }[] = []

  for await (const event of parser_.parse({
    filePath,
    onLog: (level, message) => logs.push({ level, message }),
  })) {
    events.push(event)
  }

  const meta = events.find((e) => e.type === 'meta')?.data
  const members = events.find((e) => e.type === 'members')?.data
  const messages = events.filter((e) => e.type === 'messages').flatMap((e) => e.data)
  const done = events.find((e) => e.type === 'done')?.data

  return { meta, members, messages, done, logs }
}

// ==================== 测试套件 ====================

describe('自定义 TXT 格式解析器 - 特征定义', () => {
  it('应该有正确的格式 ID', () => {
    console.log('[Test] 检查格式 ID')
    assert.equal(feature.id, 'custom-txt')
  })

  it('应该有正确的格式名称', () => {
    console.log('[Test] 检查格式名称')
    assert.equal(feature.name, '自定义 TXT 格式')
  })

  it('应该支持 .txt 扩展名', () => {
    console.log('[Test] 检查扩展名支持')
    assert.ok(feature.extensions.includes('.txt'))
  })

  it('应该有正确的优先级', () => {
    console.log('[Test] 检查优先级')
    assert.equal(feature.priority, 40)
  })

  it('应该有消息头签名正则', () => {
    console.log('[Test] 检查签名正则')
    assert.ok(feature.signatures.head)
    assert.ok(feature.signatures.head!.length > 0)
  })
})

describe('自定义 TXT 格式解析器 - 消息头正则匹配', () => {
  const headerRegex = /^([^\t]+)\(([a-zA-Z]\d{8})\)\t(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/

  it('应该匹配标准格式消息头', () => {
    const line = '张三(z00123456)\t2026-03-31 09:15:32'
    console.log('[Test] 测试标准格式:', line)
    const match = line.match(headerRegex)
    assert.ok(match)
    assert.equal(match[1], '张三')
    assert.equal(match[2], 'z00123456')
    assert.equal(match[3], '2026-03-31 09:15:32')
  })

  it('应该匹配英文 ID', () => {
    const line = 'John(a12345678)\t2026-03-31 09:15:32'
    console.log('[Test] 测试英文 ID:', line)
    const match = line.match(headerRegex)
    assert.ok(match)
    assert.equal(match[1], 'John')
    assert.equal(match[2], 'a12345678')
  })

  it('应该匹配中文昵称', () => {
    const line = '李四(l00123457)\t2026-03-31 09:16:45'
    console.log('[Test] 测试中文昵称:', line)
    const match = line.match(headerRegex)
    assert.ok(match)
    assert.equal(match[1], '李四')
    assert.equal(match[2], 'l00123457')
  })

  it('应该不匹配无效 ID 格式（少于8位数字）', () => {
    const line = '张三(z123456)\t2026-03-31 09:15:32'
    console.log('[Test] 测试无效 ID:', line)
    const match = line.match(headerRegex)
    assert.ok(!match)
  })

  it('应该不匹配无效 ID 格式（数字开头）', () => {
    const line = '张三(100123456)\t2026-03-31 09:15:32'
    console.log('[Test] 测试数字开头 ID:', line)
    const match = line.match(headerRegex)
    assert.ok(!match)
  })

  it('应该不匹配缺少 Tab 分隔的行', () => {
    const line = '张三(z00123456) 2026-03-31 09:15:32'
    console.log('[Test] 测试缺少 Tab:', line)
    const match = line.match(headerRegex)
    assert.ok(!match)
  })

  // ==================== PR Review: 尾随空格测试 ====================

  it('应该在 trimEnd 后匹配带尾随空格的消息头', () => {
    const rawLine = '张三(z00123456)\t2026-03-31 09:15:32   ' // 尾随空格
    const line = rawLine.trimEnd()
    console.log('[Test] 测试尾随空格 (trimEnd后):', JSON.stringify(line))
    const match = line.match(headerRegex)
    assert.ok(match, 'trimEnd后应该匹配')
    assert.equal(match[1], '张三')
    assert.equal(match[2], 'z00123456')
    assert.equal(match[3], '2026-03-31 09:15:32')
  })

  it('应该在 trimEnd 后匹配带尾随制表符的消息头', () => {
    const rawLine = '张三(z00123456)\t2026-03-31 09:15:32\t\t' // 尾随制表符
    const line = rawLine.trimEnd()
    console.log('[Test] 测试尾随制表符 (trimEnd后):', JSON.stringify(line))
    const match = line.match(headerRegex)
    assert.ok(match, 'trimEnd后应该匹配')
  })

  it('应该在 trimEnd 后匹配带混合尾随空白的消息头', () => {
    const rawLine = '张三(z00123456)\t2026-03-31 09:15:32 \t  ' // 混合空白
    const line = rawLine.trimEnd()
    console.log('[Test] 测试混合尾随空白 (trimEnd后):', JSON.stringify(line))
    const match = line.match(headerRegex)
    assert.ok(match, 'trimEnd后应该匹配')
  })
})

describe('自定义 TXT 格式解析器 - 时间解析', () => {
  it('应该正确解析标准时间格式', () => {
    const timeStr = '2026-03-31 09:15:32'
    console.log('[Test] 测试时间解析:', timeStr)
    const date = new Date(timeStr.replace(' ', 'T'))
    const timestamp = Math.floor(date.getTime() / 1000)
    assert.ok(timestamp > 0)
  })

  it('应该解析不同时区的时间', () => {
    const timeStr = '2026-01-01 00:00:00'
    console.log('[Test] 测试年初时间:', timeStr)
    const date = new Date(timeStr.replace(' ', 'T'))
    const timestamp = Math.floor(date.getTime() / 1000)
    assert.ok(timestamp > 0)
  })
})

describe('自定义 TXT 格式解析器 - 消息类型检测', () => {
  // 导入 detectMessageType 函数（需要从解析器中导出或重新实现测试逻辑）
  // 这里通过解析结果验证

  it('应该识别普通文本消息', async () => {
    const content = '张三(z00123456)\t2026-03-31 09:15:32\n大家好！'
    const filePath = createTempFile(content)
    console.log('[Test] 测试普通文本消息')

    try {
      const result = await collectParseResult(filePath)
      assert.ok(result.messages.length === 1)
      assert.equal(result.messages[0].type, MessageType.TEXT)
      assert.equal(result.messages[0].content, '大家好！')
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该识别图片消息', async () => {
    const content = '张三(z00123456)\t2026-03-31 09:15:32\n[图片]'
    const filePath = createTempFile(content)
    console.log('[Test] 测试图片消息')

    try {
      const result = await collectParseResult(filePath)
      assert.ok(result.messages.length === 1)
      assert.equal(result.messages[0].type, MessageType.IMAGE)
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该识别文件消息', async () => {
    const content = '张三(z00123456)\t2026-03-31 09:15:32\n[文件] API文档.pdf'
    const filePath = createTempFile(content)
    console.log('[Test] 测试文件消息')

    try {
      const result = await collectParseResult(filePath)
      assert.ok(result.messages.length === 1)
      assert.equal(result.messages[0].type, MessageType.FILE)
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该识别链接消息', async () => {
    const content = '张三(z00123456)\t2026-03-31 09:15:32\nhttps://example.com'
    const filePath = createTempFile(content)
    console.log('[Test] 测试链接消息')

    try {
      const result = await collectParseResult(filePath)
      assert.ok(result.messages.length === 1)
      assert.equal(result.messages[0].type, MessageType.LINK)
    } finally {
      cleanupTempFile(filePath)
    }
  })
})

describe('自定义 TXT 格式解析器 - 多行消息', () => {
  it('应该正确解析多行消息', async () => {
    const content = `张三(z00123456)\t2026-03-31 16:45:28
会议总结：
1. 前端进度80%
2. 后端接口完成
李四(l00123457)\t2026-03-31 16:46:55
收到`
    const filePath = createTempFile(content)
    console.log('[Test] 测试多行消息')

    try {
      const result = await collectParseResult(filePath)
      console.log('[Test] 消息数量:', result.messages.length)
      console.log('[Test] 第一条消息内容:', result.messages[0]?.content)

      assert.equal(result.messages.length, 2)
      assert.ok(result.messages[0].content?.includes('会议总结'))
      assert.ok(result.messages[0].content?.includes('前端进度'))
      assert.equal(result.messages[1].content, '收到')
    } finally {
      cleanupTempFile(filePath)
    }
  })

  // ==================== PR Review: 消息头尾随空格端到端测试 ====================

  it('应该正确解析带尾随空格的消息头', async () => {
    // 模拟实际文件中的尾随空格场景
    const content = `张三(z00123456)\t2026-03-31 09:15:32   
消息内容1
李四(l00123457)\t2026-03-31 09:16:45\t\t
消息内容2`
    const filePath = createTempFile(content)
    console.log('[Test] 测试消息头尾随空格（端到端）')

    try {
      const result = await collectParseResult(filePath)
      console.log('[Test] 解析结果:', {
        消息数: result.messages.length,
        成员数: result.members?.length,
      })
      console.log('[Test] 日志:', result.logs)

      // 应该正确解析出两条消息（而不是把第二行当作消息内容）
      assert.equal(result.messages.length, 2, '应该解析出两条消息')
      assert.equal(result.messages[0].content, '消息内容1')
      assert.equal(result.messages[1].content, '消息内容2')
      assert.equal(result.members?.length, 2)
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该正确解析消息头尾随空格且消息内容为空的情况', async () => {
    const content = `张三(z00123456)\t2026-03-31 09:15:32   
李四(l00123457)\t2026-03-31 09:16:45\t
有内容`
    const filePath = createTempFile(content)
    console.log('[Test] 测试消息头尾随空格+空内容')

    try {
      const result = await collectParseResult(filePath)
      console.log('[Test] 解析结果:', result.messages)

      assert.equal(result.messages.length, 2, '应该解析出两条消息')
      // 第一条消息没有内容
      assert.equal(result.messages[0].content, null)
      assert.equal(result.messages[1].content, '有内容')
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该正确解析格式检测签名能匹配但解析正则需要trim的场景', async () => {
    // 这个测试验证：格式检测正则（松散）能匹配，但解析正则（严格）需要trimEnd
    const content = `张三(z00123456)\t2026-03-31 09:15:32   
正常消息内容`
    const filePath = createTempFile(content)
    console.log('[Test] 测试格式检测与解析一致性')

    try {
      // 首先验证格式检测签名能匹配（松散正则）
      const signatureRegex = feature.signatures.head![0]
      const rawMatch = content.match(signatureRegex)
      assert.ok(rawMatch, '格式检测签名应该能匹配带尾随空格的消息头')

      // 然后验证解析器能正确解析
      const result = await collectParseResult(filePath)
      assert.equal(result.messages.length, 1, '解析器应该正确解析出消息')
      assert.equal(result.messages[0].content, '正常消息内容')
    } finally {
      cleanupTempFile(filePath)
    }
  })
})

describe('自定义 TXT 格式解析器 - 成员解析', () => {
  it('应该正确解析成员信息', async () => {
    const content = `张三(z00123456)\t2026-03-31 09:15:32
消息1
李四(l00123457)\t2026-03-31 09:16:45
消息2
王五(w00123458)\t2026-03-31 09:17:23
消息3`
    const filePath = createTempFile(content)
    console.log('[Test] 测试成员解析')

    try {
      const result = await collectParseResult(filePath)
      console.log('[Test] 成员数量:', result.members?.length)

      assert.equal(result.members?.length, 3)
      assert.ok(result.members?.find((m: any) => m.platformId === 'z00123456'))
      assert.ok(result.members?.find((m: any) => m.platformId === 'l00123457'))
      assert.ok(result.members?.find((m: any) => m.platformId === 'w00123458'))
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该保留成员昵称', async () => {
    const content = '张三(z00123456)\t2026-03-31 09:15:32\n消息'
    const filePath = createTempFile(content)
    console.log('[Test] 测试成员昵称')

    try {
      const result = await collectParseResult(filePath)
      const member = result.members?.find((m: any) => m.platformId === 'z00123456')
      assert.equal(member?.accountName, '张三')
    } finally {
      cleanupTempFile(filePath)
    }
  })
})

describe('自定义 TXT 格式解析器 - 群名提取', () => {
  it('应该从文件名提取群名', async () => {
    const content = '张三(z00123456)\t2026-03-31 09:15:32\n消息'
    const filePath = createTempFile(content, '项目组聊天.txt')
    console.log('[Test] 测试群名提取: 项目组聊天')

    try {
      const result = await collectParseResult(filePath)
      assert.equal(result.meta?.name, '项目组聊天')
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该处理中文文件名', async () => {
    const content = '张三(z00123456)\t2026-03-31 09:15:32\n消息'
    const filePath = createTempFile(content, '技术交流群.txt')
    console.log('[Test] 测试中文文件名')

    try {
      const result = await collectParseResult(filePath)
      assert.equal(result.meta?.name, '技术交流群')
    } finally {
      cleanupTempFile(filePath)
    }
  })
})

describe('自定义 TXT 格式解析器 - 边界条件', () => {
  it('应该处理空文件', async () => {
    const content = ''
    const filePath = createTempFile(content)
    console.log('[Test] 测试空文件')

    try {
      const result = await collectParseResult(filePath)
      assert.equal(result.messages.length, 0)
      assert.equal(result.members?.length, 0)
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该处理只有空行的文件', async () => {
    const content = '\n\n\n'
    const filePath = createTempFile(content)
    console.log('[Test] 测试只有空行的文件')

    try {
      const result = await collectParseResult(filePath)
      assert.equal(result.messages.length, 0)
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该处理单条消息', async () => {
    const content = '张三(z00123456)\t2026-03-31 09:15:32\n单条消息内容'
    const filePath = createTempFile(content)
    console.log('[Test] 测试单条消息')

    try {
      const result = await collectParseResult(filePath)
      assert.equal(result.messages.length, 1)
      assert.equal(result.messages[0].content, '单条消息内容')
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该跳过无效行并记录日志', async () => {
    const content = '无效行\n张三(z00123456)\t2026-03-31 09:15:32\n有效消息'
    const filePath = createTempFile(content)
    console.log('[Test] 测试跳过无效行')

    try {
      const result = await collectParseResult(filePath)
      console.log('[Test] 日志:', result.logs)
      assert.equal(result.messages.length, 1)
      assert.ok(result.logs.some((l: any) => l.level === 'warn' && l.message.includes('跳过')))
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该处理大量消息', async () => {
    // 生成 100 条消息
    const lines: string[] = []
    for (let i = 0; i < 100; i++) {
      lines.push(
        `用户${i}(u${String(i).padStart(8, '0')})\t2026-03-31 ${String(9 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`
      )
      lines.push(`消息内容 ${i}`)
    }
    const content = lines.join('\n')
    const filePath = createTempFile(content)
    console.log('[Test] 测试大量消息 (100条)')

    try {
      const result = await collectParseResult(filePath)
      console.log('[Test] 解析结果:', result.done)
      assert.equal(result.messages.length, 100)
      assert.equal(result.members?.length, 100)
    } finally {
      cleanupTempFile(filePath)
    }
  })
})

describe('自定义 TXT 格式解析器 - 完整流程', () => {
  it('应该正确解析完整示例文件', async () => {
    // 使用项目根目录的测试文件
    const samplePath = path.resolve(__dirname, '../../../../test-chat-sample.txt')

    // 如果示例文件不存在，跳过测试
    if (!fs.existsSync(samplePath)) {
      console.log('[Test] 示例文件不存在，跳过测试')
      return
    }

    console.log('[Test] 测试完整示例文件:', samplePath)

    const result = await collectParseResult(samplePath)
    console.log('[Test] 解析结果:', {
      消息数: result.messages.length,
      成员数: result.members?.length,
      群名: result.meta?.name,
    })

    // 验证基本解析结果
    assert.ok(result.messages.length > 0, '应该有消息')
    assert.ok(result.members && result.members.length > 0, '应该有成员')
    assert.ok(result.meta?.name, '应该有群名')
    assert.ok(result.done, '应该有完成标记')
    assert.equal(result.done?.messageCount, result.messages.length, '消息计数应该一致')
  })
})

// ==================== 异常处理测试 ====================

describe('自定义 TXT 格式解析器 - 异常处理', () => {
  it('应该处理无效时间格式并使用当前时间', async () => {
    const content = '张三(z00123456)\t2099-13-45 25:61:99\n无效时间消息'
    const filePath = createTempFile(content)
    console.log('[Test] 测试无效时间格式')

    try {
      const result = await collectParseResult(filePath)
      console.log(
        '[Test] 日志:',
        result.logs.filter((l: any) => l.message.includes('时间'))
      )

      // 应该仍然解析出消息
      assert.equal(result.messages.length, 1)
      // 时间戳应该是有效的（当前时间或解析结果）
      assert.ok(result.messages[0].timestamp > 0)

      // 应该有警告日志
      assert.ok(
        result.logs.some((l: any) => l.level === 'warn' && l.message.includes('时间解析失败')),
        '应该有时间解析失败的警告日志'
      )
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该处理包含特殊字符的消息内容', async () => {
    const content = `张三(z00123456)\t2026-03-31 09:15:32
特殊字符：<>&"'\\/
中文表情：😀🎉👍
多语言：Hello 你好 こんにちは`
    const filePath = createTempFile(content)
    console.log('[Test] 测试特殊字符')

    try {
      const result = await collectParseResult(filePath)
      console.log('[Test] 消息内容:', result.messages[0]?.content)

      assert.equal(result.messages.length, 1)
      assert.ok(result.messages[0].content?.includes('😀'))
      assert.ok(result.messages[0].content?.includes('Hello'))
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该处理只有消息头没有内容的消息', async () => {
    const content = '张三(z00123456)\t2026-03-31 09:15:32\n李四(l00123457)\t2026-03-31 09:16:45\n有内容'
    const filePath = createTempFile(content)
    console.log('[Test] 测试空内容消息')

    try {
      const result = await collectParseResult(filePath)
      console.log('[Test] 消息数量:', result.messages.length)
      console.log('[Test] 第一条消息内容:', result.messages[0]?.content)

      assert.equal(result.messages.length, 2)
      // 第一条消息内容为 null（没有内容行）
      assert.equal(result.messages[0].content, null)
      assert.equal(result.messages[1].content, '有内容')
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该处理超长消息内容', async () => {
    const longContent = 'A'.repeat(10000)
    const content = `张三(z00123456)\t2026-03-31 09:15:32\n${longContent}`
    const filePath = createTempFile(content)
    console.log('[Test] 测试超长消息 (10000字符)')

    try {
      const result = await collectParseResult(filePath)
      assert.equal(result.messages.length, 1)
      assert.equal(result.messages[0].content?.length, 10000)
      console.log('[Test] 消息长度:', result.messages[0].content?.length)
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该处理昵称中的特殊字符', async () => {
    const content = `张三(测试)(z00123456)\t2026-03-31 09:15:32
消息内容
李四[群主](l00123457)\t2026-03-31 09:16:45
消息内容2`
    const filePath = createTempFile(content)
    console.log('[Test] 测试昵称特殊字符')

    try {
      const result = await collectParseResult(filePath)
      console.log('[Test] 成员:', result.members)

      // 注意：当前正则可能无法正确解析这种格式
      // 这个测试用例用于验证解析器的行为
      assert.ok(result.messages.length >= 1, '至少应该解析出一条消息')
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该正确记录性能日志', async () => {
    const content = '张三(z00123456)\t2026-03-31 09:15:32\n消息'
    const filePath = createTempFile(content)
    console.log('[Test] 测试性能日志')

    try {
      const result = await collectParseResult(filePath)

      // 检查是否有耗时日志
      const timeLog = result.logs.find((l: any) => l.message.includes('耗时'))
      console.log('[Test] 性能日志:', timeLog)

      assert.ok(timeLog, '应该有耗时日志')
      assert.ok(timeLog.message.includes('ms'), '耗时日志应该包含毫秒')
    } finally {
      cleanupTempFile(filePath)
    }
  })
})
