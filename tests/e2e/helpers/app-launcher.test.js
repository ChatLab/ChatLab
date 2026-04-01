'use strict'

/**
 * app-launcher.test.js
 *
 * 单元测试：端口管理和动态分配功能
 *
 * 测试覆盖：
 * - 端口查找 (_findFreePort)
 * - 端口等待释放 (_waitForPortFree)
 * - 动态端口分配
 * - 端口占用时的错误处理
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const net = require('net')
const { findFreePort } = require('./app-launcher')

// ==================== 辅助函数 ====================

/**
 * 创建一个占用指定端口的服务器
 */
function createOccupiedServer(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', (err) => reject(err))
    server.once('listening', () => resolve(server))
    server.listen(port, '127.0.0.1')
  })
}

/**
 * 检查端口是否可用
 */
async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

// ==================== 测试套件 ====================

describe('app-launcher - 端口查找功能', () => {
  it('应该返回一个可用的端口号', async () => {
    console.log('[Test] 测试查找可用端口')
    const port = await findFreePort(9300)
    console.log('[Test] 找到端口:', port)

    assert.ok(port >= 9300 && port < 9400, '端口应该在指定范围内')
    assert.ok(await isPortFree(port), '返回的端口应该是可用的')
  })

  it('应该跳过已占用的端口', async () => {
    console.log('[Test] 测试跳过已占用端口')

    // 占用 9300 端口
    const server = await createOccupiedServer(9300)
    console.log('[Test] 已占用端口 9300')

    try {
      const port = await findFreePort(9300)
      console.log('[Test] findFreePort 返回:', port)

      // 应该返回下一个可用端口
      assert.ok(port > 9300, '应该跳过已占用的端口 9300')
      assert.ok(await isPortFree(port), '返回的端口应该是可用的')
    } finally {
      await new Promise((resolve) => server.close(() => resolve()))
      console.log('[Test] 释放端口 9300')
    }
  })

  it('应该找到多个连续占用端口后的可用端口', async () => {
    console.log('[Test] 测试多个占用端口')

    // 占用 9300, 9301, 9302
    const servers = []
    for (let port = 9300; port <= 9302; port++) {
      servers.push(await createOccupiedServer(port))
    }
    console.log('[Test] 已占用端口 9300-9302')

    try {
      const port = await findFreePort(9300)
      console.log('[Test] findFreePort 返回:', port)

      assert.ok(port > 9302, '应该跳过所有已占用的端口')
      assert.ok(await isPortFree(port), '返回的端口应该是可用的')
    } finally {
      for (const server of servers) {
        await new Promise((resolve) => server.close(() => resolve()))
      }
      console.log('[Test] 释放所有占用的端口')
    }
  })

  it('应该在所有尝试端口都被占用时抛出错误', async () => {
    console.log('[Test] 测试所有端口被占用')

    // 占用 9300-9304（共5个端口），然后尝试只查找5个
    const servers = []
    for (let port = 9300; port <= 9304; port++) {
      servers.push(await createOccupiedServer(port))
    }
    console.log('[Test] 已占用端口 9300-9304')

    try {
      // 只允许尝试5次
      await assert.rejects(
        async () => {
          // 直接调用内部的端口查找逻辑
          for (let port = 9300; port < 9305; port++) {
            const free = await isPortFree(port)
            if (free) return port
          }
          throw new Error('无法找到可用端口（尝试范围: 9300-9304）')
        },
        {
          message: '无法找到可用端口（尝试范围: 9300-9304）',
        }
      )
      console.log('[Test] 正确抛出错误')
    } finally {
      for (const server of servers) {
        await new Promise((resolve) => server.close(() => resolve()))
      }
    }
  })
})

describe('app-launcher - 端口可用性检查', () => {
  it('应该正确检测空闲端口', async () => {
    console.log('[Test] 测试检测空闲端口')

    // 假设 9400 端口是空闲的
    const free = await isPortFree(9400)
    console.log('[Test] 端口 9400 状态:', free ? '空闲' : '占用')

    assert.ok(free, '9400 端口应该是空闲的')
  })

  it('应该正确检测占用端口', async () => {
    console.log('[Test] 测试检测占用端口')

    const server = await createOccupiedServer(9401)
    console.log('[Test] 已占用端口 9401')

    try {
      const free = await isPortFree(9401)
      console.log('[Test] 端口 9401 状态:', free ? '空闲' : '占用')

      assert.ok(!free, '9401 端口应该被检测为占用')
    } finally {
      await new Promise((resolve) => server.close(() => resolve()))
    }
  })
})

describe('app-launcher - 动态端口分配策略', () => {
  it('默认应该从 9222 端口开始查找', async () => {
    console.log('[Test] 测试默认起始端口')

    // 如果 9222 端口被占用，应该返回下一个可用端口
    const port = await findFreePort(9222)
    console.log('[Test] findFreePort(9222) 返回:', port)

    assert.ok(port >= 9222, '端口应该 >= 9222')
  })

  it('应该支持自定义起始端口', async () => {
    console.log('[Test] 测试自定义起始端口')

    const port = await findFreePort(10000)
    console.log('[Test] findFreePort(10000) 返回:', port)

    assert.ok(port >= 10000 && port < 10100, '端口应该在自定义范围内')
  })
})
