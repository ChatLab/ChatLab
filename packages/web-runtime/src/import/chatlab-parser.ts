import { WebRuntimeError } from '../runtime-error'

export type ChatLabBrowserFormatId = 'chatlab' | 'chatlab-jsonl'

export interface BrowserParseSource {
  name: string
  size: number
  type?: string
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
  slice(start?: number, end?: number): Blob
}

export interface BrowserParsedMeta {
  name: string
  platform: string
  type: string
  groupId?: string
  groupAvatar?: string
  ownerId?: string
  sourceSessionId?: string
}

export interface BrowserParsedMember {
  platformId: string
  accountName: string
  groupNickname?: string
  aliases?: string[]
  avatar?: string
  roles?: Array<{ id: string; name?: string }>
}

export interface BrowserParsedMessage {
  senderPlatformId: string
  senderAccountName: string
  senderGroupNickname?: string
  timestamp: number
  type: number
  content: string | null
  platformMessageId?: string
  replyToMessageId?: string
}

export interface BrowserChatParseResult {
  formatId: ChatLabBrowserFormatId
  meta: BrowserParsedMeta
  members: BrowserParsedMember[]
  messages: BrowserParsedMessage[]
}

export interface BrowserChatParseProgress {
  stage: 'parsing'
  progress: number
  messagesProcessed: number
}

export interface ParseChatLabSourceOptions {
  formatId?: ChatLabBrowserFormatId
  checkCancelled?: () => void
  onProgress?: (progress: BrowserChatParseProgress) => void
  yieldEvery?: number
}

const HEAD_BYTES = 64 * 1024

export async function detectChatLabFormat(source: BrowserParseSource): Promise<ChatLabBrowserFormatId | null> {
  const head = await source.slice(0, HEAD_BYTES).text()
  const firstLine = firstMeaningfulLine(head)

  if (firstLine) {
    try {
      const firstValue = JSON.parse(firstLine) as unknown
      if (isRecord(firstValue) && firstValue._type === 'header' && isRecord(firstValue.chatlab)) {
        return 'chatlab-jsonl'
      }
    } catch {
      // A regular JSON document is expected to be incomplete in a bounded head read.
    }
  }

  if (/"chatlab"\s*:\s*\{/.test(head) && source.name.toLowerCase().endsWith('.json')) return 'chatlab'
  return null
}

export async function parseChatLabSource(
  source: BrowserParseSource,
  options: ParseChatLabSourceOptions = {}
): Promise<BrowserChatParseResult> {
  const formatId = options.formatId ?? (await detectChatLabFormat(source))
  if (!formatId) {
    throw new WebRuntimeError('UNSUPPORTED_IMPORT_FORMAT', 'Unsupported file format; expected ChatLab JSON or JSONL')
  }

  options.checkCancelled?.()
  const content = await source.text()
  options.checkCancelled?.()

  return formatId === 'chatlab-jsonl' ? parseJsonl(content, options) : parseJson(content, options)
}

async function parseJson(content: string, options: ParseChatLabSourceOptions): Promise<BrowserChatParseResult> {
  let root: unknown
  try {
    root = JSON.parse(content)
  } catch (error) {
    throw new WebRuntimeError('INVALID_IMPORT_FILE', 'ChatLab JSON is not valid JSON', { cause: error })
  }
  if (!isRecord(root) || !isRecord(root.chatlab)) {
    throw new WebRuntimeError('INVALID_IMPORT_FILE', 'ChatLab JSON must contain a chatlab object')
  }

  const meta = parseMeta(root.meta, 'meta')
  const explicitMembers = parseMemberArray(root.members, 'members')
  if (!Array.isArray(root.messages)) {
    throw new WebRuntimeError('INVALID_IMPORT_FILE', 'ChatLab JSON messages must be an array')
  }

  const messages: BrowserParsedMessage[] = []
  for (let index = 0; index < root.messages.length; index += 1) {
    await cooperate(index, options)
    messages.push(parseMessage(root.messages[index], `messages[${index}]`))
    options.onProgress?.({
      stage: 'parsing',
      progress: root.messages.length === 0 ? 1 : (index + 1) / root.messages.length,
      messagesProcessed: index + 1,
    })
  }

  options.checkCancelled?.()
  return {
    formatId: 'chatlab',
    meta,
    members: mergeInferredMembers(explicitMembers, messages),
    messages,
  }
}

async function parseJsonl(content: string, options: ParseChatLabSourceOptions): Promise<BrowserChatParseResult> {
  const members: BrowserParsedMember[] = []
  const messages: BrowserParsedMessage[] = []
  let meta: BrowserParsedMeta | undefined
  let firstRecordSeen = false
  let cursor = 0
  let lineNumber = 0

  while (cursor <= content.length) {
    const nextBreak = content.indexOf('\n', cursor)
    const end = nextBreak === -1 ? content.length : nextBreak
    const line = content.slice(cursor, end).replace(/\r$/, '').trim()
    lineNumber += 1
    cursor = nextBreak === -1 ? content.length + 1 : nextBreak + 1
    if (!line || line.startsWith('#')) continue

    await cooperate(lineNumber, options)
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch (error) {
      throw new WebRuntimeError('INVALID_IMPORT_FILE', `ChatLab JSONL contains invalid JSON at line ${lineNumber}`, {
        cause: error,
      })
    }
    if (!isRecord(value)) {
      throw new WebRuntimeError('INVALID_IMPORT_FILE', `ChatLab JSONL line ${lineNumber} must be an object`)
    }

    if (!firstRecordSeen) {
      firstRecordSeen = true
      if (value._type !== 'header' || !isRecord(value.chatlab)) {
        throw new WebRuntimeError('INVALID_IMPORT_FILE', 'The first ChatLab JSONL record must be a header')
      }
    }

    switch (value._type) {
      case 'header':
        if (meta)
          throw new WebRuntimeError('INVALID_IMPORT_FILE', `Duplicate ChatLab JSONL header at line ${lineNumber}`)
        meta = parseMeta(value.meta, `line ${lineNumber} meta`)
        break
      case 'member':
        members.push(parseMember(value, `line ${lineNumber}`))
        break
      case 'message':
        messages.push(parseMessage(value, `line ${lineNumber}`))
        options.onProgress?.({
          stage: 'parsing',
          progress: content.length === 0 ? 1 : Math.min(1, cursor / content.length),
          messagesProcessed: messages.length,
        })
        break
      default:
        throw new WebRuntimeError('INVALID_IMPORT_FILE', `Unknown ChatLab JSONL record type at line ${lineNumber}`)
    }
  }

  if (!meta) throw new WebRuntimeError('INVALID_IMPORT_FILE', 'ChatLab JSONL header is missing')
  options.checkCancelled?.()
  options.onProgress?.({ stage: 'parsing', progress: 1, messagesProcessed: messages.length })
  return {
    formatId: 'chatlab-jsonl',
    meta,
    members: mergeInferredMembers(members, messages),
    messages,
  }
}

function parseMeta(value: unknown, path: string): BrowserParsedMeta {
  if (!isRecord(value)) throw invalidField(path, 'must be an object')
  return omitUndefined({
    name: requiredString(value.name, `${path}.name`),
    platform: requiredString(value.platform, `${path}.platform`),
    type: requiredString(value.type, `${path}.type`),
    groupId: optionalString(value.groupId, `${path}.groupId`),
    groupAvatar: optionalString(value.groupAvatar, `${path}.groupAvatar`),
    ownerId: optionalString(value.ownerId, `${path}.ownerId`),
    sourceSessionId: optionalString(value.sourceSessionId, `${path}.sourceSessionId`),
  })
}

function parseMemberArray(value: unknown, path: string): BrowserParsedMember[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw invalidField(path, 'must be an array')
  return value.map((member, index) => parseMember(member, `${path}[${index}]`))
}

function parseMember(value: unknown, path: string): BrowserParsedMember {
  if (!isRecord(value)) throw invalidField(path, 'must be an object')
  const platformId = requiredString(value.platformId, `${path}.platformId`)
  return omitUndefined({
    platformId,
    accountName: optionalString(value.accountName, `${path}.accountName`) ?? platformId,
    groupNickname: optionalString(value.groupNickname, `${path}.groupNickname`),
    aliases: optionalStringArray(value.aliases, `${path}.aliases`),
    avatar: optionalString(value.avatar, `${path}.avatar`),
    roles: optionalRoles(value.roles, `${path}.roles`),
  })
}

function parseMessage(value: unknown, path: string): BrowserParsedMessage {
  if (!isRecord(value)) throw invalidField(path, 'must be an object')
  const sender = requiredString(value.sender, `${path}.sender`)
  const timestamp = requiredFiniteNumber(value.timestamp, `${path}.timestamp`)
  const type = requiredFiniteNumber(value.type, `${path}.type`)
  const content = value.content
  if (content !== null && typeof content !== 'string') throw invalidField(`${path}.content`, 'must be a string or null')

  return omitUndefined({
    senderPlatformId: sender,
    senderAccountName: optionalString(value.accountName, `${path}.accountName`) ?? sender,
    senderGroupNickname: optionalString(value.groupNickname, `${path}.groupNickname`),
    timestamp,
    type,
    content,
    platformMessageId: optionalString(value.platformMessageId, `${path}.platformMessageId`),
    replyToMessageId: optionalString(value.replyToMessageId, `${path}.replyToMessageId`),
  })
}

function mergeInferredMembers(
  explicitMembers: BrowserParsedMember[],
  messages: BrowserParsedMessage[]
): BrowserParsedMember[] {
  const byId = new Map(explicitMembers.map((member) => [member.platformId, member]))
  for (const message of messages) {
    if (byId.has(message.senderPlatformId)) continue
    byId.set(message.senderPlatformId, {
      platformId: message.senderPlatformId,
      accountName: message.senderAccountName,
      groupNickname: message.senderGroupNickname,
    })
  }
  return [...byId.values()]
}

async function cooperate(index: number, options: ParseChatLabSourceOptions): Promise<void> {
  options.checkCancelled?.()
  const yieldEvery = Math.max(1, options.yieldEvery ?? 1000)
  if (index > 0 && index % yieldEvery === 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    options.checkCancelled?.()
  }
}

function firstMeaningfulLine(content: string): string | undefined {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'))
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw invalidField(path, 'must be a non-empty string')
  return value
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw invalidField(path, 'must be a string')
  return value || undefined
}

function requiredFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidField(path, 'must be a finite number')
  return value
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw invalidField(path, 'must be an array of strings')
  }
  return value
}

function optionalRoles(value: unknown, path: string): Array<{ id: string; name?: string }> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw invalidField(path, 'must be an array')
  return value.map((role, index) => {
    if (!isRecord(role)) throw invalidField(`${path}[${index}]`, 'must be an object')
    return {
      id: requiredString(role.id, `${path}[${index}].id`),
      name: optionalString(role.name, `${path}[${index}].name`),
    }
  })
}

function invalidField(path: string, reason: string): WebRuntimeError {
  return new WebRuntimeError('INVALID_IMPORT_FILE', `${path} ${reason}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}
