/**
 * Tyrrrz/DiscordChatExporter 格式解析器
 * 支持 https://github.com/Tyrrrz/DiscordChatExporter 导出的 Discord 聊天记录
 *
 * 特征：
 * - 文件头包含 "guild" 和 "channel" 字段
 * - 消息结构包含 author.roles 数组
 * - 支持附件、嵌入、贴纸等 Discord 特有内容
 */

import * as fs from 'fs'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamValues } from 'stream-json/streamers/StreamValues'
import { chain } from 'stream-chain'
import { KNOWN_PLATFORMS, ChatType, MessageType, type MemberRole } from '../../../../src/types/base'
import type {
  FormatFeature,
  FormatModule,
  Parser,
  ParseOptions,
  ParseEvent,
  ParsedMeta,
  ParsedMember,
  ParsedMessage,
} from '../types'
import { getFileSize, createProgress, readFileHeadBytes } from '../utils'

// ==================== Discord 数据结构定义 ====================

interface DiscordGuild {
  id: string
  name: string
  iconUrl?: string
}

interface DiscordChannel {
  id: string
  type: string
  categoryId?: string
  category?: string
  name: string
  topic?: string
}

interface DiscordRole {
  id: string
  name: string
  color?: string
  position?: number
}

interface DiscordAuthor {
  id: string
  name: string
  discriminator: string
  nickname?: string
  color?: string
  isBot: boolean
  roles: DiscordRole[]
  avatarUrl?: string
}

interface DiscordAttachment {
  id: string
  url: string
  fileName: string
  fileSizeBytes?: number
}

interface DiscordEmbed {
  title?: string
  url?: string
  description?: string
  thumbnail?: { url: string }
}

interface DiscordSticker {
  id: string
  name: string
  format: string
  sourceUrl?: string
}

interface DiscordMessage {
  id: string
  type: string
  timestamp: string
  timestampEdited?: string | null
  callEndedTimestamp?: string | null
  isPinned: boolean
  content: string
  author: DiscordAuthor
  attachments: DiscordAttachment[]
  embeds: DiscordEmbed[]
  stickers: DiscordSticker[]
  reference?: {
    messageId?: string
    channelId?: string
    guildId?: string | null
  }
}

// ==================== 消息类型映射 ====================

/**
 * Discord 消息类型到 ChatLab 消息类型的映射
 */
function mapDiscordMessageType(type: string): MessageType {
  switch (type) {
    // 内容消息
    case 'Default':
    case 'ThreadStarterMessage':
      return MessageType.TEXT
    case 'Reply':
      return MessageType.REPLY
    // 通话相关
    case 'Call':
      return MessageType.CALL
    // 系统消息
    case 'RecipientAdd':
    case 'RecipientRemove':
    case 'ChannelNameChange':
    case 'ChannelIconChange':
    case 'ChannelPinnedMessage':
    case 'UserJoin':
    case 'GuildBoost':
    case 'GuildBoostTier1':
    case 'GuildBoostTier2':
    case 'GuildBoostTier3':
    case 'ChannelFollowAdd':
    case 'ThreadCreated':
    case 'ChatInputCommand':
    case 'ContextMenuCommand':
    case 'AutoModerationAction':
    case 'StageStart':
    case 'StageEnd':
    case 'StageSpeaker':
    case 'StageTopic':
    case 'GuildDiscoveryDisqualified':
    case 'GuildDiscoveryRequalified':
    case 'GuildDiscoveryGracePeriodInitialWarning':
    case 'GuildDiscoveryGracePeriodFinalWarning':
    case 'GuildInviteReminder':
    case 'RoleSubscriptionPurchase':
    case 'InteractionPremiumUpsell':
    case 'GuildApplicationPremiumSubscription':
      return MessageType.SYSTEM
    default:
      return MessageType.OTHER
  }
}

/**
 * 根据附件判断消息类型
 */
function getMessageTypeFromAttachment(attachment: DiscordAttachment): MessageType {
  const fileName = attachment.fileName.toLowerCase()

  // 图片
  if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(fileName)) {
    return MessageType.IMAGE
  }
  // 视频
  if (/\.(mp4|webm|mov|avi|mkv)$/i.test(fileName)) {
    return MessageType.VIDEO
  }
  // 音频
  if (/\.(mp3|wav|ogg|flac|m4a)$/i.test(fileName)) {
    return MessageType.VOICE
  }
  // 其他文件
  return MessageType.FILE
}

// ==================== 附件文本生成 ====================

/**
 * 附件标记生成器
 * 使用英文标记，前端可根据需要翻译
 * 格式: [Type: filename] 或 [Type: description]
 */
const AttachmentMarkers = {
  image: (fileName: string) => `[Image: ${fileName}]`,
  video: (fileName: string) => `[Video: ${fileName}]`,
  audio: (fileName: string) => `[Audio: ${fileName}]`,
  file: (fileName: string) => `[File: ${fileName}]`,
  sticker: (name: string) => `[Sticker: ${name}]`,
  embed: (title: string) => `[Link: ${title}]`,
}

/**
 * 生成附件文本标记
 */
function formatAttachment(attachment: DiscordAttachment): string {
  const fileName = attachment.fileName.toLowerCase()

  if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(fileName)) {
    return AttachmentMarkers.image(attachment.fileName)
  }
  if (/\.(mp4|webm|mov|avi|mkv)$/i.test(fileName)) {
    return AttachmentMarkers.video(attachment.fileName)
  }
  if (/\.(mp3|wav|ogg|flac|m4a)$/i.test(fileName)) {
    return AttachmentMarkers.audio(attachment.fileName)
  }
  return AttachmentMarkers.file(attachment.fileName)
}

/**
 * 生成嵌入文本标记
 */
function formatEmbed(embed: DiscordEmbed): string {
  const title = embed.title || embed.url || embed.description?.slice(0, 30) || 'link'
  return AttachmentMarkers.embed(title)
}

/**
 * 生成贴纸文本标记
 */
function formatSticker(sticker: DiscordSticker): string {
  return AttachmentMarkers.sticker(sticker.name)
}

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'tyrrrz-discord-exporter',
  name: 'Tyrrrz/DiscordChatExporter',
  platform: KNOWN_PLATFORMS.DISCORD,
  priority: 20, // Discord 格式优先级
  extensions: ['.json'],
  signatures: {
    head: [/"guild"\s*:\s*\{/, /"channel"\s*:\s*\{/],
    requiredFields: ['guild', 'channel', 'messages'],
  },
}

// ==================== 辅助函数 ====================

/**
 * 解析 ISO 8601 时间戳为秒级 Unix 时间戳
 */
function parseTimestamp(isoString: string): number {
  const date = new Date(isoString)
  return Math.floor(date.getTime() / 1000)
}

/**
 * 转换 Discord 角色为 ChatLab MemberRole
 */
function convertRoles(discordRoles: DiscordRole[]): MemberRole[] {
  return discordRoles.map((role) => ({
    id: role.id,
    name: role.name,
  }))
}

// ==================== 解析器实现 ====================

async function* parseDiscordExporter(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  const totalBytes = getFileSize(filePath)
  let bytesRead = 0
  let messagesProcessed = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  onLog?.('info', `开始解析 Discord 导出文件，大小: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)

  // 读取文件头获取 guild 和 channel 信息
  const headContent = readFileHeadBytes(filePath, 10000)

  // 解析 guild 和 channel
  let guild: DiscordGuild | null = null
  let channel: DiscordChannel | null = null

  try {
    const guildMatch = headContent.match(/"guild"\s*:\s*(\{[^}]+\})/)
    if (guildMatch) {
      guild = JSON.parse(guildMatch[1])
    }

    const channelMatch = headContent.match(/"channel"\s*:\s*(\{[^}]+\})/)
    if (channelMatch) {
      channel = JSON.parse(channelMatch[1])
    }
  } catch (e) {
    onLog?.('error', `解析头部信息失败: ${e}`)
  }

  // 构建 meta
  const chatName = guild && channel ? `${guild.name} - ${channel.name}` : channel?.name || '未知频道'

  const meta: ParsedMeta = {
    name: chatName,
    platform: KNOWN_PLATFORMS.DISCORD,
    type: ChatType.GROUP, // Discord 频道都是群聊
    groupId: channel?.id,
    groupAvatar: guild?.iconUrl,
  }

  yield { type: 'meta', data: meta }
  onLog?.('info', `群聊名称: ${chatName}`)

  // 收集成员和消息
  const memberMap = new Map<string, ParsedMember>()
  const messageBatch: ParsedMessage[] = []

  // 流式解析消息
  await new Promise<void>((resolve, reject) => {
    const readStream = fs.createReadStream(filePath, { encoding: 'utf-8' })

    readStream.on('data', (chunk: string | Buffer) => {
      bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    })

    const pipeline = chain([readStream, parser(), pick({ filter: /^messages\.\d+$/ }), streamValues()])

    // 用于收集批次的临时数组
    const batchCollector: ParsedMessage[] = []

    pipeline.on('data', ({ value }: { value: DiscordMessage }) => {
      const msg = value
      const author = msg.author

      // 收集成员信息（包括角色）
      if (!memberMap.has(author.id)) {
        memberMap.set(author.id, {
          platformId: author.id,
          accountName: author.name,
          groupNickname: author.nickname || undefined,
          avatar: author.avatarUrl,
          roles: convertRoles(author.roles),
        })
      } else {
        // 更新角色（用户可能在不同消息中有不同角色）
        const existingMember = memberMap.get(author.id)!
        if (author.roles.length > (existingMember.roles?.length || 0)) {
          existingMember.roles = convertRoles(author.roles)
        }
      }

      // 确定消息类型
      let messageType = mapDiscordMessageType(msg.type)
      let content = msg.content || ''

      // 处理附件
      if (msg.attachments && msg.attachments.length > 0) {
        // 如果是纯附件消息，根据附件类型确定消息类型
        if (!content && msg.attachments.length === 1) {
          messageType = getMessageTypeFromAttachment(msg.attachments[0])
        }
        // 添加附件标记到内容
        const attachmentTexts = msg.attachments.map(formatAttachment)
        content = content ? `${content}\n${attachmentTexts.join('\n')}` : attachmentTexts.join('\n')
      }

      // 处理嵌入
      if (msg.embeds && msg.embeds.length > 0) {
        const embedTexts = msg.embeds.map(formatEmbed)
        content = content ? `${content}\n${embedTexts.join('\n')}` : embedTexts.join('\n')
        // 如果纯嵌入消息，标记为链接类型
        if (!msg.content && !msg.attachments?.length && msg.embeds.length > 0) {
          messageType = MessageType.LINK
        }
      }

      // 处理贴纸
      if (msg.stickers && msg.stickers.length > 0) {
        const stickerTexts = msg.stickers.map(formatSticker)
        content = content ? `${content}\n${stickerTexts.join('\n')}` : stickerTexts.join('\n')
        // 纯贴纸消息
        if (!msg.content && !msg.attachments?.length && !msg.embeds?.length) {
          messageType = MessageType.EMOJI
        }
      }

      batchCollector.push({
        platformMessageId: msg.id, // 消息的平台原始 ID
        senderPlatformId: author.id,
        senderAccountName: author.name,
        senderGroupNickname: author.nickname || undefined,
        timestamp: parseTimestamp(msg.timestamp),
        type: messageType,
        content: content || null,
        replyToMessageId: msg.reference?.messageId || undefined,
      })

      messagesProcessed++

      // 达到批次大小
      if (batchCollector.length >= batchSize) {
        messageBatch.push(...batchCollector)
        batchCollector.length = 0

        const progress = createProgress(
          'parsing',
          bytesRead,
          totalBytes,
          messagesProcessed,
          `已处理 ${messagesProcessed} 条消息...`
        )
        onProgress?.(progress)
      }
    })

    pipeline.on('end', () => {
      // 收集剩余消息
      if (batchCollector.length > 0) {
        messageBatch.push(...batchCollector)
      }
      resolve()
    })

    pipeline.on('error', reject)
  })

  // 发送成员
  const members = Array.from(memberMap.values())
  yield { type: 'members', data: members }
  onLog?.('info', `解析到 ${members.length} 个成员`)

  // 分批发送消息
  for (let i = 0; i < messageBatch.length; i += batchSize) {
    const batch = messageBatch.slice(i, i + batchSize)
    yield { type: 'messages', data: batch }
  }

  // 完成
  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)

  onLog?.('info', `解析完成: ${messagesProcessed} 条消息, ${members.length} 个成员`)

  yield {
    type: 'done',
    data: {
      messageCount: messagesProcessed,
      memberCount: members.length,
    },
  }
}

// ==================== 导出解析器 ====================

export const parser_: Parser = {
  feature,
  parse: parseDiscordExporter,
}

// ==================== 导出格式模块 ====================

const module_: FormatModule = {
  feature,
  parser: parser_,
}

export default module_
