/**
 * 格式模块注册
 * 导出所有支持的格式
 */

import type { FormatModule } from '../types'

// 导入所有格式模块
import chatlab from './chatlab'
import chatlabJsonl from './chatlab-jsonl'
import shuakamiQqExporter from './shuakami-qq-exporter'
import shuakamiQqExporterChunked from './shuakami-qq-exporter-chunked'
import weflow from './weflow'
import yccccccyEchotrace from './ycccccccy-echotrace'
import tyrrrzDiscordExporter from './tyrrrz-discord-exporter'
import telegramNative from './telegram-native'
import telegramNativeSingle from './telegram-native-single'
import whatsappNativeTxt from './whatsapp-native-txt'
import qqNativeTxt from './qq-native-txt'
import instagramNative from './instagram-native'
import lineNativeTxt from './line-native-txt'
import customTxt from './custom-txt'

/**
 * 所有支持的格式模块（按优先级排序）
 * 注意：注册时会自动按 priority 字段排序
 */
export const formats: FormatModule[] = [
  shuakamiQqExporterChunked, // 优先级 5 - shuakami/qq-chat-exporter chunked-jsonl
  shuakamiQqExporter, // 优先级 10 - shuakami/qq-chat-exporter
  weflow, // 优先级 15 - WeFlow 微信导出
  yccccccyEchotrace, // 优先级 16 - ycccccccy/echotrace 微信导出
  tyrrrzDiscordExporter, // 优先级 20 - Tyrrrz/DiscordChatExporter
  telegramNative, // 优先级 22 - Telegram 官方全量导出 JSON
  telegramNativeSingle, // 优先级 23 - Telegram 单聊天导出 JSON
  instagramNative, // 优先级 25 - Instagram 官方导出
  whatsappNativeTxt, // 优先级 26 - WhatsApp 官方导出 TXT
  qqNativeTxt, // 优先级 30 - QQ 官方导出 TXT
  lineNativeTxt, // 优先级 35 - LINE 官方导出 TXT
  customTxt, // 优先级 40 - 自定义 TXT 格式
  chatlab, // 优先级 50 - ChatLab JSON
  chatlabJsonl, // 优先级 51 - ChatLab JSONL（流式格式，支持超大文件）
]

// 按名称导出，方便单独使用
export {
  chatlab,
  chatlabJsonl,
  shuakamiQqExporter,
  shuakamiQqExporterChunked,
  weflow,
  yccccccyEchotrace,
  tyrrrzDiscordExporter,
  telegramNative,
  telegramNativeSingle,
  instagramNative,
  whatsappNativeTxt,
  qqNativeTxt,
  lineNativeTxt,
  customTxt,
}
