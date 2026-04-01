'use strict'

/**
 * ChatLab E2E 测试 - Playwright 配置
 *
 * 使用 CDP (Chrome DevTools Protocol) 连接 Electron 应用
 */

const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './specs',
  timeout: 90000, // 90s per test - Electron 启动 + 导入流程
  retries: 0,
  workers: 1, // 顺序执行：只有一个 Electron 实例运行（共享 CDP 端口）
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: 'tests/e2e/reports', open: 'never' }]],
  use: {
    viewport: { width: 1400, height: 900 },
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15000,
  },
})
