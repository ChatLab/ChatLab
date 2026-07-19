import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { createInterface } from 'node:readline'
import {
  CHATLAB_SUPPORTED_FORMAT_VERSIONS,
  MessageType,
  isSupportedChatLabFormatVersion,
} from '@openchatlab/shared-types'

const MAX_REPORTED_ISSUES = 100
const MAX_UNIX_SECONDS = 100_000_000_000
const KNOWN_MESSAGE_TYPES = new Set<number>(
  Object.values(MessageType).filter((value): value is number => typeof value === 'number')
)

export type ChatLabValidationFormat = 'json' | 'jsonl' | 'unknown'
export type ChatLabValidationSeverity = 'error' | 'warning'

export interface ChatLabValidationIssue {
  severity: ChatLabValidationSeverity
  code: string
  message: string
  path?: string
  line?: number
}

export interface ChatLabValidationStats {
  headerCount: number
  memberCount: number
  messageCount: number
  uniqueSenderCount: number
  commentLineCount: number
  blankLineCount: number
}

export interface ChatLabValidationReport {
  valid: boolean
  format: ChatLabValidationFormat
  version?: string
  fileSize: number
  errorCount: number
  warningCount: number
  issues: ChatLabValidationIssue[]
  truncatedIssueCount: number
  stats: ChatLabValidationStats
}

interface ValidationState {
  format: ChatLabValidationFormat
  fileSize: number
  version?: string
  errorCount: number
  warningCount: number
  issues: ChatLabValidationIssue[]
  stats: ChatLabValidationStats
  memberIds: Set<string>
  ownerIds: Set<string>
  senderIds: Set<string>
  messageIds: Set<string>
  replyTargetIds: Set<string>
  lastTimestamp?: number
}

interface IssueLocation {
  path?: string
  line?: number
}

function createState(format: ChatLabValidationFormat, fileSize: number): ValidationState {
  return {
    format,
    fileSize,
    errorCount: 0,
    warningCount: 0,
    issues: [],
    stats: {
      headerCount: 0,
      memberCount: 0,
      messageCount: 0,
      uniqueSenderCount: 0,
      commentLineCount: 0,
      blankLineCount: 0,
    },
    memberIds: new Set(),
    ownerIds: new Set(),
    senderIds: new Set(),
    messageIds: new Set(),
    replyTargetIds: new Set(),
  }
}

function addIssue(
  state: ValidationState,
  severity: ChatLabValidationSeverity,
  code: string,
  message: string,
  location: IssueLocation = {}
): void {
  if (severity === 'error') state.errorCount++
  else state.warningCount++

  if (state.issues.length < MAX_REPORTED_ISSUES) {
    state.issues.push({ severity, code, message, ...location })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function childLocation(location: IssueLocation, path: string): IssueLocation {
  return { ...location, path }
}

function validateRequiredString(
  state: ValidationState,
  value: unknown,
  path: string,
  location: IssueLocation
): value is string {
  if (typeof value === 'string' && value.trim().length > 0) return true
  addIssue(state, 'error', 'INVALID_REQUIRED_STRING', 'Expected a non-empty string.', childLocation(location, path))
  return false
}

function validateOptionalString(
  state: ValidationState,
  object: Record<string, unknown>,
  key: string,
  path: string,
  location: IssueLocation
): void {
  if (!hasOwn(object, key)) return
  if (typeof object[key] !== 'string') {
    addIssue(state, 'error', 'INVALID_OPTIONAL_STRING', 'Expected a string.', childLocation(location, path))
  }
}

function validateUnixSeconds(
  state: ValidationState,
  value: unknown,
  path: string,
  location: IssueLocation
): value is number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_UNIX_SECONDS) {
    return true
  }
  addIssue(
    state,
    'error',
    'INVALID_UNIX_SECONDS',
    'Expected a non-negative integer Unix timestamp in seconds, not milliseconds.',
    childLocation(location, path)
  )
  return false
}

function validateHeader(
  state: ValidationState,
  chatlab: unknown,
  meta: unknown,
  location: IssueLocation,
  basePath = ''
): void {
  state.stats.headerCount++

  if (!isRecord(chatlab)) {
    addIssue(state, 'error', 'INVALID_CHATLAB_HEADER', 'Expected a chatlab object.', {
      ...location,
      path: `${basePath}chatlab`,
    })
  } else {
    const versionPath = `${basePath}chatlab.version`
    if (typeof chatlab.version !== 'string') {
      addIssue(state, 'error', 'INVALID_VERSION', 'Expected a string format version.', {
        ...location,
        path: versionPath,
      })
    } else {
      state.version = chatlab.version
      if (!isSupportedChatLabFormatVersion(chatlab.version)) {
        addIssue(
          state,
          'error',
          'UNSUPPORTED_VERSION',
          `Supported ChatLab format versions: ${CHATLAB_SUPPORTED_FORMAT_VERSIONS.join(', ')}.`,
          {
            ...location,
            path: versionPath,
          }
        )
      }
    }
    validateUnixSeconds(state, chatlab.exportedAt, `${basePath}chatlab.exportedAt`, location)
    validateOptionalString(state, chatlab, 'generator', `${basePath}chatlab.generator`, location)
    validateOptionalString(state, chatlab, 'description', `${basePath}chatlab.description`, location)
  }

  if (!isRecord(meta)) {
    addIssue(state, 'error', 'INVALID_META', 'Expected a meta object.', {
      ...location,
      path: `${basePath}meta`,
    })
    return
  }

  validateRequiredString(state, meta.name, `${basePath}meta.name`, location)
  validateRequiredString(state, meta.platform, `${basePath}meta.platform`, location)
  if (meta.type !== 'group' && meta.type !== 'private') {
    addIssue(state, 'error', 'INVALID_CHAT_TYPE', 'Expected chat type "group" or "private".', {
      ...location,
      path: `${basePath}meta.type`,
    })
  }
  validateOptionalString(state, meta, 'groupId', `${basePath}meta.groupId`, location)
  validateOptionalString(state, meta, 'groupAvatar', `${basePath}meta.groupAvatar`, location)
  if (hasOwn(meta, 'ownerId')) {
    if (validateRequiredString(state, meta.ownerId, `${basePath}meta.ownerId`, location)) {
      state.ownerIds.add(meta.ownerId)
    }
  }
  validateOptionalString(state, meta, 'sourceSessionId', `${basePath}meta.sourceSessionId`, location)
}

function validateMember(state: ValidationState, value: unknown, path: string, location: IssueLocation): void {
  state.stats.memberCount++
  if (!isRecord(value)) {
    addIssue(state, 'error', 'INVALID_MEMBER', 'Expected a member object.', childLocation(location, path))
    return
  }

  if (validateRequiredString(state, value.platformId, `${path}.platformId`, location)) {
    if (state.memberIds.has(value.platformId)) {
      addIssue(state, 'error', 'DUPLICATE_MEMBER_ID', 'Member platformId must be unique.', {
        ...location,
        path: `${path}.platformId`,
      })
    } else {
      state.memberIds.add(value.platformId)
    }
  }
  validateRequiredString(state, value.accountName, `${path}.accountName`, location)
  validateOptionalString(state, value, 'groupNickname', `${path}.groupNickname`, location)
  validateOptionalString(state, value, 'avatar', `${path}.avatar`, location)

  if (hasOwn(value, 'aliases')) {
    if (!Array.isArray(value.aliases) || value.aliases.some((alias) => typeof alias !== 'string')) {
      addIssue(state, 'error', 'INVALID_ALIASES', 'Expected aliases to be an array of strings.', {
        ...location,
        path: `${path}.aliases`,
      })
    }
  }

  if (hasOwn(value, 'roles')) {
    if (!Array.isArray(value.roles)) {
      addIssue(state, 'error', 'INVALID_ROLES', 'Expected roles to be an array.', {
        ...location,
        path: `${path}.roles`,
      })
    } else {
      value.roles.forEach((role, index) => {
        const rolePath = `${path}.roles[${index}]`
        if (!isRecord(role)) {
          addIssue(state, 'error', 'INVALID_ROLE', 'Expected a role object.', {
            ...location,
            path: rolePath,
          })
          return
        }
        validateRequiredString(state, role.id, `${rolePath}.id`, location)
        validateOptionalString(state, role, 'name', `${rolePath}.name`, location)
      })
    }
  }
}

function validateMessage(state: ValidationState, value: unknown, path: string, location: IssueLocation): void {
  state.stats.messageCount++
  if (!isRecord(value)) {
    addIssue(state, 'error', 'INVALID_MESSAGE', 'Expected a message object.', childLocation(location, path))
    return
  }

  if (validateRequiredString(state, value.sender, `${path}.sender`, location)) {
    state.senderIds.add(value.sender)
  }
  validateRequiredString(state, value.accountName, `${path}.accountName`, location)

  if (validateUnixSeconds(state, value.timestamp, `${path}.timestamp`, location)) {
    if (state.lastTimestamp !== undefined && value.timestamp < state.lastTimestamp) {
      addIssue(
        state,
        'warning',
        'OUT_OF_ORDER_TIMESTAMP',
        'Messages should be ordered by timestamp ascending.',
        childLocation(location, `${path}.timestamp`)
      )
    }
    state.lastTimestamp = value.timestamp
  }

  if (typeof value.type !== 'number' || !Number.isInteger(value.type) || !KNOWN_MESSAGE_TYPES.has(value.type)) {
    addIssue(state, 'error', 'INVALID_MESSAGE_TYPE', 'Expected a supported numeric ChatLab message type.', {
      ...location,
      path: `${path}.type`,
    })
  }

  if (!hasOwn(value, 'content') || (typeof value.content !== 'string' && value.content !== null)) {
    addIssue(state, 'error', 'INVALID_MESSAGE_CONTENT', 'Expected content to be a string or null.', {
      ...location,
      path: `${path}.content`,
    })
  }
  validateOptionalString(state, value, 'groupNickname', `${path}.groupNickname`, location)

  if (hasOwn(value, 'platformMessageId')) {
    if (validateRequiredString(state, value.platformMessageId, `${path}.platformMessageId`, location)) {
      if (state.messageIds.has(value.platformMessageId)) {
        addIssue(state, 'error', 'DUPLICATE_MESSAGE_ID', 'platformMessageId must be unique.', {
          ...location,
          path: `${path}.platformMessageId`,
        })
      } else {
        state.messageIds.add(value.platformMessageId)
      }
    }
  }

  if (hasOwn(value, 'replyToMessageId')) {
    if (validateRequiredString(state, value.replyToMessageId, `${path}.replyToMessageId`, location)) {
      state.replyTargetIds.add(value.replyToMessageId)
    }
  }
}

function finalizeState(
  state: ValidationState,
  requireExplicitMembers: boolean,
  enforceRequiredSections = true
): ChatLabValidationReport {
  if (enforceRequiredSections) {
    if (state.stats.headerCount === 0) {
      addIssue(state, 'error', 'MISSING_HEADER', 'A ChatLab header is required.')
    }
    if (state.stats.messageCount === 0) {
      addIssue(state, 'error', 'MISSING_MESSAGES', 'At least one message is required.')
    }
    if (requireExplicitMembers && state.stats.memberCount === 0) {
      addIssue(state, 'error', 'MISSING_MEMBERS', 'The JSON format requires a members array with sender identities.')
    }
  }

  const ownerMemberIds =
    state.memberIds.size > 0 ? state.memberIds : requireExplicitMembers ? undefined : state.senderIds
  if (ownerMemberIds) {
    for (const ownerId of state.ownerIds) {
      if (!ownerMemberIds.has(ownerId)) {
        addIssue(state, 'error', 'UNKNOWN_OWNER', 'meta.ownerId must reference a member platformId.')
      }
    }
  }

  if (state.memberIds.size > 0) {
    for (const senderId of state.senderIds) {
      if (!state.memberIds.has(senderId)) {
        addIssue(
          state,
          'error',
          'UNKNOWN_MESSAGE_SENDER',
          'Every message sender must reference an explicit member platformId.'
        )
      }
    }
  }

  for (const replyTargetId of state.replyTargetIds) {
    if (!state.messageIds.has(replyTargetId)) {
      addIssue(
        state,
        'warning',
        'UNKNOWN_REPLY_TARGET',
        'A replyToMessageId does not match any platformMessageId in this file.'
      )
    }
  }

  state.stats.uniqueSenderCount = state.senderIds.size
  const totalIssueCount = state.errorCount + state.warningCount
  return {
    valid: state.errorCount === 0,
    format: state.format,
    version: state.version,
    fileSize: state.fileSize,
    errorCount: state.errorCount,
    warningCount: state.warningCount,
    issues: state.issues,
    truncatedIssueCount: Math.max(0, totalIssueCount - state.issues.length),
    stats: state.stats,
  }
}

async function validateJson(filePath: string, fileSize: number): Promise<ChatLabValidationReport> {
  const state = createState('json', fileSize)
  let root: unknown

  try {
    root = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch {
    addIssue(state, 'error', 'INVALID_JSON', 'The file is not valid JSON.')
    return finalizeState(state, true, false)
  }

  if (!isRecord(root)) {
    addIssue(state, 'error', 'INVALID_ROOT', 'Expected a top-level JSON object.')
    return finalizeState(state, true, false)
  }

  validateHeader(state, root.chatlab, root.meta, {})

  if (!Array.isArray(root.members)) {
    addIssue(state, 'error', 'INVALID_MEMBERS', 'Expected members to be an array.', { path: 'members' })
  } else {
    root.members.forEach((member, index) => validateMember(state, member, `members[${index}]`, {}))
  }

  if (!Array.isArray(root.messages)) {
    addIssue(state, 'error', 'INVALID_MESSAGES', 'Expected messages to be an array.', { path: 'messages' })
  } else {
    root.messages.forEach((message, index) => validateMessage(state, message, `messages[${index}]`, {}))
  }

  return finalizeState(state, true)
}

async function validateJsonl(filePath: string, fileSize: number): Promise<ChatLabValidationReport> {
  const state = createState('jsonl', fileSize)
  const input = createReadStream(filePath, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  let lineNumber = 0
  let dataLineCount = 0
  let sawMessage = false

  for await (const line of lines) {
    lineNumber++
    const trimmed = line.trim()
    if (!trimmed) {
      state.stats.blankLineCount++
      continue
    }
    if (trimmed.startsWith('#')) {
      state.stats.commentLineCount++
      continue
    }

    dataLineCount++
    let value: unknown
    try {
      value = JSON.parse(trimmed) as unknown
    } catch {
      addIssue(state, 'error', 'INVALID_JSONL_LINE', 'The line is not valid JSON.', { line: lineNumber })
      continue
    }

    if (!isRecord(value)) {
      addIssue(state, 'error', 'INVALID_JSONL_VALUE', 'Expected a JSON object on every data line.', {
        line: lineNumber,
      })
      continue
    }

    if (dataLineCount === 1 && value._type !== 'header') {
      addIssue(state, 'error', 'HEADER_NOT_FIRST', 'The first data line must be a header.', {
        line: lineNumber,
        path: '_type',
      })
    }

    switch (value._type) {
      case 'header':
        if (state.stats.headerCount > 0) {
          addIssue(state, 'error', 'DUPLICATE_HEADER', 'Only one header line is allowed.', {
            line: lineNumber,
            path: '_type',
          })
        }
        validateHeader(state, value.chatlab, value.meta, { line: lineNumber })
        break
      case 'member':
        if (sawMessage) {
          addIssue(state, 'error', 'MEMBER_AFTER_MESSAGE', 'Member lines must appear before message lines.', {
            line: lineNumber,
          })
        }
        validateMember(state, value, `line[${lineNumber}]`, { line: lineNumber })
        break
      case 'message':
        sawMessage = true
        validateMessage(state, value, `line[${lineNumber}]`, { line: lineNumber })
        break
      default:
        addIssue(state, 'error', 'UNKNOWN_LINE_TYPE', 'Expected _type to be header, member, or message.', {
          line: lineNumber,
          path: '_type',
        })
    }
  }

  return finalizeState(state, false)
}

export async function validateChatLabFile(filePath: string): Promise<ChatLabValidationReport> {
  const fileStat = await stat(filePath)
  const extension = extname(filePath).toLowerCase()

  if (extension === '.json') return validateJson(filePath, fileStat.size)
  if (extension === '.jsonl') return validateJsonl(filePath, fileStat.size)

  const state = createState('unknown', fileStat.size)
  addIssue(state, 'error', 'UNSUPPORTED_EXTENSION', 'Expected a .json or .jsonl file.')
  return finalizeState(state, false, false)
}
