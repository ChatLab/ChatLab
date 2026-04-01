/**
 * 自定义 TXT 格式解析器集成测试
 * 测试解析器与嗅探器、导入流程的集成
 */

import assert from 'node:assert/strict'
import test, { describe, it, beforeEach, afterEach } from 'node:test'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { detectFormat, diagnoseFormat, parseFileSync, getSupportedFormats } from '../index'
import customTxt from './custom-txt'

// ==================== 辅助函数 ====================

/**
 * 创建临时测试文件
 */
function createTempFile(content: string, filename: string = 'test-chat.txt'): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-txt-integration-'))
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

// ==================== 测试套件 ====================

describe('自定义 TXT 格式解析器 - 嗅探器集成', () => {
  it('应该被嗅探器识别', async () => {
    const content = `张三(z00123456)\t2026-03-31 09:15:32
测试消息`
    const filePath = createTempFile(content)
    console.log('[Test] 测试嗅探器识别')

    try {
      const feature = detectFormat(filePath)
      console.log('[Test] 嗅探结果:', feature)

      assert.ok(feature, '应该识别到格式')
      assert.equal(feature?.id, 'custom-txt', '应该是 custom-txt 格式')
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该返回正确的诊断信息', async () => {
    const content = `张三(z00123456)\t2026-03-31 09:15:32
测试消息`
    const filePath = createTempFile(content)
    console.log('[Test] 测试诊断信息')

    try {
      const diagnosis = diagnoseFormat(filePath)
      console.log('[Test] 诊断结果:', {
        recognized: diagnosis.recognized,
        matchedFormat: diagnosis.matchedFormat?.name,
        suggestion: diagnosis.suggestion,
      })

      assert.ok(diagnosis.recognized, '应该识别成功')
      assert.equal(diagnosis.matchedFormat?.id, 'custom-txt')
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该在支持格式列表中', () => {
    console.log('[Test] 检查格式列表')
    const formats = getSupportedFormats()
    const customTxtFormat = formats.find((f) => f.id === 'custom-txt')

    assert.ok(customTxtFormat, 'custom-txt 应该在支持格式列表中')
    console.log('[Test] 找到格式:', customTxtFormat?.name)
  })

  it('应该优先级低于 LINE 格式（相同扩展名）', () => {
    console.log('[Test] 检查优先级')
    const formats = getSupportedFormats()
    const customTxtFormat = formats.find((f) => f.id === 'custom-txt')
    const lineFormat = formats.find((f) => f.id === 'line-native-txt')

    if (lineFormat && customTxtFormat) {
      // 优先级数字越小越优先
      assert.ok(lineFormat.priority < customTxtFormat.priority, 'LINE 格式应该优先于自定义 TXT')
      console.log('[Test] LINE 优先级:', lineFormat.priority)
      console.log('[Test] 自定义 TXT 优先级:', customTxtFormat.priority)
    }
  })
})

describe('自定义 TXT 格式解析器 - 解析流程集成', () => {
  it('应该通过 parseFileSync 完整解析', async () => {
    const content = `张三(z00123456)\t2026-03-31 09:15:32
消息1
李四(l00123457)\t2026-03-31 09:16:45
消息2`
    const filePath = createTempFile(content, '集成测试群.txt')
    console.log('[Test] 测试 parseFileSync')

    try {
      const result = await parseFileSync(filePath, (progress) => {
        console.log('[Test] 进度:', progress.stage, progress.percentage + '%')
      })

      console.log('[Test] 解析结果:', {
        meta: result.meta,
        memberCount: result.members.length,
        messageCount: result.messages.length,
      })

      assert.equal(result.meta.name, '集成测试群')
      assert.equal(result.members.length, 2)
      assert.equal(result.messages.length, 2)
      assert.equal(result.messages[0].content, '消息1')
      assert.equal(result.messages[1].content, '消息2')
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该正确处理多行消息内容', async () => {
    const content = `张三(z00123456)\t2026-03-31 09:15:32
第一行
第二行
第三行
李四(l00123457)\t2026-03-31 09:16:45
单行消息`
    const filePath = createTempFile(content)
    console.log('[Test] 测试多行消息解析')

    try {
      const result = await parseFileSync(filePath)

      assert.equal(result.messages.length, 2)
      assert.ok(result.messages[0].content?.includes('第一行'))
      assert.ok(result.messages[0].content?.includes('第二行'))
      assert.ok(result.messages[0].content?.includes('第三行'))
      assert.equal(result.messages[1].content, '单行消息')

      console.log('[Test] 多行消息内容:', result.messages[0].content)
    } finally {
      cleanupTempFile(filePath)
    }
  })
})

describe('自定义 TXT 格式解析器 - 格式边界测试', () => {
  it('应该不识别不符合格式的 TXT 文件', async () => {
    // 这是 QQ 格式的内容，不应该被识别为 custom-txt
    const content = `消息记录（此消息记录为文本格式，不支持重新导入）
消息对象:测试群
2019-07-16 18:15:05 地瓜(23333233)
测试消息`
    const filePath = createTempFile(content)
    console.log('[Test] 测试非 custom-txt 格式')

    try {
      const feature = detectFormat(filePath)
      console.log('[Test] 识别结果:', feature?.id, feature?.name)

      // 应该被识别为 QQ 格式而不是 custom-txt
      if (feature) {
        assert.notEqual(feature.id, 'custom-txt', 'QQ 格式不应该被识别为 custom-txt')
      }
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该识别混合中文英文昵称', async () => {
    const content = `张三(z00123456)\t2026-03-31 09:15:32
中文
John(a12345678)\t2026-03-31 09:16:45
English
李四(l00123457)\t2026-03-31 09:17:00
混合`
    const filePath = createTempFile(content)
    console.log('[Test] 测试中英文混合')

    try {
      const result = await parseFileSync(filePath)

      assert.equal(result.members.length, 3)
      assert.ok(result.members.find((m) => m.accountName === '张三'))
      assert.ok(result.members.find((m) => m.accountName === 'John'))
      assert.ok(result.members.find((m) => m.accountName === '李四'))

      console.log(
        '[Test] 成员列表:',
        result.members.map((m) => m.accountName)
      )
    } finally {
      cleanupTempFile(filePath)
    }
  })

  it('应该处理包含特殊字符的消息', async () => {
    const content = `张三(z00123456)\t2026-03-31 09:15:32
@李四 你好！
李四(l00123457)\t2026-03-31 09:16:45
收到 👍 http://example.com`
    const filePath = createTempFile(content)
    console.log('[Test] 测试特殊字符')

    try {
      const result = await parseFileSync(filePath)

      assert.equal(result.messages.length, 2)
      assert.ok(result.messages[0].content?.includes('@李四'))
      assert.ok(result.messages[1].content?.includes('👍'))
      assert.ok(result.messages[1].content?.includes('http://'))

      console.log(
        '[Test] 消息内容:',
        result.messages.map((m) => m.content)
      )
    } finally {
      cleanupTempFile(filePath)
    }
  })
})

describe('自定义 TXT 格式解析器 - 完整示例文件测试', () => {
  it('应该正确解析项目示例文件', async () => {
    const samplePath = path.resolve(__dirname, '../../../../test-chat-sample.txt')

    if (!fs.existsSync(samplePath)) {
      console.log('[Test] 示例文件不存在，跳过测试')
      return
    }

    console.log('[Test] 测试完整示例文件:', samplePath)

    // 1. 嗅探测试
    const feature = detectFormat(samplePath)
    console.log('[Test] 嗅探结果:', feature?.id, feature?.name)
    assert.equal(feature?.id, 'custom-txt')

    // 2. 解析测试
    const result = await parseFileSync(samplePath, (progress) => {
      if (progress.stage === 'done') {
        console.log('[Test] 解析进度: 完成')
      }
    })

    console.log('[Test] 解析结果:', {
      群名: result.meta.name,
      平台: result.meta.platform,
      类型: result.meta.type,
      成员数: result.members.length,
      消息数: result.messages.length,
    })

    // 3. 验证基本数据
    assert.ok(result.meta.name, '应该有群名')
    assert.ok(result.members.length > 0, '应该有成员')
    assert.ok(result.messages.length > 0, '应该有消息')

    // 4. 验证成员 ID 格式
    for (const member of result.members) {
      assert.ok(member.platformId, '成员应该有 platformId')
      console.log('[Test] 成员:', member.accountName, '(', member.platformId, ')')
    }

    // 5. 验证消息时间戳
    for (const msg of result.messages) {
      assert.ok(msg.timestamp > 0, '消息应该有有效时间戳')
      assert.ok(msg.senderPlatformId, '消息应该有发送者 ID')
    }

    // 6. 打印消息类型分布
    const typeCount: Record<number, number> = {}
    for (const msg of result.messages) {
      typeCount[msg.type] = (typeCount[msg.type] || 0) + 1
    }
    console.log('[Test] 消息类型分布:', typeCount)
  })
})
