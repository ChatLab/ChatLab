/**
 * ycccccccy/echotrace 导出格式解析器
 * 适配项目: https://github.com/ycccccccy/echotrace
 *
 * 特征：
 * - 顶层包含 session 和 messages 字段（无 weflow 对象）
 * - session.wxid: ID（群聊以 @chatroom 结尾）
 * - session.type: "群聊" 或 "私聊"
 * - messages[].senderUsername: 发送者ID
 * - messages[].senderDisplayName: 发送者显示名
 *
 * 注意：此格式与 WeFlow 格式共享解析逻辑，区别在于签名检测
 */

import { KNOWN_PLATFORMS } from '../../../../src/types/base'
import type { FormatFeature, FormatModule, Parser } from '../types'
import { parseWeFlow } from './weflow'
import { weflowPreprocessor } from './weflow-preprocessor'

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'ycccccccy-echotrace',
  name: 'ycccccccy/echotrace 导出',
  platform: KNOWN_PLATFORMS.WECHAT,
  priority: 16, // 比 WeFlow (15) 略低，优先检测 WeFlow
  extensions: ['.json'],
  signatures: {
    // echotrace 格式没有 weflow 对象，但有 session 和 senderUsername/senderDisplayName
    head: [/"session"\s*:/, /"senderUsername"\s*:/, /"senderDisplayName"\s*:/],
    requiredFields: ['session', 'messages'],
  },
}

// ==================== 导出解析器 ====================

// 复用 WeFlow 的解析逻辑（两种格式的数据结构相同）
export const parser_: Parser = {
  feature,
  parse: parseWeFlow,
}

// ==================== 预处理器（复用 WeFlow） ====================

export const preprocessor = weflowPreprocessor

// ==================== 导出格式模块 ====================

const module_: FormatModule = {
  feature,
  parser: parser_,
  preprocessor: weflowPreprocessor,
}

export default module_
