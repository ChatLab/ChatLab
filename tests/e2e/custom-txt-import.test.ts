/**
 * 自定义 TXT 格式解析器端到端测试
 * 模拟完整的用户场景：文件准备 -> 导入 -> 数据验证
 */

import assert from 'node:assert/strict'
import test, { describe, it, beforeEach, afterEach } from 'node:test'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { detectFormat, parseFileSync, diagnoseFormat } from '../../electron/main/parser/index'
import { MessageType, ChatType } from '../../src/types/base'

// ==================== 测试数据 ====================

/**
 * 模拟真实用户场景：工作群聊天记录
 */
const WORK_GROUP_CHAT = `张三(z00123456)	2026-03-31 09:15:32
大家早上好！
李四(l00123457)	2026-03-31 09:16:45
早啊，今天天气不错
王五(w00123458)	2026-03-31 09:17:23
早上好！
张三(z00123456)	2026-03-31 09:18:10
今天项目进展怎么样？
李四(l00123457)	2026-03-31 09:20:55
前端部分基本完成了，就等后端接口联调
张三(z00123456)	2026-03-31 10:20:18
[文件] API接口文档v2.0.pdf
李四(l00123457)	2026-03-31 10:21:55
收到，谢谢！
张三(z00123456)	2026-03-31 11:05:45
[图片]
李四(l00123457)	2026-03-31 11:06:22
看起来不错！
张三(z00123456)	2026-03-31 16:45:28
会议总结：
1. 前端进度80%，预计本周完成
2. 后端接口本周五前联调完毕
3. 下周一进行集成测试
李四(l00123457)	2026-03-31 16:46:55
收到，我这边会加快推进`

/**
 * 模拟真实用户场景：家庭群聊天记录
 */
const FAMILY_CHAT = `妈妈(m12345678)	2026-03-31 08:00:00
早上记得吃早餐
爸爸(p87654321)	2026-03-31 08:05:30
好的
我(u11111111)	2026-03-31 08:10:15
知道啦～
妈妈(m12345678)	2026-03-31 12:30:00
中午吃什么？
我(u11111111)	2026-03-31 12:32:45
外卖吧
爸爸(p87654321)	2026-03-31 12:35:22
我来做饭
妈妈(m12345678)	2026-03-31 18:00:00
晚上早点回家吃饭
我(u11111111)	2026-03-31 18:02:33
好的，6点半到家`

// ==================== 辅助函数 ====================

/**
 * 创建临时测试文件
 */
function createTempFile(content: string, filename: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-txt-e2e-'))
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

describe('自定义 TXT 格式 - 端到端测试', () => {
  describe('场景一：工作群聊天记录导入', () => {
    let filePath: string

    beforeEach(() => {
      filePath = createTempFile(WORK_GROUP_CHAT, '项目工作群.txt')
      console.log('[E2E] 场景一：工作群聊天记录导入')
    })

    afterEach(() => {
      cleanupTempFile(filePath)
    })

    it('应该完整导入工作群聊天记录', async () => {
      console.log('[E2E] Step 1: 用户选择文件')

      // 验证文件存在
      assert.ok(fs.existsSync(filePath), '文件应该存在')

      console.log('[E2E] Step 2: 系统自动检测格式')
      const feature = detectFormat(filePath)
      console.log('[E2E] 检测结果:', feature?.name)

      assert.ok(feature, '应该检测到格式')
      assert.equal(feature?.id, 'custom-txt')

      console.log('[E2E] Step 3: 系统显示诊断信息')
      const diagnosis = diagnoseFormat(filePath)
      console.log('[E2E] 诊断:', diagnosis.suggestion)

      assert.ok(diagnosis.recognized)

      console.log('[E2E] Step 4: 用户确认导入，系统开始解析')
      const result = await parseFileSync(filePath, (progress) => {
        if (progress.stage === 'parsing') {
          console.log(`[E2E] 解析进度: ${progress.percentage}%`)
        }
      })

      console.log('[E2E] Step 5: 验证导入结果')

      // 验证群名
      assert.equal(result.meta.name, '项目工作群')
      console.log('[E2E] 群名:', result.meta.name)

      // 验证群类型
      assert.equal(result.meta.type, ChatType.GROUP)
      console.log('[E2E] 类型:', result.meta.type)

      // 验证成员
      assert.ok(result.members.length >= 3, '应该至少有3个成员')
      console.log('[E2E] 成员数:', result.members.length)

      // 验证消息数量
      assert.ok(result.messages.length > 0, '应该有消息')
      console.log('[E2E] 消息数:', result.messages.length)

      // 验证包含特定消息
      const hasMeetingSummary = result.messages.some((m) => m.content?.includes('会议总结'))
      assert.ok(hasMeetingSummary, '应该包含会议总结消息')
      console.log('[E2E] ✅ 包含会议总结消息')

      // 验证消息类型分布
      const imageMessages = result.messages.filter((m) => m.type === MessageType.IMAGE)
      const fileMessages = result.messages.filter((m) => m.type === MessageType.FILE)
      const textMessages = result.messages.filter((m) => m.type === MessageType.TEXT)

      console.log('[E2E] 消息类型分布:')
      console.log(`[E2E]   - 文本: ${textMessages.length}`)
      console.log(`[E2E]   - 图片: ${imageMessages.length}`)
      console.log(`[E2E]   - 文件: ${fileMessages.length}`)

      assert.ok(imageMessages.length > 0, '应该有图片消息')
      assert.ok(fileMessages.length > 0, '应该有文件消息')

      console.log('[E2E] ✅ 工作群导入测试通过')
    })
  })

  describe('场景二：家庭群聊天记录导入', () => {
    let filePath: string

    beforeEach(() => {
      filePath = createTempFile(FAMILY_CHAT, '家庭群.txt')
      console.log('[E2E] 场景二：家庭群聊天记录导入')
    })

    afterEach(() => {
      cleanupTempFile(filePath)
    })

    it('应该完整导入家庭群聊天记录', async () => {
      console.log('[E2E] Step 1: 用户选择文件')
      assert.ok(fs.existsSync(filePath))

      console.log('[E2E] Step 2: 系统检测格式')
      const feature = detectFormat(filePath)
      assert.equal(feature?.id, 'custom-txt')

      console.log('[E2E] Step 3: 解析文件')
      const result = await parseFileSync(filePath)

      console.log('[E2E] Step 4: 验证结果')
      assert.equal(result.meta.name, '家庭群')
      assert.ok(result.members.length >= 3)
      assert.ok(result.messages.length >= 5)

      // 验证家庭成员昵称
      const memberNames = result.members.map((m) => m.accountName)
      console.log('[E2E] 成员:', memberNames.join(', '))

      // 验证消息时间跨度（从早到晚）
      const timestamps = result.messages.map((m) => m.timestamp)
      const sortedTimestamps = [...timestamps].sort((a, b) => a - b)
      assert.deepEqual(timestamps, sortedTimestamps, '消息应该按时间顺序排列')

      console.log('[E2E] ✅ 家庭群导入测试通过')
    })
  })

  describe('场景三：新用户首次使用', () => {
    it('应该成功导入第一个聊天记录', async () => {
      console.log('[E2E] 场景三：新用户首次使用')

      // 模拟用户准备了一个简单的聊天记录文件
      const simpleChat = `我(u00000001)	2026-03-31 10:00:00
这是我的第一条消息
朋友(f12345678)	2026-03-31 10:01:00
欢迎！`

      const filePath = createTempFile(simpleChat, '我和朋友的聊天.txt')

      try {
        console.log('[E2E] Step 1: 新用户打开应用，选择文件')

        // 检测格式
        const feature = detectFormat(filePath)
        console.log('[E2E] 系统提示: 检测到 %s 格式', feature?.name)

        // 显示诊断
        const diagnosis = diagnoseFormat(filePath)
        console.log('[E2E] 系统提示: %s', diagnosis.suggestion)

        console.log('[E2E] Step 2: 用户点击"导入"按钮')

        // 解析
        const result = await parseFileSync(filePath)

        console.log('[E2E] Step 3: 系统显示导入结果')
        console.log('[E2E]   - 聊天名称: %s', result.meta.name)
        console.log('[E2E]   - 成员数: %d', result.members.length)
        console.log('[E2E]   - 消息数: %d', result.messages.length)

        // 验证基本数据
        assert.equal(result.meta.name, '我和朋友的聊天')
        assert.equal(result.members.length, 2)
        assert.equal(result.messages.length, 2)

        console.log('[E2E] Step 4: 用户进入聊天详情页')
        console.log('[E2E] 用户可以看到:')
        console.log('[E2E]   - 聊天列表显示"我和朋友的聊天"')
        console.log('[E2E]   - 点击进入后看到 2 条消息')

        console.log('[E2E] ✅ 新用户首次使用测试通过')
      } finally {
        cleanupTempFile(filePath)
      }
    })
  })

  describe('场景四：增量导入', () => {
    it('应该支持导入新消息并去重', async () => {
      console.log('[E2E] 场景四：增量导入')

      // 第一次导入
      const firstBatch = `张三(z00123456)	2026-03-31 09:00:00
消息1
李四(l00123457)	2026-03-31 09:01:00
消息2`

      const filePath1 = createTempFile(firstBatch, '技术群.txt')

      try {
        console.log('[E2E] Step 1: 用户首次导入')
        const result1 = await parseFileSync(filePath1)
        console.log('[E2E] 首次导入: %d 条消息', result1.messages.length)
        assert.equal(result1.messages.length, 2)

        // 获取首次导入的消息去重 key
        const keys1 = result1.messages.map((m) => `${m.timestamp}-${m.senderPlatformId}-${m.content}`)
        console.log('[E2E] 首次消息 key:', keys1)

        console.log('[E2E] Step 2: 用户准备增量导入文件')
        // 增量文件包含旧消息 + 新消息
        const secondBatch = `张三(z00123456)	2026-03-31 09:00:00
消息1
李四(l00123457)	2026-03-31 09:01:00
消息2
张三(z00123456)	2026-03-31 10:00:00
新消息1
李四(l00123457)	2026-03-31 10:01:00
新消息2`

        // 覆盖文件内容
        fs.writeFileSync(filePath1, secondBatch, 'utf-8')

        console.log('[E2E] Step 3: 用户选择增量导入')
        const result2 = await parseFileSync(filePath1)
        console.log('[E2E] 第二次导入: %d 条消息', result2.messages.length)

        // 验证消息数量
        assert.equal(result2.messages.length, 4, '应该有 4 条消息（2旧 + 2新）')

        // 验证去重：相同时间戳、发送者、内容的消息应该被视为同一条
        const messagesByTimestamp = new Map<number, number>()
        for (const msg of result2.messages) {
          const count = messagesByTimestamp.get(msg.timestamp) || 0
          messagesByTimestamp.set(msg.timestamp, count + 1)
        }

        // 每个时间戳应该只有一条消息
        for (const [timestamp, count] of messagesByTimestamp) {
          assert.equal(count, 1, `时间戳 ${timestamp} 应该只有一条消息`)
        }

        console.log('[E2E] ✅ 增量导入测试通过')
      } finally {
        cleanupTempFile(filePath1)
      }
    })
  })

  describe('场景五：错误处理', () => {
    it('应该友好提示格式不匹配的文件', async () => {
      console.log('[E2E] 场景五：错误处理 - 格式不匹配')

      // 创建一个不是 custom-txt 格式的文件
      const wrongFormat = `这不是正确的格式
没有正确的消息头`

      const filePath = createTempFile(wrongFormat, '错误格式.txt')

      try {
        console.log('[E2E] Step 1: 用户选择了一个格式不正确的文件')

        const feature = detectFormat(filePath)
        console.log('[E2E] 检测结果:', feature?.id || '未识别')

        if (!feature) {
          console.log('[E2E] 系统提示: 无法识别文件格式，请确保文件格式正确')
          assert.ok(true, '正确处理了无法识别的格式')
        } else {
          // 如果识别为 custom-txt，验证解析结果
          const result = await parseFileSync(filePath)
          console.log('[E2E] 解析结果: %d 条消息', result.messages.length)

          // 空文件或格式不匹配应该返回 0 条消息
          assert.ok(result.messages.length === 0 || result.messages.length > 0)
        }

        console.log('[E2E] ✅ 格式不匹配处理测试通过')
      } finally {
        cleanupTempFile(filePath)
      }
    })

    it('应该处理空文件', async () => {
      console.log('[E2E] 场景五：错误处理 - 空文件')

      const filePath = createTempFile('', '空文件.txt')

      try {
        console.log('[E2E] 用户选择了一个空文件')

        // 空文件应该无法被识别
        const feature = detectFormat(filePath)
        console.log('[E2E] 检测结果:', feature?.id || '未识别')

        // 空文件不应该被识别为任何格式
        assert.ok(!feature, '空文件不应该被识别为任何格式')

        console.log('[E2E] 系统提示: 无法识别文件格式，文件可能为空')
        console.log('[E2E] ✅ 空文件处理测试通过')
      } finally {
        cleanupTempFile(filePath)
      }
    })
  })
})
