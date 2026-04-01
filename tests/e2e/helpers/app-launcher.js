'use strict'

/**
 * app-launcher.js
 *
 * 启动 Electron 应用并开启 CDP 端口，供 Playwright 连接
 *
 * 使用方法:
 *   const { launchApp, CDP_PORT } = require('./app-launcher')
 *   const app = await launchApp()
 *   // ... Playwright 连接，运行测试 ...
 *   await app.close()
 */

const { spawn } = require('child_process')
const net = require('net')
const path = require('path')

const DEFAULT_CDP_PORT = 9222
const ROOT_DIR = path.join(__dirname, '../../../')

/**
 * 查找可用端口
 * @param {number} startPort - 起始端口
 * @param {number} maxAttempts - 最大尝试次数
 * @returns {Promise<number>} - 可用端口号
 */
async function _findFreePort(startPort, maxAttempts = 100) {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    const bindable = await new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(port, '127.0.0.1')
    })
    if (bindable) return port
  }
  throw new Error(`无法找到可用端口（尝试范围: ${startPort}-${startPort + maxAttempts - 1}）`)
}

/**
 * 启动 Electron 应用并等待 CDP 端点可用
 * @param {Object} options - 配置选项
 * @param {number} [options.port] - 指定 CDP 端口（默认自动分配）
 * @returns {Promise<{ close(): Promise<void>, port: number }>}
 */
async function launchApp(options = {}) {
  // require('electron') 返回 electron 可执行文件的路径
  const electronPath = require('electron')
  const startedAt = Date.now()

  // 确定使用的端口：优先使用指定端口，否则自动分配
  let cdpPort
  if (options.port) {
    // 指定端口模式：等待端口释放
    const portFree = await _waitForPortFree(options.port, 5000)
    if (!portFree) {
      throw new Error(
        `CDP 端口 ${options.port} 被占用且无法在 5s 内释放。` +
          `可能原因：上一个测试实例未正确关闭。` +
          `建议：不指定 port 参数，使用自动端口分配。`
      )
    }
    cdpPort = options.port
  } else {
    // 自动端口模式：查找可用端口
    cdpPort = await _findFreePort(DEFAULT_CDP_PORT)
  }

  console.log(`[app-launcher] 启动 Electron...`)
  console.log(`[app-launcher] Electron 路径: ${electronPath}`)
  console.log(`[app-launcher] CDP 端口: ${cdpPort}`)

  // 使用构建后的入口文件
  const mainEntry = path.join(ROOT_DIR, 'out/main/index.js')

  const proc = spawn(electronPath, [mainEntry, `--remote-debugging-port=${cdpPort}`, '--no-sandbox', '--disable-gpu'], {
    cwd: ROOT_DIR,
    detached: false,
    stdio: 'pipe',
  })

  proc.on('error', (err) => {
    console.error(`[app-launcher] Electron 启动错误: ${err.message}`)
  })

  proc.on('exit', (code, signal) => {
    console.log(`[app-launcher] Electron 退出 — code: ${code}, signal: ${signal}`)
  })

  // 输出 Electron 日志
  proc.stdout.on('data', (d) => process.stdout.write(`[electron] ${d}`))
  proc.stderr.on('data', (d) => process.stderr.write(`[electron] ${d}`))

  // 等待 CDP 端点可用（最多 30s）
  await _waitForCdp(cdpPort, 30000)
  console.log(`[app-launcher] CDP 就绪，端口 ${cdpPort} — 启动耗时 ${Date.now() - startedAt}ms`)

  return {
    /** CDP 端口号 */
    port: cdpPort,

    /** 终止 Electron 进程 */
    async close() {
      console.log('[app-launcher] 关闭 Electron...')
      return new Promise((resolve) => {
        if (proc.exitCode !== null || proc.killed) {
          console.log(`[app-launcher] Electron 已退出 (code: ${proc.exitCode})`)
          resolve()
          return
        }

        const onExit = () => {
          console.log('[app-launcher] Electron 已关闭')
          resolve()
        }
        proc.once('exit', onExit)

        try {
          proc.kill('SIGTERM')
        } catch (e) {
          console.warn(`[app-launcher] SIGTERM 失败: ${e.message}`)
        }

        // 3s 后强制终止
        setTimeout(() => {
          try {
            proc.kill('SIGKILL')
          } catch (_) {}
          proc.removeListener('exit', onExit)
          resolve()
        }, 3000)
      })
    },
  }
}

/**
 * 等待端口可绑定
 * @param {number} port - 端口号
 * @param {number} timeoutMs - 超时时间（毫秒）
 * @returns {Promise<boolean>} - 端口是否可用
 */
async function _waitForPortFree(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const bindable = await new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(port, '127.0.0.1')
    })
    if (bindable) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  // 超时返回 false，让调用方决定如何处理
  return false
}

/**
 * 等待 CDP 端点响应
 */
async function _waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastErr = null

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`)
      if (res.ok) return
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  throw new Error(
    `CDP 端点在 ${timeoutMs}ms 后仍不可用，端口 ${port}。最后错误: ${lastErr ? lastErr.message : 'unknown'}`
  )
}

module.exports = {
  launchApp,
  /** @deprecated 使用 launchApp({ port: 9222 }) 或让端口自动分配 */
  CDP_PORT: DEFAULT_CDP_PORT,
  findFreePort: _findFreePort,
}
