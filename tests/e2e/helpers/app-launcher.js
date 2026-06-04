'use strict'

/**
 * Electron 应用启动器
 * 通过 CDP 端口启动 Electron 实例以供 E2E 测试使用
 * 支持 TEST_MODE 绕过单实例锁，允许并行运行多个实例
 */

const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const net = require('node:net')
const { createRequire } = require('node:module')

const DEFAULT_START_PORT = 9222
const DEFAULT_MAX_PORT_RETRIES = 100
const DEFAULT_PORT_PROBE_TIMEOUT_MS = 100
const DEFAULT_STARTUP_WAIT_MS = 2000
const DEFAULT_FORCE_KILL_TIMEOUT_MS = 5000

function safeCloseServer(server) {
  if (!server) return
  try {
    server.close()
  } catch {
    // ignore close errors for probing server
  }
}

async function findAvailablePortWithReservation(
  startPort = DEFAULT_START_PORT,
  maxRetries = DEFAULT_MAX_PORT_RETRIES,
  currentRetry = 0,
  options = {}
) {
  const createServer = options.createServer || net.createServer
  const listenTimeoutMs = options.listenTimeoutMs ?? DEFAULT_PORT_PROBE_TIMEOUT_MS
  const lastErrorCode = options.lastErrorCode

  if (currentRetry >= maxRetries) {
    const errorSuffix = lastErrorCode ? ` Last error: ${lastErrorCode}.` : ''
    throw new Error(
      `Unable to find available port after ${maxRetries} attempts (tried ports ${startPort}-${startPort + maxRetries - 1}).${errorSuffix}`
    )
  }

  const port = startPort + currentRetry
  const result = await new Promise((resolve) => {
    const server = createServer()
    let completed = false
    let timer = null

    const done = (value) => {
      if (completed) return
      completed = true
      if (timer) clearTimeout(timer)
      resolve(value)
    }

    server.on('error', (error) => {
      safeCloseServer(server)
      done({ ok: false, errorCode: error?.code || 'UNKNOWN' })
    })

    server.listen(port, () => {
      done({ ok: true, port, reservationServer: server })
    })

    timer = setTimeout(() => {
      safeCloseServer(server)
      done({ ok: false, errorCode: 'TIMEOUT' })
    }, listenTimeoutMs)
  })

  if (result.ok) {
    return { port: result.port, reservationServer: result.reservationServer }
  }

  return findAvailablePortWithReservation(startPort, maxRetries, currentRetry + 1, {
    ...options,
    lastErrorCode: result.errorCode,
  })
}

async function terminateProcess(proc, { forceKillTimeoutMs = DEFAULT_FORCE_KILL_TIMEOUT_MS } = {}) {
  if (!proc) return

  if (proc.exitCode !== null || proc.signalCode !== null) {
    return
  }

  await new Promise((resolve) => {
    let resolved = false
    let forceKillTimer = null

    const exitHandler = () => {
      if (!resolved) {
        resolved = true
        if (forceKillTimer) clearTimeout(forceKillTimer)
        resolve()
      }
    }

    proc.once('exit', exitHandler)
    proc.kill('SIGTERM')

    forceKillTimer = setTimeout(() => {
      if (!resolved) {
        try {
          proc.kill(0)
          proc.kill('SIGKILL')
        } catch {
          // process already exited
        }
      }

      if (!resolved) {
        resolved = true
        resolve()
      }
    }, forceKillTimeoutMs)
  })
}

function releaseReservation(reservationServer) {
  safeCloseServer(reservationServer)
}

function resolveElectronExecutable(deps = {}) {
  if (deps.electronPath) return deps.electronPath

  const desktopPackageJson = path.resolve(__dirname, '../../../apps/desktop/package.json')
  const requireElectron = deps.requireElectron || createRequire(desktopPackageJson)

  try {
    const electronModule = requireElectron('electron')
    return typeof electronModule === 'string' ? electronModule : ''
  } catch (error) {
    throw new Error(`[AppLauncher] 无法解析 Electron 可执行文件: ${error.message}`)
  }
}

/**
 * 启动 Electron 应用
 */
async function launchApp(options = {}, deps = {}) {
  const spawnFn = deps.spawnFn || spawn
  const findPortFn = deps.findPortFn || findAvailablePortWithReservation
  const sleepFn = deps.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const fsImpl = deps.fsImpl || fs

  let reservationServer = null
  let port = options.port
  const startPort = options.startPort ?? DEFAULT_START_PORT
  const maxPortRetries = options.maxPortRetries ?? DEFAULT_MAX_PORT_RETRIES
  const portProbeTimeoutMs = options.portProbeTimeoutMs ?? DEFAULT_PORT_PROBE_TIMEOUT_MS
  const startupWaitTime = options.startupWaitTime ?? DEFAULT_STARTUP_WAIT_MS
  const forceKillTimeoutMs = options.forceKillTimeoutMs ?? DEFAULT_FORCE_KILL_TIMEOUT_MS
  const envOverrides = options.envOverrides || {}

  if (!port) {
    const reservation = await findPortFn(startPort, maxPortRetries, 0, {
      listenTimeoutMs: portProbeTimeoutMs,
    })

    if (!reservation) {
      throw new Error('[AppLauncher] 无法找到可用端口')
    }
    port = reservation.port
    reservationServer = reservation.reservationServer
  }

  const userDataDir =
    options.userDataDir ||
    (process.env.CHATLAB_E2E_USER_DATA_DIR
      ? path.join(process.env.CHATLAB_E2E_USER_DATA_DIR, `instance-${port}`)
      : path.join(os.tmpdir(), `chatlab-e2e-${port}`))

  if (!fsImpl.existsSync(userDataDir)) {
    fsImpl.mkdirSync(userDataDir, { recursive: true })
  }

  const appPath = path.resolve(__dirname, '../../../apps/desktop')
  if (!fsImpl.existsSync(appPath)) {
    throw new Error(`[AppLauncher] 应用目录不存在: ${appPath}`)
  }

  const electronExe = resolveElectronExecutable(deps)

  if (!electronExe || !fsImpl.existsSync(electronExe)) {
    throw new Error(`Electron 可执行文件不存在: ${electronExe}`)
  }

  console.log(`[AppLauncher] 启动 Electron，CDP 端口: ${port}`)

  const electronArgs = [`--remote-debugging-port=${port}`, appPath]

  let proc
  let launchError = null
  let exitCode = null
  let exitSignal = null

  try {
    proc = spawnFn(electronExe, electronArgs, {
      stdio: 'inherit',
      env: {
        ...process.env,
        TEST_MODE: 'true',
        CHATLAB_E2E_USER_DATA_DIR: userDataDir,
        ELECTRON_ENABLE_LOGGING: '1',
        ...envOverrides,
      },
    })
  } finally {
    releaseReservation(reservationServer)
    reservationServer = null
  }

  if (proc.exitCode !== null && proc.exitCode !== 0) {
    throw new Error(`[AppLauncher] Electron 启动失败，退出码: ${proc.exitCode}`)
  }

  proc.on('error', (error) => {
    launchError = error
    console.error('[AppLauncher] Electron 进程错误:', error.message)
  })

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

  await sleepFn(startupWaitTime)

  if (launchError) {
    await terminateProcess(proc, { forceKillTimeoutMs })
    throw new Error(`[AppLauncher] Electron 启动期间发生错误: ${launchError.message}`)
  }

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

      if (proc.exitCode !== null || proc.signalCode !== null) {
        console.log(`[AppLauncher] 应用已退出 (exit code: ${proc.exitCode}, signal: ${proc.signalCode})`)
        return
      }

      await terminateProcess(proc, { forceKillTimeoutMs })
    },
  }
}

module.exports = {
  launchApp,
  __test__: {
    findAvailablePortWithReservation,
    terminateProcess,
    releaseReservation,
    resolveElectronExecutable,
  },
}
