import type {
  AIEntityRef,
  CrossChatContactLookupResult,
  CrossChatContactSessionsResult,
  CrossChatEntityResolution,
  CrossChatEvidencePayload,
  CrossChatMessageSource,
  CrossChatParticipantRef,
  CrossChatResolvedContactSession,
  CrossChatResolvedSession,
  CrossChatSearchScope,
  CrossChatSharedInteractionsResult,
} from '@openchatlab/shared-types'
import type { CrossChatToolExecutionContext, JsonSchema, ToolDefinition, ToolResult } from '../types'
import { parseExtendedTimeParams } from '../utils/time-params'
import { timeParamProperties } from '../utils/schemas'

const scopeItems = {
  type: 'object',
  properties: {
    sessionId: { type: 'string', description: 'Stable session ID returned by resolve_chat_entities' },
    memberIds: { type: 'array', items: { type: 'number' }, description: 'Local member IDs for this session' },
    label: { type: 'string', description: 'Human-readable scope label' },
  },
  required: ['sessionId'],
}

const recentDaysProperty = {
  type: 'number' as const,
  minimum: 1,
  description:
    'Relative time window ending at the real current time. Use 90 when the user says recent/recently without a more specific range.',
}

const resolveSchema: JsonSchema = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      description:
        'Contact or session references. A contact may use a stable contactKey or a displayName lookup from the user text.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['contact', 'session'] },
          contactKey: { type: 'string' },
          sessionId: { type: 'string' },
          displayName: { type: 'string' },
          sessionType: { type: 'string', enum: ['private', 'group'] },
        },
        required: ['type', 'displayName'],
      },
    },
  },
  required: ['entities'],
}

const searchSchema: JsonSchema = {
  type: 'object',
  properties: {
    keywords: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Exact substring keywords. May be omitted only with explicit scopes to sample recent messages from those scopes.',
    },
    scopes: {
      type: 'array',
      description: 'Resolved session/member scopes. Omit only when the user clearly requested global discovery.',
      items: scopeItems,
    },
    match_mode: { type: 'string', enum: ['any', 'all'], description: 'Whether any or all keywords must match' },
    recent_days: recentDaysProperty,
    sender: {
      type: 'string',
      enum: ['all', 'owner'],
      description:
        "Message sender filter. Use owner when the user's wording makes them the subject, such as 'I discussed buying a home'.",
    },
    sort: { type: 'string', enum: ['asc', 'desc'], description: 'Timestamp order; defaults to newest first' },
    max_sessions: { type: 'number', description: 'Maximum sessions to scan' },
    max_evidence: { type: 'number', description: 'Maximum evidence messages returned' },
    max_wall_time_ms: { type: 'number', description: 'Maximum wall time for this scan' },
    ...timeParamProperties,
  },
}

const contextSchema: JsonSchema = {
  type: 'object',
  properties: {
    session_id: { type: 'string', description: 'Source session ID from cross-chat search evidence' },
    message_id: { type: 'number', description: 'Message ID inside that source session' },
    context_size: { type: 'number', description: 'Messages before and after the source message; defaults to 10' },
  },
  required: ['session_id', 'message_id'],
}

const overviewSchema: JsonSchema = {
  type: 'object',
  properties: {
    scopes: {
      type: 'array',
      description: 'Resolved session/member scopes to summarize separately',
      items: scopeItems,
    },
    max_sessions: { type: 'number', description: 'Maximum sessions to analyze' },
    max_wall_time_ms: { type: 'number', description: 'Maximum wall time for this analysis' },
  },
  required: ['scopes'],
}

const inspectContactSessionsSchema: JsonSchema = {
  type: 'object',
  properties: {
    contact_key: {
      type: 'string',
      description: 'Stable contact key returned by resolve_chat_entities; display names are not accepted',
    },
    recent_days: recentDaysProperty,
    include_roster_only: {
      type: 'boolean',
      description: 'Include imported sessions where the member is recorded but did not speak in the selected range',
      default: true,
    },
    cursor: { type: 'string', description: 'Opaque continuation cursor from the previous result' },
    page_size: { type: 'number', description: 'Maximum matching sessions returned in this batch' },
    max_wall_time_ms: { type: 'number', description: 'Maximum wall time for this inspection batch' },
    ...timeParamProperties,
  },
  required: ['contact_key'],
}

const MAX_SHARED_ANCHORS_PER_PAIR = 8

const inspectSharedInteractionsSchema: JsonSchema = {
  type: 'object',
  properties: {
    participants: {
      type: 'array',
      description:
        'Two to five distinct people. Use type=owner for the local user in each session or type=contact with a stable contact_key.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['owner', 'contact'] },
          contact_key: { type: 'string' },
        },
        required: ['type'],
      },
    },
    recent_days: recentDaysProperty,
    cursor: { type: 'string', description: 'Opaque continuation cursor from the previous result' },
    page_size: { type: 'number', description: 'Maximum common sessions returned in this batch' },
    max_anchors_per_pair: {
      type: 'number',
      description: 'Maximum direct-reply and proximity message anchors returned for each participant pair',
      minimum: 0,
      maximum: MAX_SHARED_ANCHORS_PER_PAIR,
    },
    max_wall_time_ms: { type: 'number', description: 'Maximum wall time for this inspection batch' },
    ...timeParamProperties,
  },
  required: ['participants'],
}

const DEFAULT_CONTACT_INSPECTION_PAGE_SIZE = 50
const MAX_CONTACT_INSPECTION_PAGE_SIZE = 100
const MODEL_LABEL_MAX_LENGTH = 80
const DEFAULT_SHARED_INSPECTION_PAGE_SIZE = 20
const DEFAULT_SHARED_ANCHORS_PER_PAIR = 4
const TOOL_RESULT_CHARS_PER_TOKEN = 4
const TOOL_RESULT_BASE_CHARS = 1_500
const CONTACT_SESSION_ESTIMATED_CHARS = 650
const SHARED_SESSION_BASE_CHARS = 550
const SHARED_PARTICIPANT_ESTIMATED_CHARS = 240
const SHARED_PAIR_BASE_CHARS = 260
const SHARED_ANCHOR_ESTIMATED_CHARS = 180

async function resolveHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const inputs = parseEntityInputs(params.entities)
  const refs: AIEntityRef[] = []
  const contactLookups: CrossChatContactLookupResult[] = []
  for (const input of inputs) {
    if (input.type === 'contact' && !input.contactKey) {
      const lookup = context.analysisService.lookupContact(input.displayName)
      contactLookups.push(lookup)
      if (lookup.status === 'resolved' && lookup.candidates[0]) {
        refs.push({
          type: 'contact',
          contactKey: lookup.candidates[0].contactKey,
          displayName: lookup.candidates[0].displayName,
        })
      }
      continue
    }
    refs.push(input as AIEntityRef)
  }
  const resolution = await context.analysisService.resolveEntities(dedupeEntityRefs(refs), {
    signal: context.abortSignal,
  })
  const data = { ...resolution, contactLookups }
  const modelData = limitEntityResolutionToBudget(
    resolution,
    contactLookups,
    context.maxToolResultTokens,
    context.countTokens
  )
  return { content: JSON.stringify(modelData), data }
}

async function searchHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const timeFilter = parseExtendedTimeParams(params)
  const keywords = params.keywords === undefined ? [] : parseStringArray(params.keywords)
  const result = await context.analysisService.searchMessages(
    {
      keywords,
      scopes: params.scopes === undefined ? undefined : parseScopes(params.scopes),
      startTs: timeFilter?.startTs,
      endTs: timeFilter?.endTs,
      recentDays: parseOptionalNumber(params.recent_days),
      sender: params.sender === 'owner' ? 'owner' : 'all',
      matchMode: params.match_mode === 'all' ? 'all' : 'any',
      sort: params.sort === 'asc' ? 'asc' : 'desc',
      maxSessions: parseOptionalNumber(params.max_sessions),
      maxEvidence: parseOptionalNumber(params.max_evidence),
      maxWallTimeMs: parseOptionalNumber(params.max_wall_time_ms),
    },
    {
      signal: context.abortSignal,
      onProgress: (progress) =>
        context.reportProgress?.({
          phase: 'searching',
          current: progress.processedSessions,
          total: progress.totalSessions,
        }),
    }
  )
  const safeMessages = await preprocessBySession(context, result.messages)
  const buildCoverage = (budgetTruncated: boolean) => ({
    ...result.coverage,
    truncated: result.coverage.truncated || budgetTruncated,
    truncatedReasons: budgetTruncated
      ? [...new Set([...result.coverage.truncatedReasons, 'evidence_budget' as const])]
      : result.coverage.truncatedReasons,
  })
  const buildModelData = (messages: CrossChatMessageSource[], budgetTruncated: boolean) => ({
    totalMatches: result.totalMatches,
    returned: messages.length,
    appliedFilters: result.appliedFilters,
    coverage: buildCoverage(budgetTruncated),
    messages: messages.map(toModelMessage),
  })
  const limited = limitMessagesToBudget(safeMessages, context.maxToolResultTokens, buildModelData, {
    countTokens: context.countTokens,
  })
  const modelData = buildModelData(limited.messages, limited.truncated)
  const evidence: CrossChatEvidencePayload = {
    version: 1,
    query: keywords.join(' '),
    sources: limited.messages.map(toEvidenceSource),
    coverage: modelData.coverage,
  }
  const data = {
    ...modelData,
    crossChatEvidence: evidence,
  }
  // Evidence details are persisted for source cards, but duplicating their snippets in content would charge the
  // model twice for the same text and invalidate maxToolResultTokens.
  return { content: JSON.stringify(modelData), data }
}

async function contextHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const sessionId = requireString(params.session_id, 'session_id')
  const messageId = requireNumber(params.message_id, 'message_id')
  const contextSize = parseOptionalNumber(params.context_size)
  const result = context.analysisService.getMessageContext({ sessionId, messageId, contextSize })
  const safeMessages = await preprocessBySession(context, result.messages)
  const buildModelData = (messages: CrossChatMessageSource[], truncated: boolean) => ({
    source: result.source,
    returned: messages.length,
    truncated,
    messages: messages.map(toModelMessage),
  })
  const limited = limitMessagesToBudget(safeMessages, context.maxToolResultTokens, buildModelData, {
    priorityIndexes: buildContextPriority(safeMessages, messageId),
    continueAfterOverflow: true,
    countTokens: context.countTokens,
  })
  const data = buildModelData(limited.messages, limited.truncated)
  return { content: JSON.stringify(data), data }
}

async function overviewHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const result = await context.analysisService.getOverview(
    {
      scopes: parseScopes(params.scopes),
      maxSessions: parseOptionalNumber(params.max_sessions),
      maxWallTimeMs: parseOptionalNumber(params.max_wall_time_ms),
    },
    {
      signal: context.abortSignal,
      onProgress: (progress) =>
        context.reportProgress?.({
          phase: 'analyzing',
          current: progress.processedSessions,
          total: progress.totalSessions,
        }),
    }
  )
  const data = {
    items: result.items.map(({ memberNames: _memberNames, ...item }) => item),
    coverage: result.coverage,
  }
  return { content: JSON.stringify(data), data }
}

async function inspectContactSessionsHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const timeFilter = parseExtendedTimeParams(params)
  const requestedPageSize = parseOptionalNumber(params.page_size)
  const budgetedPageSize = limitContactPageSizeToBudget(requestedPageSize, context.maxToolResultTokens)
  const result = await context.analysisService.inspectContactSessions(
    {
      contactKey: requireString(params.contact_key, 'contact_key'),
      startTs: timeFilter?.startTs,
      endTs: timeFilter?.endTs,
      recentDays: parseOptionalNumber(params.recent_days),
      includeRosterOnly: params.include_roster_only === undefined ? true : requireBoolean(params.include_roster_only),
      cursor: typeof params.cursor === 'string' && params.cursor.trim() ? params.cursor.trim() : undefined,
      pageSize: budgetedPageSize.value,
      maxWallTimeMs: parseOptionalNumber(params.max_wall_time_ms),
    },
    {
      signal: context.abortSignal,
      onProgress: (progress) =>
        context.reportProgress?.({
          phase: 'analyzing',
          current: progress.processedSessions,
          total: progress.totalSessions,
        }),
    }
  )
  const countTokens = context.countTokens ?? estimatePayloadTokens
  const pageBudgetTruncated = budgetedPageSize.limited && result.coverage.truncatedReasons.includes('page_size')
  const payloadExceedsBudget =
    !!context.maxToolResultTokens &&
    context.maxToolResultTokens > 0 &&
    countTokens(JSON.stringify(result)) > context.maxToolResultTokens
  const data = pageBudgetTruncated || payloadExceedsBudget ? withToolResultBudgetReason(result) : result
  const modelData = limitContactResultToBudget(data, context.maxToolResultTokens, countTokens)
  return { content: JSON.stringify(modelData), data }
}

async function inspectSharedInteractionsHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const timeFilter = parseExtendedTimeParams(params)
  const participants = parseParticipants(params.participants)
  const requestedPageSize = parseOptionalNumber(params.page_size)
  const requestedAnchorsPerPair = parseOptionalNumber(params.max_anchors_per_pair)
  const budget = limitSharedRequestToBudget(
    participants.length,
    requestedPageSize,
    requestedAnchorsPerPair,
    context.maxToolResultTokens
  )
  const result = await context.analysisService.inspectSharedInteractions(
    {
      participants,
      startTs: timeFilter?.startTs,
      endTs: timeFilter?.endTs,
      recentDays: parseOptionalNumber(params.recent_days),
      cursor: typeof params.cursor === 'string' && params.cursor.trim() ? params.cursor.trim() : undefined,
      pageSize: budget.pageSize,
      maxAnchorsPerPair: budget.maxAnchorsPerPair,
      maxWallTimeMs: parseOptionalNumber(params.max_wall_time_ms),
    },
    {
      signal: context.abortSignal,
      onProgress: (progress) =>
        context.reportProgress?.({
          phase: 'analyzing',
          current: progress.processedSessions,
          total: progress.totalSessions,
        }),
    }
  )
  const pageBudgetTruncated =
    budget.pageLimited && result.coverage.nextCursor !== null && result.coverage.truncatedReasons.includes('page_size')
  const anchorBudgetTruncated =
    budget.anchorsLimited && result.sessions.some((session) => session.pairs.some((pair) => pair.anchorsTruncated))
  const countTokens = context.countTokens ?? estimatePayloadTokens
  const payloadExceedsBudget =
    !!context.maxToolResultTokens &&
    context.maxToolResultTokens > 0 &&
    countTokens(JSON.stringify(result)) > context.maxToolResultTokens
  const data: CrossChatSharedInteractionsResult =
    pageBudgetTruncated || anchorBudgetTruncated || payloadExceedsBudget ? withToolResultBudgetReason(result) : result
  const modelData = limitSharedModelResultToBudget(data, context.maxToolResultTokens, countTokens)
  return { content: JSON.stringify(modelData), data }
}

export const resolveChatEntitiesTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'resolve_chat_entities',
  description:
    'Resolve contacts and sessions into exact source scopes. Stable refs resolve directly; typed contact names search the contact catalog. Continue automatically for one candidate, ask the user to choose when contactLookups reports ambiguous, and never guess among multiple candidates.',
  inputSchema: resolveSchema,
  handler: resolveHandler,
  category: 'core',
}

export const searchMessagesGloballyTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'search_messages_globally',
  description:
    "Search exact keywords across resolved contacts or sessions. Use recent_days=90 when 'recent' has no explicit duration, and sender=owner when the user is the subject of the requested action. Owner hits are discovery seeds; expand their context to identify other participants. With explicit scopes, omit keywords to sample recent messages. Unscoped global discovery always requires keywords. Results include applied filters, source identity, coverage, and truncation status.",
  inputSchema: searchSchema,
  handler: searchHandler,
  category: 'core',
  truncationStrategy: 'keep_first',
}

export const getCrossChatMessageContextTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'get_cross_chat_message_context',
  description:
    'Load surrounding messages for one cross-chat evidence item. Both session_id and message_id are required because message IDs are only unique inside a session.',
  inputSchema: contextSchema,
  handler: contextHandler,
  category: 'core',
  truncationStrategy: 'keep_last',
}

export const getCrossChatOverviewTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'get_cross_chat_overview',
  description:
    'Get separate message-count and time-range overviews for resolved contact/session scopes. This is a basic comparison tool, not arbitrary SQL or single-chat deep analytics.',
  inputSchema: overviewSchema,
  handler: overviewHandler,
  category: 'core',
}

export const inspectContactSessionsTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'inspect_contact_sessions',
  description:
    "Inspect one resolved contact across imported private and group sessions. Returns the contact's own message counts, first/last speech, active days, roster-only presence, dataset cutoff, and coverage. Use recent_days=90 for recent activity without an explicit duration; never derive start_time from the dataset cutoff. Use only for person source/activity questions after exact identity resolution; this tool does not infer relationship labels or return message text.",
  inputSchema: inspectContactSessionsSchema,
  handler: inspectContactSessionsHandler,
  category: 'core',
}

export const inspectSharedInteractionsTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'inspect_shared_interactions',
  description:
    'Inspect common imported sessions for two to five exactly resolved people, including owner when requested. Returns per-person activity, directional replies, proximity signals, co-active days, message anchors, dataset cutoff, and coverage. Use recent_days=90 for recent interaction questions without an explicit duration; never derive start_time from the dataset cutoff. Common sessions contain every requested participant. These structural signals guide evidence reading and must never be treated as relationship labels or replace message context.',
  inputSchema: inspectSharedInteractionsSchema,
  handler: inspectSharedInteractionsHandler,
  category: 'core',
}

type ParsedEntityInput =
  | { type: 'contact'; contactKey?: string; displayName: string }
  | Extract<AIEntityRef, { type: 'session' }>

function parseEntityInputs(value: unknown): ParsedEntityInput[] {
  if (!Array.isArray(value)) throw new Error('entities must be an array')
  return value.map((item) => {
    if (!isRecord(item)) throw new Error('each entity must be an object')
    const type = requireString(item.type, 'entity.type')
    const displayName = requireString(item.displayName, 'entity.displayName')
    if (type === 'contact') {
      return {
        type,
        ...(typeof item.contactKey === 'string' && item.contactKey.trim()
          ? { contactKey: item.contactKey.trim() }
          : {}),
        displayName,
      }
    }
    if (type === 'session') {
      const sessionType = item.sessionType === 'private' ? 'private' : item.sessionType === 'group' ? 'group' : null
      if (!sessionType) throw new Error('entity.sessionType must be private or group')
      return { type, sessionId: requireString(item.sessionId, 'entity.sessionId'), displayName, sessionType }
    }
    throw new Error('entity.type must be contact or session')
  })
}

function dedupeEntityRefs(refs: AIEntityRef[]): AIEntityRef[] {
  const byKey = new Map<string, AIEntityRef>()
  for (const ref of refs) {
    const key = ref.type === 'contact' ? `contact:${ref.contactKey}` : `session:${ref.sessionId}`
    byKey.set(key, ref)
  }
  return [...byKey.values()]
}

function parseScopes(value: unknown): CrossChatSearchScope[] {
  if (!Array.isArray(value)) throw new Error('scopes must be an array')
  return value.map((item) => {
    if (!isRecord(item)) throw new Error('each scope must be an object')
    return {
      sessionId: requireString(item.sessionId, 'scope.sessionId'),
      memberIds: item.memberIds === undefined ? undefined : parseNumberArray(item.memberIds),
      label: typeof item.label === 'string' ? item.label : undefined,
    }
  })
}

function parseParticipants(value: unknown): CrossChatParticipantRef[] {
  if (!Array.isArray(value)) throw new Error('participants must be an array')
  return value.map((item) => {
    if (!isRecord(item)) throw new Error('each participant must be an object')
    if (item.type === 'owner') return { type: 'owner' }
    if (item.type === 'contact') {
      return { type: 'contact', contactKey: requireString(item.contact_key, 'participant.contact_key') }
    }
    throw new Error('participant.type must be owner or contact')
  })
}

function limitContactPageSizeToBudget(
  requestedPageSize: number | undefined,
  maxToolResultTokens: number | undefined
): { value: number | undefined; limited: boolean } {
  if (!maxToolResultTokens || maxToolResultTokens <= 0) {
    return { value: requestedPageSize, limited: false }
  }
  const requested = Math.min(
    MAX_CONTACT_INSPECTION_PAGE_SIZE,
    Math.max(1, Math.floor(requestedPageSize ?? DEFAULT_CONTACT_INSPECTION_PAGE_SIZE))
  )
  // service 调用前先收缩分页，保证 nextCursor 指向模型实际看过的最后一批结果，而不是截断后的尾部。
  const maxChars = maxToolResultTokens * TOOL_RESULT_CHARS_PER_TOKEN
  const budgeted = Math.max(1, Math.floor((maxChars - TOOL_RESULT_BASE_CHARS) / CONTACT_SESSION_ESTIMATED_CHARS))
  return {
    value: budgeted < requested ? budgeted : requestedPageSize,
    limited: budgeted < requested,
  }
}

function limitSharedRequestToBudget(
  participantCount: number,
  requestedPageSize: number | undefined,
  requestedAnchorsPerPair: number | undefined,
  maxToolResultTokens: number | undefined
): {
  pageSize: number | undefined
  maxAnchorsPerPair: number | undefined
  pageLimited: boolean
  anchorsLimited: boolean
} {
  const normalizedAnchorsPerPair =
    requestedAnchorsPerPair === undefined
      ? undefined
      : Math.min(MAX_SHARED_ANCHORS_PER_PAIR, Math.max(0, Math.floor(requestedAnchorsPerPair)))
  if (!maxToolResultTokens || maxToolResultTokens <= 0) {
    return {
      pageSize: requestedPageSize,
      maxAnchorsPerPair: normalizedAnchorsPerPair,
      pageLimited: false,
      anchorsLimited: false,
    }
  }

  const pairCount = (participantCount * (participantCount - 1)) / 2
  const requestedPage = requestedPageSize ?? DEFAULT_SHARED_INSPECTION_PAGE_SIZE
  const requestedAnchors = normalizedAnchorsPerPair ?? DEFAULT_SHARED_ANCHORS_PER_PAIR
  const maxChars = maxToolResultTokens * TOOL_RESULT_CHARS_PER_TOKEN
  let maxAnchorsPerPair = requestedAnchors

  const estimateSessionChars = (anchorsPerPair: number): number =>
    SHARED_SESSION_BASE_CHARS +
    participantCount * SHARED_PARTICIPANT_ESTIMATED_CHARS +
    pairCount * (SHARED_PAIR_BASE_CHARS + anchorsPerPair * SHARED_ANCHOR_ESTIMATED_CHARS)

  while (maxAnchorsPerPair > 0 && TOOL_RESULT_BASE_CHARS + estimateSessionChars(maxAnchorsPerPair) > maxChars) {
    maxAnchorsPerPair--
  }
  const pageSize = Math.min(
    requestedPage,
    Math.max(1, Math.floor((maxChars - TOOL_RESULT_BASE_CHARS) / estimateSessionChars(maxAnchorsPerPair)))
  )
  return {
    pageSize,
    maxAnchorsPerPair,
    pageLimited: pageSize < requestedPage,
    anchorsLimited: maxAnchorsPerPair < requestedAnchors,
  }
}

function withToolResultBudgetReason<T extends CrossChatContactSessionsResult | CrossChatSharedInteractionsResult>(
  result: T
): T {
  return {
    ...result,
    coverage: {
      ...result.coverage,
      truncated: true,
      truncatedReasons: [...new Set([...result.coverage.truncatedReasons, 'tool_result_budget' as const])],
    },
  }
}

function limitContactResultToBudget(
  result: CrossChatContactSessionsResult,
  maxToolResultTokens: number | undefined,
  countTokens: (text: string) => number
): unknown {
  if (!maxToolResultTokens || maxToolResultTokens <= 0) return result
  if (countTokens(JSON.stringify(result)) <= maxToolResultTokens) return result

  // details 保留完整结构供 UI 和日志追溯；这里只逐级压缩模型可见文本，并始终保留 coverage/continuation。
  const compactLabels = {
    ...result,
    contact: result.contact ? { ...result.contact, displayName: truncateModelLabel(result.contact.displayName) } : null,
    sessions: result.sessions.map((session) => ({
      ...session,
      sessionName: truncateModelLabel(session.sessionName),
      memberName: truncateModelLabel(session.memberName),
    })),
  }
  const coreFacts = {
    algorithmVersion: result.algorithmVersion,
    contact: compactLabels.contact,
    appliedRange: result.appliedRange,
    summary: result.summary,
    sessions: result.sessions.map((session) => ({
      sessionId: session.sessionId,
      sessionName: truncateModelLabel(session.sessionName),
      sessionType: session.sessionType,
      platform: session.platform,
      presence: session.presence,
      ownMessageCount: session.ownMessageCount,
      sessionMessageCount: session.sessionMessageCount,
      firstOwnMessageTs: session.firstOwnMessageTs,
      lastOwnMessageTs: session.lastOwnMessageTs,
      activeDays: session.activeDays,
      memberCount: session.memberCount,
      sessionFirstMessageTs: session.sessionFirstMessageTs,
      lastMessageTs: session.lastMessageTs,
    })),
    coverage: result.coverage,
  }
  const identityFacts = {
    contact: result.contact
      ? {
          contactKey: result.contact.contactKey,
          displayName: truncateModelLabel(result.contact.displayName),
          platform: result.contact.platform,
        }
      : null,
    sessions: result.sessions.map((session) => ({
      sessionId: session.sessionId,
      sessionType: session.sessionType,
      presence: session.presence,
      ownMessageCount: session.ownMessageCount,
      lastOwnMessageTs: session.lastOwnMessageTs,
    })),
    coverage: result.coverage,
  }
  const coverageOnly = { coverage: result.coverage }
  const candidates: unknown[] = [compactLabels, coreFacts, identityFacts, coverageOnly]
  return (
    candidates.find((candidate) => countTokens(JSON.stringify(candidate)) <= maxToolResultTokens) ?? {
      truncated: true,
      truncatedReasons: ['tool_result_budget'],
    }
  )
}

function limitSharedModelResultToBudget(
  result: CrossChatSharedInteractionsResult,
  maxToolResultTokens: number | undefined,
  countTokens: (text: string) => number
): unknown {
  if (!maxToolResultTokens || maxToolResultTokens <= 0) return result
  if (countTokens(JSON.stringify(result)) <= maxToolResultTokens) return result

  // details 保留完整调查结果；模型可见文本逐级压缩名称和锚点，并优先保留已被 cursor 消费的 session 身份。
  const compactLabels = {
    ...result,
    participants: result.participants.map((participant) => ({
      ...participant,
      displayName: truncateModelLabel(participant.displayName),
    })),
    sessions: result.sessions.map((session) => ({
      ...session,
      sessionName: truncateModelLabel(session.sessionName),
      participants: session.participants.map((participant) => ({
        ...participant,
        memberName: truncateModelLabel(participant.memberName),
      })),
    })),
  }
  const withAnchorLimit = (maxAnchorsPerPair: number) => ({
    ...compactLabels,
    sessions: compactLabels.sessions.map((session) => ({
      ...session,
      pairs: session.pairs.map((pair) => ({
        ...pair,
        anchors: pair.anchors.slice(0, maxAnchorsPerPair).map(({ sessionId: _sessionId, ...anchor }) => anchor),
        anchorsTruncated: pair.anchorsTruncated || pair.anchors.length > maxAnchorsPerPair,
      })),
    })),
  })
  const identityFacts = {
    algorithmVersion: result.algorithmVersion,
    proximityAlgorithmVersion: result.proximityAlgorithmVersion,
    participants: compactLabels.participants.map((participant) => ({
      index: participant.index,
      ref: participant.ref,
      status: participant.status,
      displayName: participant.displayName,
      platform: participant.platform,
    })),
    appliedRange: result.appliedRange,
    summary: result.summary,
    sessions: compactLabels.sessions.map((session) => ({
      sessionId: session.sessionId,
      sessionName: session.sessionName,
      sessionType: session.sessionType,
      platform: session.platform,
      lastMessageTs: session.lastMessageTs,
      memberCount: session.memberCount,
      priorityReasons: session.priorityReasons,
      proximityStatus: session.proximityStatus,
    })),
    coverage: result.coverage,
  }
  const coverageOnly = {
    summary: result.summary,
    coverage: result.coverage,
  }
  const continuationOnly = {
    coverage: {
      complete: result.coverage.complete,
      nextCursor: result.coverage.nextCursor,
      truncated: true,
      truncatedReasons: result.coverage.truncatedReasons,
    },
  }
  const candidates: unknown[] = [
    compactLabels,
    withAnchorLimit(2),
    withAnchorLimit(1),
    withAnchorLimit(0),
    identityFacts,
    coverageOnly,
    continuationOnly,
    { truncated: true, truncatedReasons: ['tool_result_budget'] },
    {},
  ]
  return candidates.find((candidate) => countTokens(JSON.stringify(candidate)) <= maxToolResultTokens) ?? {}
}

function truncateModelLabel(value: string): string {
  const chars = Array.from(value)
  return chars.length > MODEL_LABEL_MAX_LENGTH ? `${chars.slice(0, MODEL_LABEL_MAX_LENGTH).join('')}…` : value
}

async function preprocessBySession(
  context: CrossChatToolExecutionContext,
  messages: CrossChatMessageSource[]
): Promise<CrossChatMessageSource[]> {
  const bySession = new Map<string, CrossChatMessageSource[]>()
  for (const message of messages) {
    const group = bySession.get(message.sessionId) ?? []
    group.push({ ...message })
    bySession.set(message.sessionId, group)
  }
  const safe: CrossChatMessageSource[] = []
  const processedBySession = new Map<string, Map<number, CrossChatMessageSource>>()
  for (const [sessionId, group] of bySession) {
    const processed = await context.preprocessMessagesBySession(sessionId, group)
    const byMessageId = new Map<number, CrossChatMessageSource>()
    for (const message of processed) {
      if (message.sessionId === sessionId) byMessageId.set(message.messageId, message)
    }
    processedBySession.set(sessionId, byMessageId)
  }
  for (const message of messages) {
    const processed = processedBySession.get(message.sessionId)?.get(message.messageId)
    if (processed) safe.push(processed)
  }
  return safe
}

function limitMessagesToBudget(
  messages: CrossChatMessageSource[],
  maxToolResultTokens: number | undefined,
  buildPayload: (messages: CrossChatMessageSource[], truncated: boolean) => unknown,
  options: {
    priorityIndexes?: number[]
    continueAfterOverflow?: boolean
    countTokens?: (text: string) => number
  } = {}
): { messages: CrossChatMessageSource[]; truncated: boolean } {
  const prepared = messages.map((message) => ({
    ...message,
    content: message.content.length > 500 ? `${message.content.slice(0, 500)}…` : message.content,
  }))
  if (!maxToolResultTokens || maxToolResultTokens <= 0) {
    return { messages: prepared, truncated: false }
  }

  const countTokens = options.countTokens ?? estimatePayloadTokens
  const priorityIndexes = options.priorityIndexes ?? prepared.map((_, index) => index)
  const selectedIndexes = new Set<number>()
  for (const index of priorityIndexes) {
    if (index < 0 || index >= prepared.length || selectedIndexes.has(index)) continue
    const candidateIndexes = [...selectedIndexes, index].sort((left, right) => left - right)
    const candidateMessages = candidateIndexes.map((candidateIndex) => prepared[candidateIndex])
    const truncated = candidateMessages.length < prepared.length
    const serializedCandidate = JSON.stringify(buildPayload(candidateMessages, truncated))
    if (countTokens(serializedCandidate) > maxToolResultTokens) {
      if (options.continueAfterOverflow) continue
      break
    }
    selectedIndexes.add(index)
  }
  const limited = [...selectedIndexes].sort((left, right) => left - right).map((index) => prepared[index])
  return { messages: limited, truncated: limited.length < prepared.length }
}

type EntityResolutionScopeItem =
  | { kind: 'contact'; contactIndex: number; session: CrossChatResolvedContactSession }
  | { kind: 'session'; sessionIndex: number; session: CrossChatResolvedSession }

function limitEntityResolutionToBudget(
  resolution: CrossChatEntityResolution,
  contactLookups: CrossChatContactLookupResult[],
  maxToolResultTokens: number | undefined,
  injectedCountTokens?: (text: string) => number
): unknown {
  const fullData = { ...resolution, contactLookups }
  if (!maxToolResultTokens || maxToolResultTokens <= 0) return fullData

  const countTokens = injectedCountTokens ?? estimatePayloadTokens
  const scopeItems = buildEntityResolutionScopePriority(resolution)
  let includeLookupHints = true
  let emptyPayload = buildEntityResolutionPayload(resolution, contactLookups, scopeItems, 0, includeLookupHints)
  // 先舍弃只用于姓名消歧的来源提示，把预算优先留给后续工具真正需要的精确 scope。
  if (countTokens(JSON.stringify(emptyPayload)) > maxToolResultTokens) {
    includeLookupHints = false
    emptyPayload = buildEntityResolutionPayload(resolution, contactLookups, scopeItems, 0, includeLookupHints)
  }
  if (countTokens(JSON.stringify(emptyPayload)) > maxToolResultTokens) {
    return buildMinimalEntityResolutionPayload(resolution, contactLookups, maxToolResultTokens, countTokens)
  }

  let low = 0
  let high = scopeItems.length
  // 最终 JSON 每次都用平台 tokenizer 复核；二分前缀避免大量来源时反复编码完整增长数组。
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = buildEntityResolutionPayload(resolution, contactLookups, scopeItems, middle, includeLookupHints)
    if (countTokens(JSON.stringify(candidate)) <= maxToolResultTokens) low = middle
    else high = middle - 1
  }
  return buildEntityResolutionPayload(resolution, contactLookups, scopeItems, low, includeLookupHints)
}

function buildEntityResolutionScopePriority(resolution: CrossChatEntityResolution): EntityResolutionScopeItem[] {
  const items: EntityResolutionScopeItem[] = []
  // 用户显式选择的会话优先；联系人来源按最近时间轮询，避免第一个联系人耗尽全部预算。
  for (const [sessionIndex, session] of resolution.sessions.entries()) {
    if (session.status === 'resolved' && session.session) items.push({ kind: 'session', sessionIndex, session })
  }

  const contactSessions = resolution.contacts.map((contact) =>
    [...contact.sessions].sort(
      (left, right) =>
        (right.lastMessageTs ?? Number.NEGATIVE_INFINITY) - (left.lastMessageTs ?? Number.NEGATIVE_INFINITY)
    )
  )
  for (let depth = 0; ; depth++) {
    let added = false
    for (const [contactIndex, sessions] of contactSessions.entries()) {
      const session = sessions[depth]
      if (!session) continue
      items.push({ kind: 'contact', contactIndex, session })
      added = true
    }
    if (!added) break
  }
  return items
}

function buildEntityResolutionPayload(
  resolution: CrossChatEntityResolution,
  contactLookups: CrossChatContactLookupResult[],
  scopeItems: EntityResolutionScopeItem[],
  selectedScopeCount: number,
  includeLookupHints: boolean
): Record<string, unknown> {
  const selectedContactSessions = new Map<number, CrossChatResolvedContactSession[]>()
  const selectedSessionIndexes = new Set<number>()
  for (const item of scopeItems.slice(0, selectedScopeCount)) {
    if (item.kind === 'session') {
      selectedSessionIndexes.add(item.sessionIndex)
      continue
    }
    const sessions = selectedContactSessions.get(item.contactIndex) ?? []
    sessions.push(item.session)
    selectedContactSessions.set(item.contactIndex, sessions)
  }

  const truncated = selectedScopeCount < scopeItems.length
  const contacts = resolution.contacts.map((contact, index) => {
    const sessions = selectedContactSessions.get(index) ?? []
    return {
      ref: contact.ref,
      status: contact.status,
      cacheStatus: contact.cacheStatus,
      sessionCount: contact.sessions.length,
      returnedSessions: sessions.length,
      sessions,
      unresolvedSessionCount: contact.unresolvedSessionIds.length,
      failedSessionCount: contact.failedSessionIds.length,
    }
  })
  const sessions = resolution.sessions.filter(
    (session, index) => session.status === 'unresolved' || selectedSessionIndexes.has(index)
  )

  return {
    contacts,
    sessions,
    unresolved: resolution.unresolved,
    coverage: {
      ...resolution.coverage,
      returnedContactEntities: contacts.length,
      returnedSessionEntities: sessions.length,
      returnedSourceScopes: selectedScopeCount,
      truncated,
      truncatedReasons: truncated ? ['tool_result_budget'] : [],
    },
    contactLookups: buildModelContactLookups(contactLookups, includeLookupHints),
  }
}

function buildModelContactLookups(
  contactLookups: CrossChatContactLookupResult[],
  includeHints: boolean
): Array<Record<string, unknown>> {
  return contactLookups.map((lookup) => ({
    query: lookup.query,
    status: lookup.status,
    cacheStatus: lookup.cacheStatus,
    totalCandidates: lookup.totalCandidates,
    candidates: lookup.candidates.map((candidate) => {
      const hints = includeHints && lookup.status === 'ambiguous' ? candidate.sourceSessions.slice(0, 3) : []
      return {
        contactKey: candidate.contactKey,
        displayName: candidate.displayName,
        platform: candidate.platform,
        aliases: candidate.aliases.slice(0, 8),
        aliasCount: candidate.aliases.length,
        sourceSessionCount: candidate.sourceSessions.length,
        sourceSessionHintsReturned: hints.length,
        sourceSessionHintsTruncated: lookup.status === 'ambiguous' && hints.length < candidate.sourceSessions.length,
        ...(hints.length > 0
          ? {
              sourceSessionHints: hints,
            }
          : {}),
      }
    }),
  }))
}

function buildMinimalEntityResolutionPayload(
  resolution: CrossChatEntityResolution,
  contactLookups: CrossChatContactLookupResult[],
  maxToolResultTokens: number,
  countTokens: (text: string) => number
): Record<string, unknown> {
  const coverage = {
    ...resolution.coverage,
    returnedContactEntities: 0,
    returnedSessionEntities: 0,
    returnedSourceScopes: 0,
    truncated: true,
    truncatedReasons: ['tool_result_budget'],
  }
  const candidates: Array<Record<string, unknown>> = [
    {
      contacts: [],
      sessions: [],
      unresolved: [],
      coverage,
      contactLookups: contactLookups.map((lookup) => ({
        query: lookup.query,
        status: lookup.status,
        totalCandidates: lookup.totalCandidates,
      })),
    },
    { coverage },
    { truncated: true, truncatedReasons: ['tool_result_budget'] },
  ]
  return (
    candidates.find((candidate) => countTokens(JSON.stringify(candidate)) <= maxToolResultTokens) ?? {
      truncated: true,
    }
  )
}

function estimatePayloadTokens(text: string): number {
  // Browser/MCP 等未注入 Node tokenizer 的调用方仍需避免按 ASCII 密度低估中文结果。
  let cjkChars = 0
  let otherChars = 0
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0
    if (
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
      (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
      (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7af)
    ) {
      cjkChars++
    } else {
      otherChars++
    }
  }
  return Math.ceil(cjkChars / 1.6 + otherChars / 4)
}

function buildContextPriority(messages: CrossChatMessageSource[], anchorMessageId: number): number[] {
  const anchorIndex = messages.findIndex((message) => message.messageId === anchorMessageId)
  if (anchorIndex < 0) return messages.map((_, index) => index)

  const indexes = [anchorIndex]
  for (let distance = 1; indexes.length < messages.length; distance++) {
    const before = anchorIndex - distance
    const after = anchorIndex + distance
    if (before >= 0) indexes.push(before)
    if (after < messages.length) indexes.push(after)
  }
  return indexes
}

function toModelMessage(message: CrossChatMessageSource): Record<string, unknown> {
  return {
    sessionId: message.sessionId,
    sessionName: message.sessionName,
    sessionType: message.sessionType,
    messageId: message.messageId,
    senderId: message.senderId,
    senderName: message.senderName,
    timestamp: message.timestamp,
    content: message.content,
  }
}

function toEvidenceSource(message: CrossChatMessageSource): CrossChatEvidencePayload['sources'][number] {
  return {
    sessionId: message.sessionId,
    sessionName: message.sessionName,
    sessionType: message.sessionType,
    platform: message.platform,
    messageId: message.messageId,
    senderName: message.senderName,
    timestamp: message.timestamp,
    snippet: message.content,
  }
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('keywords must be an array')
  return value.map((item) => requireString(item, 'keyword')).filter(Boolean)
}

function parseNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error('memberIds must be an array')
  return value.map((item) => requireNumber(item, 'memberId'))
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a number`)
  return value
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('include_roster_only must be a boolean')
  return value
}

function parseOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
