'use strict'

/**
 * app-launcher-port.spec.js
 *
 * 端到端测试：验证动态端口分配功能
 *
 * 测试场景：
 * - 多个测试并行运行时端口分配
 * - 端口占用时的自动切换
 */

const { test, expect, chromium } = require('@playwright/test')
const { launchApp } = require('../helpers/app-launcher')

test.describe('动态端口分配 E2E 测试', () => {
  test('应该自动分配可用端口并正确连接', async () => {
    console.log('[E2E] 测试自动端口分配')

    // 启动应用（不指定端口，使用自动分配）
    const app = await launchApp()

    console.log(`[E2E] 分配的端口: ${app.port}`)
    assert.ok(app.port >= 9222, '端口应该 >= 9222')

    try {
      // 通过 CDP 连接
      const browser = await chromium.connectOverCDP(`http://localhost:${app.port}`)
      const context = browser.contexts()[0]
      const page = context.pages()[0] || (await context.newPage())

      // 验证连接成功
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('text=/ChatLab/i').first()).toBeVisible({ timeout: 15000 })

      console.log('[E2E] ✅ 连接成功')

      // 断开连接
      await browser.disconnect()
    } finally {
      await app.close()
    }
  })

  test('应该支持指定端口', async () => {
    console.log('[E2E] 测试指定端口')

    // 使用指定的端口（假设 9333 可用）
    const app = await launchApp({ port: 9333 })

    console.log(`[E2E] 指定的端口: ${app.port}`)
    expect(app.port).toBe(9333)

    try {
      const browser = await chromium.connectOverCDP(`http://localhost:${app.port}`)
      const context = browser.contexts()[0]
      const page = context.pages()[0] || (await context.newPage())

      await page.waitForLoadState('domcontentloaded')
      console.log('[E2E] ✅ 指定端口连接成功')

      await browser.disconnect()
    } finally {
      await app.close()
    }
  })

  test('连续启动多个实例应该分配不同端口', async () => {
    console.log('[E2E] 测试多实例端口分配')

    const apps = []
    const ports = []

    try {
      // 连续启动 3 个实例
      for (let i = 0; i < 3; i++) {
        const app = await launchApp()
        apps.push(app)
        ports.push(app.port)
        console.log(`[E2E] 实例 ${i + 1} 端口: ${app.port}`)
      }

      // 验证端口各不相同
      const uniquePorts = new Set(ports)
      expect(uniquePorts.size).toBe(3)

      // 验证每个实例都能连接
      for (let i = 0; i < apps.length; i++) {
        const browser = await chromium.connectOverCDP(`http://localhost:${apps[i].port}`)
        const context = browser.contexts()[0]
        const page = context.pages()[0] || (await context.newPage())
        await page.waitForLoadState('domcontentloaded')
        await browser.disconnect()
        console.log(`[E2E] ✅ 实例 ${i + 1} 连接成功`)
      }
    } finally {
      // 清理所有实例
      for (const app of apps) {
        await app.close()
      }
    }
  })
})

// 使用 Node.js assert（Playwright test 不支持 require）
const assert = require('node:assert/strict')
