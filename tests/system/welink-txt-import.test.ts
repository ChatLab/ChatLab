/**
 * 自定义 TXT 格式解析器系统测试
 * 测试完整的导入流程：文件检测 -> 解析 -> 数据验证
 */

import assert from 'node:assert/strict'
import test, { describe, it, beforeEach, afterEach } from 'node:test'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { detectFormat, parseFileSync, parseFile } from '../../electron/main/parser/index'
import { MessageType } from '../../src/types/base'

// ==================== 辅助函数 ====================

/**
 * 创建临时测试文件
 */
function createTempFile(content: string, filename: string = 'test-chat.txt'): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-txt-system-'))
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
 * 生成大量测试数据
 */
function generateLargeChatFile(messageCount: number): string {
  const lines: string[] = []
  for (let i = 0; i < messageCount; i++) {
    const userId = String.fromCharCode(97 + (i % 26)) + String(i).padStart(8, '0')
    const userName = `用户${i}`
    const hour = 9 + Math.floor(i / 60)
    const minute = i % 60
    lines.push(
      `${userName}(${userId})\t2026-03-31 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
    )
    lines.push(`这是第 ${i + 1} 条消息的内容，用于测试大量数据处理能力。`)
  }
  return lines.join('\n')
}

// ==================== 测试套件 ====================

describe('自定义 TXT 格式 - 系统测试', () => {
  describe('完整导入流程', () => {
    it('应该完成完整的文件导入流程', async () => {
      const content = `张三(z00123456)\t2026-03-31 09:15:32
大家早上好！
李四(l00123457)\t2026-03-31 09:16:45
早啊，今天天气不错
王五(w00123458)\t2026-03-31 09:17:23
早上好！`
      const filePath = createTempFile(content, '项目组.txt')
      console.log('[Test] 系统测试：完整导入流程')

      try {
        // Step 1: 检测格式
        console.log('[Test] Step 1: 检测文件格式')
        const feature = detectFormat(filePath)
        assert.ok(feature, '应该检测到格式')
        assert.equal(feature?.id, 'custom-txt')
        console.log('[Test] 检测结果:', feature?.name)

        // Step 2: 解析文件
        console.log('[Test] Step 2: 解析文件')
        const result = await parseFileSync(filePath, (progress) => {
          console.log(`[Test] 进度: ${progress.stage} - ${progress.percentage}%`)
        })

        // Step 3: 验证元数据
        console.log('[Test] Step 3: 验证元数据')
        assert.equal(result.meta.name, '项目组')
        assert.equal(result.meta.platform, 'unknown')
        assert.equal(result.meta.type, 'group')
        console.log('[Test] 元数据:', result.meta)

        // Step 4: 验证成员
        console.log('[Test] Step 4: 验证成员')
        assert.equal(result.members.length, 3)
        const memberIds = result.members.map((m) => m.platformId)
        assert.ok(memberIds.includes('z00123456'))
        assert.ok(memberIds.includes('l00123457'))
        assert.ok(memberIds.includes('w00123458'))
        console.log('[Test] 成员数:', result.members.length)

        // Step 5: 验证消息
        console.log('[Test] Step 5: 验证消息')
        assert.equal(result.messages.length, 3)
        assert.equal(result.messages[0].content, '大家早上好！')
        assert.equal(result.messages[1].content, '早啊，今天天气不错')
        assert.equal(result.messages[2].content, '早上好！')
        console.log('[Test] 消息数:', result.messages.length)

        console.log('[Test] ✅ 完整导入流程测试通过')
      } finally {
        cleanupTempFile(filePath)
      }
    })

    it('应该正确处理消息类型分类', async () => {
      const content = `张三(z00123456)\t2026-03-31 09:15:32
普通文本消息
李四(l00123457)\t2026-03-31 09:16:45
[图片]
王五(w00123458)\t2026-03-31 09:17:23
[文件] 文档.pdf
赵六(z00123459)\t2026-03-31 09:18:00
https://example.com`
      const filePath = createTempFile(content)
      console.log('[Test] 系统测试：消息类型分类')

      try {
        const result = await parseFileSync(filePath)

        console.log('[Test] 消息类型:')
        result.messages.forEach((msg, i) => {
          console.log(`[Test]   ${i + 1}. 类型=${msg.type}, 内容="${msg.content?.substring(0, 20)}..."`)
        })

        assert.equal(result.messages[0].type, MessageType.TEXT, '第1条应该是文本')
        assert.equal(result.messages[1].type, MessageType.IMAGE, '第2条应该是图片')
        assert.equal(result.messages[2].type, MessageType.FILE, '第3条应该是文件')
        assert.equal(result.messages[3].type, MessageType.LINK, '第4条应该是链接')

        console.log('[Test] ✅ 消息类型分类测试通过')
      } finally {
        cleanupTempFile(filePath)
      }
    })
  })

  describe('性能测试', () => {
    it('应该高效处理大量消息 (100条)', async () => {
      const messageCount = 100
      const content = generateLargeChatFile(messageCount)
      const filePath = createTempFile(content, '大群聊.txt')
      console.log(`[Test] 系统测试：处理 ${messageCount} 条消息`)

      try {
        const startTime = Date.now()
        const result = await parseFileSync(filePath, (progress) => {
          if (progress.stage === 'done') {
            console.log(`[Test] 解析完成，耗时: ${Date.now() - startTime}ms`)
          }
        })
        const endTime = Date.now()

        assert.equal(result.messages.length, messageCount)
        assert.equal(result.members.length, messageCount) // 每条消息一个用户

        console.log(`[Test] 性能指标:`)
        console.log(`[Test]   - 消息数: ${result.messages.length}`)
        console.log(`[Test]   - 成员数: ${result.members.length}`)
        console.log(`[Test]   - 耗时: ${endTime - startTime}ms`)
        console.log(`[Test]   - 平均: ${((endTime - startTime) / messageCount).toFixed(2)}ms/条`)

        console.log('[Test] ✅ 性能测试通过')
      } finally {
        cleanupTempFile(filePath)
      }
    })

    it('应该高效处理大量消息 (1000条)', async () => {
      const messageCount = 1000
      const content = generateLargeChatFile(messageCount)
      const filePath = createTempFile(content, '超大群聊.txt')
      console.log(`[Test] 系统测试：处理 ${messageCount} 条消息`)

      try {
        const startTime = Date.now()
        const result = await parseFileSync(filePath)
        const endTime = Date.now()

        assert.equal(result.messages.length, messageCount)

        console.log(`[Test] 性能指标:`)
        console.log(`[Test]   - 消息数: ${result.messages.length}`)
        console.log(`[Test]   - 耗时: ${endTime - startTime}ms`)
        console.log(`[Test]   - 平均: ${((endTime - startTime) / messageCount).toFixed(2)}ms/条`)

        // 性能要求：平均每条消息处理时间应该小于 1ms
        const avgTime = (endTime - startTime) / messageCount
        assert.ok(avgTime < 1, `平均处理时间应该小于 1ms，实际: ${avgTime.toFixed(3)}ms`)

        console.log('[Test] ✅ 性能测试通过')
      } finally {
        cleanupTempFile(filePath)
      }
    })
  })

  describe('数据完整性测试', () => {
    it('应该保持时间戳的正确性和顺序', async () => {
      const content = `张三(z00123456)\t2026-03-31 09:15:32
消息1
李四(l00123457)\t2026-03-31 10:30:45
消息2
王五(w00123458)\t2026-03-31 23:59:59
消息3`
      const filePath = createTempFile(content)
      console.log('[Test] 系统测试：时间戳正确性')

      try {
        const result = await parseFileSync(filePath)

        // 验证时间戳顺序
        for (let i = 1; i < result.messages.length; i++) {
          assert.ok(
            result.messages[i].timestamp >= result.messages[i - 1].timestamp,
            `消息 ${i + 1} 的时间戳应该大于等于消息 ${i}`
          )
        }

        // 验证具体时间戳
        const expectedTimestamps = [
          new Date('2026-03-31T09:15:32').getTime() / 1000,
          new Date('2026-03-31T10:30:45').getTime() / 1000,
          new Date('2026-03-31T23:59:59').getTime() / 1000,
        ]

        result.messages.forEach((msg, i) => {
          console.log(`[Test] 消息 ${i + 1}: 期望=${expectedTimestamps[i]}, 实际=${msg.timestamp}`)
          assert.equal(msg.timestamp, Math.floor(expectedTimestamps[i]))
        })

        console.log('[Test] ✅ 时间戳测试通过')
      } finally {
        cleanupTempFile(filePath)
      }
    })

    it('应该正确处理 Unicode 和特殊字符', async () => {
      const content = `张三(z00123456)\t2026-03-31 09:15:32
表情测试：😀🎉👍
李四(l00123457)\t2026-03-31 09:16:45
特殊字符：<>&"'\\/
王五(w00123458)\t2026-03-31 09:17:23
多语言：你好 Hello こんにちは 안녕하세요`
      const filePath = createTempFile(content)
      console.log('[Test] 系统测试：Unicode 和特殊字符')

      try {
        const result = await parseFileSync(filePath)

        assert.ok(result.messages[0].content?.includes('😀'))
        assert.ok(result.messages[1].content?.includes('<>&'))
        assert.ok(result.messages[2].content?.includes('Hello'))

        console.log('[Test] 消息内容:')
        result.messages.forEach((msg, i) => {
          console.log(`[Test]   ${i + 1}. ${msg.content}`)
        })

        console.log('[Test] ✅ Unicode 测试通过')
      } finally {
        cleanupTempFile(filePath)
      }
    })
  })

  describe('错误恢复测试', () => {
    it('应该优雅处理部分损坏的文件', async () => {
      const content = `张三(z00123456)\t2026-03-31 09:15:32
有效消息1
这是一行无效内容，不是消息头也不是消息内容
李四(l00123457)\t2026-03-31 09:16:45
有效消息2`
      const filePath = createTempFile(content)
      console.log('[Test] 系统测试：部分损坏文件')

      try {
        const result = await parseFileSync(filePath)

        // 应该仍然能解析出有效消息
        assert.ok(result.messages.length >= 2, '应该至少解析出 2 条有效消息')

        console.log('[Test] 解析结果:')
        console.log('[Test]   - 有效消息数:', result.messages.length)
        result.messages.forEach((msg, i) => {
          console.log(`[Test]   ${i + 1}. ${msg.content}`)
        })

        console.log('[Test] ✅ 错误恢复测试通过')
      } finally {
        cleanupTempFile(filePath)
      }
    })
  })
})
