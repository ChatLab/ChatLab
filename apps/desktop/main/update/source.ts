import { autoUpdater } from 'electron-updater'
import { logger } from '../logger'
import { getActiveProxyUrl } from '../network/proxy'

const R2_MIRROR_URL = 'https://chatlab.1app.top/releases/download'

type UpdateSource = 'github' | 'r2'

let currentSource: UpdateSource = 'r2'
let hasTriedFallback = false

export function configureUpdateProxy(): void {
  const proxyUrl = getActiveProxyUrl()

  if (proxyUrl) {
    process.env.HTTPS_PROXY = proxyUrl
    process.env.HTTP_PROXY = proxyUrl
    logger.info('[Update] Proxy configured')
  } else {
    delete process.env.HTTPS_PROXY
    delete process.env.HTTP_PROXY
  }
}

export function resetToDefaultSource(): void {
  hasTriedFallback = false
  switchToR2Mirror()
}

export function handleUpdateError(error: Error): void {
  logger.error(`[Update] Update error (${currentSource}): ${error.message || error}`)

  if (currentSource !== 'r2' || hasTriedFallback || !isNetworkError(error)) return

  hasTriedFallback = true
  logger.info('[Update] R2 mirror failed, trying GitHub fallback...')
  switchToGitHub()

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((retryError) => {
      logger.error(`[Update] GitHub fallback check also failed: ${retryError}`)
    })
  }, 1000)
}

function switchToR2Mirror(): void {
  currentSource = 'r2'
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: R2_MIRROR_URL,
  })
}

function switchToGitHub(): void {
  currentSource = 'github'
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'ChatLab',
    repo: 'ChatLab',
  })
  logger.info('[Update] Switched to GitHub fallback source')
}

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
