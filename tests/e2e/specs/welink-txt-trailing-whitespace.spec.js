'use strict'

/**
 * custom-txt-trailing-whitespace.spec.js
 *
 * 端到端测试：验证消息头尾随空格解析功能
 *
 * PR Review Issue:
 * - 消息头带尾随空格时，正则无法匹配，导致解析出 0 条消息
 * - 修复：在解析前使用 trimEnd() 去除行尾空白
 */

const { test, expect, chromium } = require('@playwright/test')
const { launchApp } = require('../helpers/app-launcher')
const path = require('path')
const fs = require('fs')
const os = require('os')

/**
 * 创建带尾随空格的测试文件
 */
function createTestFileWithTrailingWhitespace() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailing-ws-test-'))
  const filePath = path.join(tempDir, 'test-trailing-ws.txt')

  // 文件内容：消息头带尾随空格/制表符
  const content = `张三(z00123456)\t2026-03-31 09:15:32   
第一条消息内容
李四(l00123457)\t2026-03-31 09:16:45\t\t
第二条消息内容
王五(w00123458)\t2026-03-31 09:17:00 \t  
第三条消息内容`

  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

/**
 * 清理测试文件
 */
function cleanupTestFile(filePath) {
  const dir = path.dirname(filePath)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test.describe('消息头尾随空格解析 E2E 测试', () => {
  let browser, page, app, testFilePath

  test.beforeAll(async () => {
    console.log('[E2E] 设置测试环境...')

    // 创建测试文件
    testFilePath = createTestFileWithTrailingWhitespace()
    console.log('[E2E] 测试文件:', testFilePath)

    // 启动应用
    app = await launchApp()
    console.log('[E2E] 应用端口:', app.port)

    // 连接 Playwright
    browser = await chromium.connectOverCDP(`http://localhost:${app.port}`)
    const context = browser.contexts()[0]
    page = context.pages()[0] || (await context.newPage())

    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    console.log('[E2E] 测试环境就绪')
  })

  test.afterAll(async () => {
    console.log('[E2E] 清理测试环境...')

    try {
      await browser.disconnect()
    } catch (_) {}
    if (app) await app.close()
    if (testFilePath) cleanupTestFile(testFilePath)

    console.log('[E2E] 清理完成')
  })

  test('应该正确解析带尾随空格的消息头', async () => {
    console.log('[E2E] 测试导入带尾随空格的文件')

    // 通过 IPC 导入文件
    const result = await page.evaluate(async (filePath) => {
      try {
        const importResult = await window.chatApi.import(filePath)
        return { success: true, result: importResult }
      } catch (error) {
        return { success: false, error: error.message }
      }
    }, testFilePath)

    console.log('[E2E] 导入结果:', JSON.stringify(result, null, 2))

    // 验证导入成功
    expect(result.success).toBe(true)
    expect(result.result.success).toBe(true)

    // 验证解析出正确的消息数量（3条，而不是0条）
    expect(result.result.diagnostics.messagesWritten).toBe(3)

    console.log('[E2E] ✅ 成功解析 3 条消息')
  })

  test('应该正确显示导入的会话', async () => {
    console.log('[E2E] 验证会话显示')

    // 等待会话列表更新
    await page.waitForTimeout(1000)

    // 点击会话
    await page.locator('text=/test-trailing-ws/i').first().click()
    await page.waitForTimeout(500)

    // 验证进入分析页面
    await expect(page).toHaveURL(/chat|analysis/i, { timeout: 10000 })

    console.log('[E2E] ✅ 会话正确显示')
  })

  test('应该正确显示消息内容', async () => {
    console.log('[E2E] 验证消息内容')

    // 验证消息内容可见
    await expect(page.locator('text=/第一条消息内容|第二条消息内容|第三条消息内容/i').first()).toBeVisible({
      timeout: 10000,
    })

    console.log('[E2E] ✅ 消息内容正确显示')
  })
})
