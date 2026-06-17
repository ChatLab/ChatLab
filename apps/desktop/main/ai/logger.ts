/**
 * AI 日志模块（Electron 初始化入口）
 *
 * 实际实现在 @openchatlab/node-runtime 的 AiLogger 类。
 * 此处用 Electron 的 logsDir 初始化单例实例。
 */

import { AiLogger } from '@openchatlab/node-runtime'
import { getPathProvider } from '../path-context'

export { extractErrorInfo, extractErrorStack } from '@openchatlab/node-runtime'

let _instance: AiLogger | null = null
function getInstance(): AiLogger {
  if (!_instance) _instance = new AiLogger(getPathProvider().getLogsDir())
  return _instance
}

export const aiLogger = {
  debug: (category: string, message: string, data?: unknown) => getInstance().debug(category, message, data),
  info: (category: string, message: string, data?: unknown) => getInstance().info(category, message, data),
  warn: (category: string, message: string, data?: unknown) => getInstance().warn(category, message, data),
  error: (category: string, message: string, data?: unknown) => getInstance().error(category, message, data),
  close: () => getInstance().close(),
  getLogPath: () => getInstance().getLogPath(),
  getExistingLogPath: () => getInstance().getExistingLogPath(),
}

export function setDebugMode(enabled: boolean): void {
  getInstance().setDebugMode(enabled)
}

export function isDebugMode(): boolean {
  return getInstance().isDebugMode()
}

export function logAI(message: string, data?: unknown) {
  aiLogger.info('AI', message, data)
}

export function logLLM(message: string, data?: unknown) {
  aiLogger.info('LLM', message, data)
}

export function logSearch(message: string, data?: unknown) {
  aiLogger.info('Search', message, data)
}
