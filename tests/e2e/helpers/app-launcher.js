'use strict'

/**
 * Electron 应用启动器
 * 通过 CDP 端口启动 Electron 实例以供 E2E 测试使用
 * 支持 TEST_MODE 绕过单实例锁，允许并行运行多个实例
 */

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

/**
 * 查找可用的 TCP 端口，并保持预留直到进程启动
 *
 * 问题修复：
 * 1. 原代码递归时使用 null + 1 = 1，应该使用 startPort + 1
 * 2. 添加最大重试限制，避免无限递归
 * 3. 改进错误处理和超时逻辑
 * 4. 返回保留的服务器和端口，避免 TOCTTOU 竞态
 */
async function findAvailablePortWithReservation(startPort = 9222, maxRetries = 100, currentRetry = 0) {
  const net = require('net')

  // 最大重试次数检查
  if (currentRetry >= maxRetries) {
    throw new Error(
      `Unable to find available port after ${maxRetries} attempts (tried ports ${startPort}-${startPort + maxRetries - 1})`
    )
  }

  const port = startPort + currentRetry

  return new Promise((resolve) => {
    const server = net.createServer()
    let completed = false

    const cleanup = () => {
      if (!completed) {
        completed = true
        // 确保 server 被正确关闭
        if (!server.closed) {
          server.close()
        }
      }
    }

    // 端口可用：成功监听，保持预留直到使用
    server.listen(port, () => {
      if (!completed) {
        completed = true
        // 返回保留的服务器和端口，调用方负责在启动进程后关闭
        resolve({ port, reservationServer: server })
      }
    })

    // 端口被占用或其他错误：标记失败
    server.on('error', () => {
      cleanup()
      resolve(null)
    })

    // 超时保护：100ms 未响应视为超时
    setTimeout(() => {
      if (!completed) {
        completed = true
        // 确保 server 被正确关闭
        if (!server.closed) {
          server.close()
        }
        resolve(null)
      }
    }, 100)
  }).then((result) => {
    // 找到可用端口，返回保留结果
    if (result) return result

    // 未找到，继续尝试下一个端口
    return findAvailablePortWithReservation(startPort, maxRetries, currentRetry + 1)
  })
}

/**
 * 启动 Electron 应用
 */
async function launchApp(options = {}) {
  let reservationServer = null
  let port = options.port

  if (!port) {
    // 查找可用端口并保持预留，防止 TOCTTOU 竞态
    // 两个并行启动不会发现相同的端口
    const reservation = await findAvailablePortWithReservation(9222)
    if (!reservation) {
      throw new Error('[AppLauncher] 无法找到可用端口')
    }
    port = reservation.port
    reservationServer = reservation.reservationServer
  }

  // 为并行 E2E 实例创建独立的用户数据目录，避免共享造成的冲突
  // 这防止了并发进程的状态泄漏、死锁和数据库冲突
  const userDataDir = options.userDataDir || (process.env.CHATLAB_E2E_USER_DATA_DIR ?
    path.join(process.env.CHATLAB_E2E_USER_DATA_DIR, `instance-${port}`) :
    path.join(os.tmpdir(), `chatlab-e2e-${port}`)
  )

  // 确保用户数据目录存在
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true })
  }

  const appPath = path.resolve(__dirname, '../../..')

  // 验证应用目录存在
  if (!fs.existsSync(appPath)) {
    throw new Error(`[AppLauncher] 应用目录不存在: ${appPath}`)
  }

  let electronExe
  if (process.platform === 'win32') {
    electronExe = path.resolve(appPath, 'node_modules/.bin/electron.cmd')
  } else {
    electronExe = path.resolve(appPath, 'node_modules/.bin/electron')
  }

  if (!fs.existsSync(electronExe)) {
    throw new Error(`Electron 可执行文件不存在: ${electronExe}`)
  }

  console.log(`[AppLauncher] 启动 Electron，CDP 端口: ${port}`)

  // 构建 Electron 启动参数
  // 重要：必须使用 --remote-debugging-port 命令行参数，而不是环境变量
  // Electron 不会读取 REMOTE_DEBUGGING_PORT 环境变量
  const electronArgs = [
    `--remote-debugging-port=${port}`,  // 启用 CDP 调试端口
    appPath,  // 应用路径作为最后的参数
  ]

  const proc = spawn(electronExe, electronArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      TEST_MODE: 'true',  // E2E 测试模式：允许多个实例
      CHATLAB_E2E_USER_DATA_DIR: userDataDir,  // 为该实例设置隔离的用户数据目录
      ELECTRON_ENABLE_LOGGING: '1',
    },
  })

  // 进程启动后，立即释放端口预留
  // 这样 Electron 可以绑定 --remote-debugging-port，避免其他进程抢占
  if (reservationServer) {
    reservationServer.close()
  }

  // 处理进程启动失败
  if (proc.exitCode !== null && proc.exitCode !== 0) {
    throw new Error(`[AppLauncher] Electron 启动失败，退出码: ${proc.exitCode}`)
  }

  // 监听进程错误事件
  let launchError = null
  let exitCode = null

  proc.on('error', (error) => {
    console.error(`[AppLauncher] Electron 进程错误:`, error.message)
    launchError = error
  })

  // 监听启动期间的进程退出
  // Node.js exit 事件有两个参数：code 和 signal
  // - code: null 当进程被信号杀死时；否则是数字退出码
  // - signal: 信号名称（如 'SIGKILL'）；正常退出时为 null
  let exitSignal = null
  proc.on('exit', (code, signal) => {
    exitCode = code
    exitSignal = signal
    if (code !== null && code !== 0) {
      console.error(`[AppLauncher] Electron 进程异常退出，退出码: ${code}`)
    }
    if (signal !== null) {
      console.error(`[AppLauncher] Electron 进程被信号杀死: ${signal}`)
    }
  })

  // 等待应用就绪
  // 注：这个延迟需要等应用真正启动完成，避免立即测试导致测试失败
  // TODO: 可以改进为监听应用就绪事件而不是固定延迟
  const startupWaitTime = options.startupWaitTime || 2000
  await new Promise((resolve) => setTimeout(resolve, startupWaitTime))

  // 检查启动过程中是否出现错误
  if (launchError) {
    throw new Error(`[AppLauncher] Electron 启动期间发生错误: ${launchError.message}`)
  }

  // 检查启动期间是否有非零退出或信号终止
  if (exitCode !== null && exitCode !== 0) {
    throw new Error(`[AppLauncher] Electron 启动期间异常退出，退出码: ${exitCode}`)
  }
  if (exitSignal !== null) {
    throw new Error(`[AppLauncher] Electron 启动期间被信号杀死: ${exitSignal}`)
  }

  return {
    proc,
    port,
    async close() {
      console.log(`[AppLauncher] 关闭应用 (PID: ${proc.pid})`)

      // 检查进程是否已经退出（自行退出或被杀死）
      // proc.killed 只在我们主动 kill 时为 true，不包括自行退出的情况
      // Node.js ChildProcess 使用 signalCode（不是 signalDescription）表示信号退出
      if (proc.exitCode !== null || proc.signalCode !== null) {
        // 进程已退出，直接返回
        console.log(`[AppLauncher] 应用已退出 (exit code: ${proc.exitCode}, signal: ${proc.signalCode})`)
        return
      }

      return new Promise((resolve) => {
        let resolved = false
        const exitHandler = () => {
          if (!resolved) {
            resolved = true
            clearTimeout(forceKillTimer)
            resolve()
          }
        }

        // 监听进程退出事件
        proc.once('exit', exitHandler)

        // 发送 SIGTERM 信号要求进程正常终止
        proc.kill('SIGTERM')

        // 强制杀死超时：5秒后强制 SIGKILL
        // 防止僵尸进程，确保测试能够顺利清理
        // 注：使用活力检查而不是 proc.killed，因为 proc.killed 在 SIGTERM 后立即变为 true
        // 但进程可能还未实际退出，需要检查进程是否真的存在
        const forceKillTimer = setTimeout(() => {
          if (!resolved) {
            // 尝试杀死进程：检查进程是否真的还在运行
            // 如果进程已退出，kill() 会抛出错误，我们忽略它
            try {
              proc.kill(0)  // 检查进程是否存在（发送信号 0 不会真的杀死）
              // 进程存在，发送 SIGKILL
              proc.kill('SIGKILL')
            } catch (err) {
              // 进程不存在，已正常退出
            }
          }
          // 5秒后必须 resolve，防止永久挂起
          if (!resolved) {
            resolved = true
            resolve()
          }
        }, 5000)
      })
    },
  }
}

module.exports = { launchApp }
