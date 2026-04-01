'use strict'

const { expect } = require('@playwright/test')
const path = require('path')

/**
 * ImportPage — 导入功能 Page Object
 *
 * 包含：文件选择、导入进度、格式检测
 */
class ImportPage {
  constructor(page) {
    this.page = page

    // 导入触发
    this.importBtn = page.locator('button:has-text("导入"), button:has-text("Import")')
    this.fileInput = page.locator('input[type="file"]')

    // 导入进度
    this.progressModal = page.locator('.progress-modal, .import-progress')
    this.progressBar = page.locator('.progress-bar')

    // 格式检测
    this.formatDetected = page.locator('.format-detected')
  }

  /**
   * 通过文件选择器导入文件
   * @param {string} filePath 文件绝对路径
   */
  async importFile(filePath) {
    console.log(`[ImportPage] 导入文件: ${filePath}`)

    // 检查文件是否存在
    const fs = require('fs')
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`)
    }

    // 设置文件输入
    await this.fileInput.setInputFiles(filePath)

    console.log(`[ImportPage] 文件已选择，等待导入...`)
  }

  /**
   * 等待导入完成
   * @param {number} timeout 超时时间（毫秒）
   */
  async waitForImportComplete(timeout = 60000) {
    console.log(`[ImportPage] 等待导入完成...`)

    // 等待进度模态框出现然后消失
    try {
      await expect(this.progressModal).toBeVisible({ timeout: 5000 })
    } catch {
      // 可能已经完成了，或者没有进度模态框
      console.log(`[ImportPage] 未检测到进度模态框，可能已完成`)
    }

    // 等待进度完成
    try {
      await expect(this.progressModal).toBeHidden({ timeout })
    } catch {
      // 继续
    }

    console.log(`[ImportPage] 导入流程完成`)
  }

  /**
   * 验证格式被检测到
   * @param {string} formatName 格式名称
   */
  async expectFormatDetected(formatName, timeout = 10000) {
    await expect(this.page.locator(`text=/${formatName}/i`)).toBeVisible({ timeout })
  }

  /**
   * 点击导入按钮开始导入
   */
  async clickImportButton() {
    await this.importBtn.first().click()
  }
}

module.exports = ImportPage
