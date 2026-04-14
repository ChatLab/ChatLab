import { app, session } from 'electron'

export function buildChatLabUserAgentHeaders(): Record<string, string> {
  const chatLabVersion = (() => {
    try {
      return app.getVersion() || 'dev'
    } catch {
      return 'dev'
    }
  })()

  const chatLabTag = `ChatLab/${chatLabVersion}`
  const runtimeUA = (() => {
    try {
      return session.defaultSession.getUserAgent()
    } catch {
      // 默认会话未就绪时使用 Electron 级别回退 UA
      return app.userAgentFallback || ''
    }
  })()
  const userAgent = runtimeUA.includes(chatLabTag) ? runtimeUA : `${runtimeUA} ${chatLabTag}`.trim()

  return {
    // 使用运行时真实 UA，并附加 ChatLab 版本标识，避免网关按 UA 策略拦截。
    'User-Agent': userAgent,
    'X-ChatLab-Client': chatLabTag,
  }
}
