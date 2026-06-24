import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Readable } from 'node:stream'
import streamChain from 'stream-chain'
import streamJson from 'stream-json'
import pickModule from 'stream-json/filters/Pick.js'
import streamValuesModule from 'stream-json/streamers/StreamValues.js'
import { ArchiveImportError } from './errors'
import type { ZipArchiveReader } from './archive-reader'
import type { ArchiveEntrySummary, ArchiveResolver, MaterializedImport, PreparedImportChat } from './types'

const { chain } = streamChain
const { parser } = streamJson
const { pick } = pickModule
const { streamValues } = streamValuesModule

const GROUP_FILE = /^Takeout\/Google Chat\/Groups\/((DM|Space) [^/]+)\/(group_info|messages)\.json$/
const USER_INFO_FILE = /^Takeout\/Google Chat\/Users\/[^/]+\/user_info\.json$/
const TAKEOUT_ROOT = /^Takeout\/([^/]+)\//
const MAX_METADATA_BYTES = 5 * 1024 * 1024

interface GoogleChatUser {
  email?: string
  name?: string
}

interface GoogleChatUserInfo {
  user?: GoogleChatUser
}

interface GoogleChatGroupInfo {
  name?: string
  members?: GoogleChatUser[]
}

interface ConversationDraft {
  chatId: string
  kind: 'DM' | 'Space'
  groupInfoEntry?: string
  messagesEntry?: string
  groupInfo?: GoogleChatGroupInfo
  messageCount?: number
}

async function readSmallJson<T>(stream: Readable, maxBytes = MAX_METADATA_BYTES): Promise<T> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) {
      throw new ArchiveImportError('error.archive_limit_exceeded', 'Google Chat metadata exceeds the size limit')
    }
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } catch (error) {
    throw new ArchiveImportError('error.archive_corrupt', 'Invalid Google Chat metadata JSON', { cause: error })
  }
}

async function countMessages(stream: Readable): Promise<number> {
  const pipeline = chain([stream, parser(), pick({ filter: /^messages\.\d+$/ }), streamValues()])
  let count = 0
  try {
    for await (const _item of pipeline as AsyncIterable<unknown>) count++
    return count
  } catch (error) {
    throw new ArchiveImportError('error.archive_corrupt', 'Invalid Google Chat messages JSON', { cause: error })
  }
}

function normalizeEmail(user: GoogleChatUser | undefined): string | null {
  return user?.email?.trim().toLowerCase() || null
}

function deriveConversationName(draft: ConversationDraft, ownerEmail: string | null): string {
  const groupInfo = draft.groupInfo
  if (draft.kind === 'Space' && groupInfo?.name?.trim()) return groupInfo.name.trim()

  const members = groupInfo?.members ?? []
  const other = members.find((member) => {
    const email = normalizeEmail(member)
    return !ownerEmail || email !== ownerEmail
  })
  return other?.name?.trim() || other?.email?.trim() || members[0]?.name?.trim() || draft.chatId
}

export class GoogleChatTakeoutResolver implements ArchiveResolver {
  readonly id = 'google-chat-takeout'
  readonly platform = 'google-chat'

  detect(entries: ArchiveEntrySummary[]): boolean {
    const products = new Set<string>()
    const groupFiles = new Map<string, Set<string>>()

    for (const entry of entries) {
      const product = entry.name.match(TAKEOUT_ROOT)?.[1]
      if (product) products.add(product)

      const match = entry.name.match(GROUP_FILE)
      if (!match) continue
      const files = groupFiles.get(match[1]) ?? new Set<string>()
      files.add(match[3])
      groupFiles.set(match[1], files)
    }

    return (
      products.size === 1 &&
      products.has('Google Chat') &&
      Array.from(groupFiles.values()).some((files) => files.has('group_info') && files.has('messages'))
    )
  }

  /**
   * 扫描时按 ZIP 顺序消费必要 JSON。会话元数据和消息计数先暂存，
   * 等 owner 信息齐备后统一生成名称，避免依赖归档内部文件顺序。
   */
  async scan(reader: ZipArchiveReader): Promise<PreparedImportChat[]> {
    let ownerEmail: string | null = null
    const drafts = new Map<string, ConversationDraft>()

    await reader.visitEntries(async (entry, openStream) => {
      if (USER_INFO_FILE.test(entry.name)) {
        const ownerInfo = await readSmallJson<GoogleChatUserInfo>(await openStream())
        ownerEmail = normalizeEmail(ownerInfo.user)
        return
      }

      const match = entry.name.match(GROUP_FILE)
      if (!match) return
      const chatId = `Groups/${match[1]}`
      const draft =
        drafts.get(chatId) ??
        ({
          chatId,
          kind: match[2] as 'DM' | 'Space',
        } satisfies ConversationDraft)

      if (match[3] === 'group_info') {
        draft.groupInfoEntry = entry.name
        draft.groupInfo = await readSmallJson<GoogleChatGroupInfo>(await openStream())
      } else {
        draft.messagesEntry = entry.name
        draft.messageCount = await countMessages(await openStream())
      }
      drafts.set(chatId, draft)
    })

    if (drafts.size === 0) {
      throw new ArchiveImportError(
        'error.google_chat_structure_not_found',
        'Google Chat conversation structure was not found'
      )
    }

    return Array.from(drafts.values())
      .map((draft) => {
        if (!draft.groupInfoEntry || !draft.messagesEntry || !draft.groupInfo || draft.messageCount === undefined) {
          throw new ArchiveImportError(
            'error.google_chat_conversation_incomplete',
            `Google Chat conversation is missing required files: ${draft.chatId}`
          )
        }
        return {
          chatId: draft.chatId,
          name: deriveConversationName(draft, ownerEmail),
          type: draft.kind === 'Space' ? 'group' : 'private',
          messageCount: draft.messageCount,
          memberCount: draft.groupInfo.members?.length ?? 0,
        } satisfies PreparedImportChat
      })
      .sort((a, b) => a.chatId.localeCompare(b.chatId))
  }

  async materialize(
    reader: ZipArchiveReader,
    chat: PreparedImportChat,
    targetDir: string
  ): Promise<MaterializedImport> {
    const entries = await reader.listEntries()
    const groupPrefix = `Takeout/Google Chat/${chat.chatId}/`
    const userInfoEntry = entries.find((entry) => USER_INFO_FILE.test(entry.name))?.name
    const groupInfoEntry = `${groupPrefix}group_info.json`
    const messagesEntry = `${groupPrefix}messages.json`
    if (
      !userInfoEntry ||
      !entries.some((entry) => entry.name === groupInfoEntry) ||
      !entries.some((entry) => entry.name === messagesEntry)
    ) {
      throw new ArchiveImportError(
        'error.google_chat_conversation_incomplete',
        `Google Chat conversation is missing required files: ${chat.chatId}`
      )
    }

    fs.mkdirSync(targetDir, { recursive: true })
    await reader.pipeEntries(
      new Map([
        [userInfoEntry, path.join(targetDir, 'user_info.json')],
        [groupInfoEntry, path.join(targetDir, 'group_info.json')],
        [messagesEntry, path.join(targetDir, 'messages.json')],
      ])
    )

    const manifestPath = path.join(targetDir, 'google-chat-import.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          format: 'chatlab-google-chat-takeout',
          version: 1,
          chatId: chat.chatId,
          chatType: chat.type,
          chatName: chat.name,
          userInfoFile: 'user_info.json',
          groupInfoFile: 'group_info.json',
          messagesFile: 'messages.json',
        },
        null,
        2
      ),
      { encoding: 'utf8', flag: 'wx' }
    )
    return { manifestPath }
  }
}
