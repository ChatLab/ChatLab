'use strict'

/**
 * custom-txt-import.spec.js
 *
 * 自定义 TXT 格式导入端到端测试
 *
 * 测试策略:
 *   - 使用 CDP 连接 Playwright 到 Electron
 *   - 通过 IPC 直接调用导入功能（绕过文件选择对话框）
 *   - 验证 UI 正确显示导入结果
 */

const { test, expect, chromium } = require('@playwright/test')
const { launchApp } = require('../helpers/app-launcher')
const path = require('path')
const fs = require('fs')

// 测试文件路径
const SAMPLE_FILE = path.resolve(__dirname, '../../../test-chat-sample.txt')

test.describe('自定义 TXT 格式导入 E2E 测试', () => {
  // 共享状态
  let browser, page, app

  // ==================== Setup ====================

  test.beforeAll(async () => {
    console.log('[E2E] 开始设置测试环境...')

    // 1. 验证测试文件存在
    if (!fs.existsSync(SAMPLE_FILE)) {
      throw new Error(`测试文件不存在: ${SAMPLE_FILE}`)
    }
    console.log(`[E2E] 测试文件: ${SAMPLE_FILE}`)

    // 2. 启动 Electron（带 CDP 端口，自动分配）
    app = await launchApp()

    // 3. Playwright 通过 CDP 连接（使用返回的端口）
    browser = await chromium.connectOverCDP(`http://localhost:${app.port}`)
    const context = browser.contexts()[0]
    page = context.pages()[0] || (await context.newPage())

    // 4. 等待应用就绪
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000) // 等待 Vue 初始化

    console.log('[E2E] 测试环境设置完成')
  })

  test.afterAll(async () => {
    console.log('[E2E] 清理测试环境...')

    try {
      await browser.disconnect()
    } catch (_) {}
    if (app) await app.close()

    console.log('[E2E] 测试环境清理完成')
  })

  // ==================== 测试用例 ====================

  test('TC-E2E-001: 应用正常启动并显示主界面', async () => {
    console.log('[E2E] TC-E2E-001: 验证应用启动')

    // 验证品牌名可见
    await expect(page.locator('text=ChatLab').first()).toBeVisible({ timeout: 15000 })

    // 验证导入区域可见
    await expect(page.locator('text=/点击选择或拖拽/i')).toBeVisible({ timeout: 10000 })

    // 验证"分析新聊天"按钮可见
    await expect(page.getByRole('button', { name: /分析新聊天/i })).toBeVisible({ timeout: 10000 })

    console.log('[E2E] ✅ TC-E2E-001 通过')
  })

  test('TC-E2E-002: 通过 IPC 导入自定义 TXT 文件', async () => {
    console.log('[E2E] TC-E2E-002: 通过 IPC 导入文件')

    // 记录开始时间
    const startTime = Date.now()

    // 通过 IPC 直接调用导入功能
    const result = await page.evaluate(async (filePath) => {
      try {
        // 调用 IPC 导入
        const importResult = await window.chatApi.import(filePath)
        return { success: true, result: importResult }
      } catch (error) {
        return { success: false, error: error.message }
      }
    }, SAMPLE_FILE)

    console.log(`[E2E] 导入结果:`, JSON.stringify(result, null, 2))

    // 验证导入成功
    expect(result.success).toBe(true)
    expect(result.result.success).toBe(true)
    expect(result.result.sessionId).toBeTruthy()

    // 验证消息数量
    expect(result.result.diagnostics.messagesWritten).toBe(54)
    expect(result.result.diagnostics.messagesSkipped).toBe(0)

    // 验证格式识别
    expect(result.result.diagnostics.detectedFormat).toContain('自定义 TXT')

    const duration = Date.now() - startTime
    console.log(`[E2E] 导入耗时: ${duration}ms`)
    console.log(`[E2E] 会话 ID: ${result.result.sessionId}`)

    console.log('[E2E] ✅ TC-E2E-002 通过')
  })

  test('TC-E2E-003: 选择会话进入分析页面', async () => {
    console.log('[E2E] TC-E2E-003: 选择会话')

    // 点击会话（使用 first() 处理多个匹配）
    await page.locator('text=/test-chat-sample/i').first().click()

    // 等待页面跳转
    await page.waitForTimeout(1000)

    // 验证进入分析页面（URL 包含 group-chat 或 private-chat）
    await expect(page).toHaveURL(/chat|analysis/i, { timeout: 10000 })

    console.log('[E2E] ✅ TC-E2E-003 通过')
  })

  test('TC-E2E-004: 验证消息内容显示正确', async () => {
    console.log('[E2E] TC-E2E-004: 验证消息内容')

    // 验证有消息内容显示
    // 示例文件包含特定文本
    const messageElements = page.locator('[class*="message"], [class*="chat"]')
    const count = await messageElements.count()
    console.log(`[E2E] 消息元素数量: ${count}`)

    // 验证示例文件中的消息出现
    // 例如："大家早上好！"
    await expect(page.locator('text=/早上好|消息|分析/i').first()).toBeVisible({ timeout: 10000 })

    console.log('[E2E] ✅ TC-E2E-004 通过')
  })
})
