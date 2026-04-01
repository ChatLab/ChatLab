'use strict'

const { expect } = require('@playwright/test')

/**
 * AppPage — ChatLab 主页面
 *
 * 基于实际页面结构更新选择器
 */
class AppPage {
  constructor(page) {
    this.page = page

    // 主按钮
    this.newAnalysisBtn = page.getByRole('button', { name: /分析新聊天|Import/i })
    this.settingsBtn = page.getByRole('button', { name: /设置|Settings/i })

    // 会话列表区域
    this.sessionListArea = page.locator('text=/聊天记录|Chat History/i').locator('..')

    // 空状态
    this.emptyState = page.locator('text=/暂无记录|点击选择或拖拽/i')

    // 拖拽区域
    this.dropZone = page.locator('text=/点击选择或拖拽聊天记录导入/i').locator('..')

    // 文件输入
    this.fileInput = page.locator('input[type="file"]')

    // 通知区域
    this.notifyRegion = page.locator('[role="region"]:has-text("Notifications")')
  }

  /**
   * 等待应用加载完成
   */
  async waitForAppReady() {
    await this.page.waitForLoadState('domcontentloaded')

    // 等待品牌名出现（确认应用已加载）- 使用 first() 避免多元素错误
    await expect(this.page.locator('text=/ChatLab/i').first()).toBeVisible({ timeout: 15000 })

    // 等待导入按钮可见
    await expect(this.newAnalysisBtn).toBeVisible({ timeout: 10000 })
  }

  /**
   * 点击"分析新聊天"按钮
   */
  async clickNewAnalysis() {
    await this.newAnalysisBtn.click()
  }

  /**
   * 通过拖拽区域导入文件
   * @param {string} filePath 文件路径
   */
  async importFileByDrop(filePath) {
    console.log(`[AppPage] 导入文件: ${filePath}`)

    const fs = require('fs')
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`)
    }

    // 使用文件输入
    await this.fileInput.setInputFiles(filePath)

    console.log(`[AppPage] 文件已选择`)
  }

  /**
   * 等待成功通知
   */
  async expectSuccessNotification(timeout = 15000) {
    // ChatLab 使用 toast 通知
    const successToast = this.page.locator('.text-green, [class*="success"], text=/成功|Success/i')
    await expect(successToast.first()).toBeVisible({ timeout })
  }

  /**
   * 验证会话在列表中（通过名称）
   */
  async expectSessionInList(name, timeout = 15000) {
    await expect(this.page.locator(`text=/${name}/i`)).toBeVisible({ timeout })
  }

  /**
   * 选择会话
   */
  async selectSession(name) {
    await this.page.locator(`text=/${name}/i`).first().click()
  }

  /**
   * 获取会话数量
   */
  async getSessionCount() {
    // 尝试找到会话列表项
    const items = this.page.locator('[class*="session"], [class*="chat-item"]')
    return await items.count()
  }

  /**
   * 验证空状态显示
   */
  async expectEmptyState(timeout = 10000) {
    await expect(this.emptyState).toBeVisible({ timeout })
  }
}

module.exports = AppPage
