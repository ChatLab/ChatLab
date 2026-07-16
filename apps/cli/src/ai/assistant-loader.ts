/**
 * 助手配置加载器
 *
 * 通过共享 AssistantManager 加载配置，确保 standalone CLI 在首次使用时
 * 也会创建默认助手，而不是绕过初始化直接读取磁盘。
 */

import type { AssistantConfig } from '@openchatlab/node-runtime'
import { getAssistantManager } from './manager-factory'

export function loadAssistantConfig(aiDataDir: string, assistantId: string): AssistantConfig | null {
  return getAssistantManager(aiDataDir).getAssistantConfig(assistantId)
}
