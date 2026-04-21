import { dialog, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { platform } from '@electron-toolkit/utils'
import { logger } from './logger'
import { getActiveProxyUrl } from './network/proxy'
import { closeWorkerAsync } from './worker/workerManager'
import { t } from './i18n'

type AppWithQuitFlag = typeof app & { isQuiting?: boolean }
// 更新安装流程会主动触发退出，这里使用类型扩展存储退出标记。
const appWithQuitFlag = app as AppWithQuitFlag

// R2 镜像源 URL（速度更快，作为主要更新源）
const R2_MIRROR_URL = 'https://chatlab.1app.top/releases/download'

// 更新源类型
type UpdateSource = 'github' | 'r2'

// 当前使用的更新源（默认 R2 优先，GitHub 作为网络失败兜底）
let currentSource: UpdateSource = 'r2'

// 是否已尝试过备用源
let hasTriedFallback = false

/**
 * 配置自动更新的代理设置
 * electron-updater 通过环境变量读取代理配置
 */
function configureUpdateProxy(): void {
  const proxyUrl = getActiveProxyUrl()

  if (proxyUrl) {
    // 设置环境变量，electron-updater 会自动读取
    process.env.HTTPS_PROXY = proxyUrl
    process.env.HTTP_PROXY = proxyUrl
    logger.info(`[Update] Using proxy: ${proxyUrl}`)
  } else {
    // 清除代理环境变量
    delete process.env.HTTPS_PROXY
    delete process.env.HTTP_PROXY
  }
}

/**
 * 切换到 R2 镜像源
 */
function switchToR2Mirror(): void {
  currentSource = 'r2'
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: R2_MIRROR_URL,
  })
}

/**
 * 切换到 GitHub 源（备用更新源）
 */
function switchToGitHub(): void {
  currentSource = 'github'
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'hellodigua',
    repo: 'ChatLab',
  })
  logger.info('[Update] Switched to GitHub fallback source')
}

/**
 * 重置为默认更新源（R2 优先）
 */
function resetToDefaultSource(): void {
  hasTriedFallback = false
  switchToR2Mirror()
}

/**
 * 判断错误是否为网络相关错误
 */
function isNetworkError(error: Error): boolean {
  const networkErrorKeywords = [
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
    'ECONNRESET',
    'ENETUNREACH',
    'EAI_AGAIN',
    'socket hang up',
    'network',
    'connect',
    'timeout',
    'getaddrinfo',
  ]
  const errorMessage = error.message?.toLowerCase() || ''
  const errorCode = (error as NodeJS.ErrnoException).code?.toLowerCase() || ''

  return networkErrorKeywords.some(
    (keyword) => errorMessage.includes(keyword.toLowerCase()) || errorCode.includes(keyword.toLowerCase())
  )
}

/**
 * 判断版本号是否为预发布版本
 * 预发布版本格式：0.3.0-beta.1, 0.4.2-alpha.23, 1.0.0-rc.1 等
 * 标准版本格式：0.3.0, 1.0.0, 2.1.3 等
 */
function isPreReleaseVersion(version: string): boolean {
  // 预发布版本包含连字符后跟预发布标识（alpha, beta, rc, dev, canary 等）
  return /-/.test(version)
}

let isFirstShow = true
// 标记是否为手动检查更新（手动检查时即使是预发布版本也显示弹窗）
let isManualCheck = false
const checkUpdate = (win) => {
  // 配置代理
  configureUpdateProxy()

  autoUpdater.autoDownload = false // 自动下载
  autoUpdater.autoInstallOnAppQuit = false // 关闭退出自动安装，必须显式确认安装

  // 开发模式下模拟更新检测（需要创建 dev-app-update.yml 文件）
  // 取消下面的注释来启用开发模式更新测试
  // if (!app.isPackaged) {
  //   Object.defineProperty(app, 'isPackaged', {
  //     get() {
  //       return true
  //     },
  //   })
  // }

  let showUpdateMessageBox = false
  autoUpdater.on('update-available', (info) => {
    // win.webContents.send('show-message', 'electron:发现新版本')
    if (showUpdateMessageBox) return

    // 检查是否为预发布版本
    const isPreRelease = isPreReleaseVersion(info.version)

    // 预发布版本仅在手动检查时显示更新弹窗
    if (isPreRelease && !isManualCheck) {
      console.log(`[Update] Pre-release version found: ${info.version}, skipping auto-update prompt`)
      logger.info(
        `[Update] Pre-release version found: ${info.version}, skipping auto-update prompt (manual check required)`
      )
      return
    }

    showUpdateMessageBox = true

    dialog
      .showMessageBox({
        title: t('update.newVersionTitle', { version: info.version }),
        message: t('update.newVersionMessage', { version: info.version }),
        detail: t('update.newVersionDetail'),
        buttons: [t('update.downloadNow'), t('update.cancel')],
        defaultId: 0,
        cancelId: 1,
        type: 'question',
        noLink: true,
      })
      .then((result) => {
        showUpdateMessageBox = false
        if (result.response === 0) {
          autoUpdater
            .downloadUpdate()
            .then(() => {
              console.log('wait for post download operation')
            })
            .catch((downloadError) => {
              // 下载失败记录到日志，不显示给用户
              logger.error(`[Update] Download update failed: ${downloadError}`)
            })
        }
      })
  })

  // 监听下载进度事件
  autoUpdater.on('download-progress', (progressObj) => {
    console.log(`Update download progress: ${progressObj.percent}%`)
    win.webContents.send('update-download-progress', progressObj.percent)
  })

  // 下载完成
  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox({
        title: t('update.downloadComplete'),
        message: t('update.readyToInstall'),
        buttons: [t('update.install'), t('update.remindLater')],
        defaultId: 1,
        cancelId: 1,
        type: 'question',
      })
      .then(async (result) => {
        if (result.response === 0) {
          win.webContents.send('begin-install')
          appWithQuitFlag.isQuiting = true

          // Windows 上先关闭 Worker 线程，确保进程能正常退出
          // 否则 NSIS 安装器可能无法关闭旧进程
          if (platform.isWindows) {
            logger.info('[Update] Windows: Closing worker before installing...')
            try {
              await closeWorkerAsync()
            } catch (error) {
              logger.error(`[Update] Failed to close worker: ${error}`)
            }
          }

          setTimeout(() => {
            setImmediate(() => {
              autoUpdater.quitAndInstall(true, true)
            })
          }, 100)
        }
      })
  })

  // 不需要更新
  autoUpdater.on('update-not-available', (_info) => {
    // 客户端打开会默认弹一次，用isFirstShow来控制不弹
    if (isFirstShow) {
      isFirstShow = false
    } else {
      win.webContents.send('show-message', {
        type: 'success',
        message: t('update.upToDate'),
      })
    }
  })

  // 错误处理（网络失败时切换备用源）
  autoUpdater.on('error', (err) => {
    logger.error(`[Update] Update error (${currentSource}): ${err.message || err}`)

    // 默认 R2 源网络失败时，尝试切换到 GitHub
    if (currentSource === 'r2' && !hasTriedFallback && isNetworkError(err)) {
      hasTriedFallback = true
      logger.info('[Update] R2 mirror failed, trying GitHub fallback...')

      switchToGitHub()

      // 延迟 1 秒后重试检查更新
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((retryErr) => {
          logger.error(`[Update] GitHub fallback check also failed: ${retryErr}`)
        })
      }, 1000)
    }
  })

  // 等待 3 秒再检查更新，确保窗口准备完成，用户进入系统
  setTimeout(() => {
    isManualCheck = false // 自动检查
    resetToDefaultSource() // 重置为默认更新源（R2 优先）

    autoUpdater.checkForUpdates().catch((err) => {
      console.log('[Update] Update check failed:', err)
    })
  }, 3000)
}

/**
 * 手动检查更新
 * 手动检查时，即使是预发布版本也会显示更新弹窗
 */
const manualCheckForUpdates = () => {
  // 配置代理
  configureUpdateProxy()

  isManualCheck = true // 手动检查
  isFirstShow = false // 手动检查时，无论结果都显示提示
  resetToDefaultSource() // 重置为默认更新源（R2 优先）

  autoUpdater.checkForUpdates().catch((err) => {
    console.log('[Update] Manual update check failed:', err)
    logger.error(`[Update] Manual update check failed: ${err}`)
  })
}

/**
 * 模拟更新弹窗（仅用于开发测试）
 * 控制台通过：window.api.app.simulateUpdate() 测试
 */
const simulateUpdateDialog = (_win) => {
  dialog.showMessageBox({
    title: t('update.newVersionTitle', { version: '9.9.9' }),
    message: t('update.newVersionMessage', { version: '9.9.9' }),
    detail: t('update.newVersionDetail'),
    buttons: [t('update.downloadNow'), t('update.cancel')],
    defaultId: 0,
    cancelId: 1,
    type: 'question',
    noLink: true,
  })
}

export { checkUpdate, simulateUpdateDialog, manualCheckForUpdates }
