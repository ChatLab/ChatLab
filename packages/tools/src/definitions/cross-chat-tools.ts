import type {
  AIEntityRef,
  CrossChatContactLookupResult,
  CrossChatContactSessionsResult,
  CrossChatEntityResolution,
  CrossChatEvidencePayload,
  CrossChatGroupSessionsRankingResult,
  CrossChatGlobalActivitySummaryResult,
  CrossChatMessageSource,
  CrossChatOverviewItem,
  CrossChatOverviewResult,
  CrossChatParticipantRef,
  CrossChatPrivateContactsRankingResult,
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
    'Relative time window ending at the real current time. Use 30 for unspecified recent activity, but omit it for a latest available private-chat recap without an explicit date or duration.',
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
    ...timeParamProperties,
  },
}

const recentSessionSchema: JsonSchema = {
  type: 'object',
  properties: {
    session_id: {
      type: 'string',
      description: 'One exact session ID returned by resolve_chat_entities',
    },
  },
  required: ['session_id'],
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
    recent_days: recentDaysProperty,
    ...timeParamProperties,
  },
  required: ['scopes'],
}

const rankPrivateContactsSchema: JsonSchema = {
  type: 'object',
  properties: {
    rank_by: {
      type: 'string',
      enum: ['message_count', 'active_days'],
      description: 'Ranking metric. Defaults to total private-chat message count.',
    },
    limit: { type: 'number', minimum: 1, maximum: 50, description: 'Number of ranked contacts to return' },
    recent_days: recentDaysProperty,
    ...timeParamProperties,
  },
}

const rankGroupSessionsSchema: JsonSchema = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      enum: ['owner_activity', 'total_activity'],
      description:
        "Use owner_activity for 'where was I most active' and total_activity for 'which groups were busiest overall'.",
    },
    limit: { type: 'number', minimum: 1, maximum: 50, description: 'Number of ranked groups to return' },
    recent_days: recentDaysProperty,
    ...timeParamProperties,
  },
  required: ['mode'],
}

const globalActivitySummarySchema: JsonSchema = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      enum: ['year', 'recent_365'],
      description: 'Use year for a calendar year and recent_365 for the rolling latest 365 days. Defaults to year.',
    },
    year: {
      type: 'number',
      minimum: 1970,
      description: 'Calendar year for mode=year. Omit it to use the current year.',
    },
  },
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
    selection: summarizeEvidenceSelection(messages),
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

async function readRecentSessionHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const result = context.analysisService.readRecentSession(requireString(params.session_id, 'session_id'))
  const safeMessages = await preprocessBySession(context, result.messages)
  const safeSummaries = await context.preprocessSummariesBySession(result.source.sessionId, result.summaries)
  const sessionPseudonym = 'Session1'
  const modelSource = {
    ...result.source,
    sessionName: context.preprocessModelLabel(result.source.sessionName, sessionPseudonym),
  }
  const toRecentModelMessage = (message: CrossChatMessageSource) => ({
    ...toModelMessage(message),
    sessionName: context.preprocessModelLabel(message.sessionName, sessionPseudonym),
  })
  const buildModelData = (messages: CrossChatMessageSource[], budgetTruncated: boolean) => ({
    source: modelSource,
    selection: {
      strategy: 'latest_session_slice',
      totalMessages: result.coverage.totalMessages,
      returnedMessages: messages.length,
      returnedSummaries: safeSummaries.length,
      hasEarlierMessages: result.coverage.hasEarlierMessages,
      toolResultTruncated: budgetTruncated,
    },
    summaries: safeSummaries,
    messages: messages.map(toRecentModelMessage),
  })
  const limited = limitMessagesToBudget(safeMessages, context.maxToolResultTokens, buildModelData, {
    countTokens: context.countTokens,
  })
  const modelData = buildModelData(limited.messages, limited.truncated)
  const evidence: CrossChatEvidencePayload = {
    version: 1,
    query: 'recent session recap',
    sources: limited.messages.map(toEvidenceSource),
    coverage: {
      candidateSessions: 1,
      scannedSessions: 1,
      matchedSessions: limited.messages.length > 0 ? 1 : 0,
      failedSessions: 0,
      truncated: limited.truncated,
      truncatedReasons: limited.truncated ? ['evidence_budget'] : [],
    },
  }
  return {
    content: JSON.stringify(modelData),
    data: {
      ...modelData,
      source: result.source,
      messages: limited.messages.map(toModelMessage),
      crossChatEvidence: evidence,
    },
  }
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
  const timeFilter = parseExtendedTimeParams(params)
  const result = await context.analysisService.getOverview(
    {
      scopes: parseScopes(params.scopes),
      startTs: timeFilter?.startTs,
      endTs: timeFilter?.endTs,
      recentDays: parseOptionalNumber(params.recent_days),
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
    appliedRange: result.appliedRange,
    items: result.items.map(({ memberNames: _memberNames, ...item }) => item),
    coverage: result.coverage,
  }
  const fullModelData: OverviewModelData = {
    ...data,
    items: data.items.map((item, index) => {
      const sessionPseudonym = `Session${index + 1}`
      const preprocessMember = (member: (typeof item.memberActivities)[number]) => ({
        ...member,
        memberName: context.preprocessModelLabel(member.memberName, `U${member.memberId}@${item.sessionId}`),
      })
      return {
        ...item,
        sessionName: context.preprocessModelLabel(item.sessionName, sessionPseudonym),
        label: context.preprocessModelLabel(item.label, sessionPseudonym),
        memberActivities: item.memberActivities.map(preprocessMember),
        topMembers: item.topMembers.map(preprocessMember),
      }
    }),
  }
  const modelData = limitOverviewToBudget(
    fullModelData,
    context.maxToolResultTokens,
    context.countTokens ?? estimatePayloadTokens
  )
  return { content: JSON.stringify(modelData), data }
}

async function rankPrivateContactsHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const timeFilter = parseExtendedTimeParams(params)
  const result: CrossChatPrivateContactsRankingResult = await context.analysisService.rankPrivateContacts(
    {
      startTs: timeFilter?.startTs,
      endTs: timeFilter?.endTs,
      recentDays: parseOptionalNumber(params.recent_days),
      rankBy: params.rank_by === 'active_days' ? 'active_days' : 'message_count',
      limit: parseOptionalNumber(params.limit),
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
  const modelData = {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      displayName: context.preprocessModelLabel(item.displayName, `Contact${item.rank}`),
    })),
  }
  return { content: JSON.stringify(modelData), data: result }
}

async function rankGroupSessionsHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const timeFilter = parseExtendedTimeParams(params)
  const mode = requireString(params.mode, 'mode')
  if (mode !== 'owner_activity' && mode !== 'total_activity') {
    throw new Error('mode must be owner_activity or total_activity')
  }
  const result: CrossChatGroupSessionsRankingResult = await context.analysisService.rankGroupSessions(
    {
      mode,
      startTs: timeFilter?.startTs,
      endTs: timeFilter?.endTs,
      recentDays: parseOptionalNumber(params.recent_days),
      limit: parseOptionalNumber(params.limit),
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
  const modelData = {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      sessionName: context.preprocessModelLabel(item.sessionName, `Group${item.rank}`),
    })),
  }
  return { content: JSON.stringify(modelData), data: result }
}

async function globalActivitySummaryHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const mode = params.mode ?? 'year'
  if (mode !== 'year' && mode !== 'recent_365') throw new Error('mode must be year or recent_365')
  const result: CrossChatGlobalActivitySummaryResult = context.analysisService.getGlobalActivitySummary({
    mode,
    year: parseOptionalNumber(params.year),
  })
  const modelData = limitGlobalActivitySummaryToBudget(
    buildGlobalActivityModelData(result),
    context.maxToolResultTokens,
    context.countTokens ?? estimatePayloadTokens
  )
  return { content: JSON.stringify(modelData), data: result }
}

function buildGlobalActivityModelData(result: CrossChatGlobalActivitySummaryResult) {
  const summary = result.summary
  return {
    mode: result.mode,
    dataState: result.dataState,
    range: summary.range,
    availableDataYears: summary.availableDataYears,
    latestDataYear: summary.latestDataYear,
    metrics: summary.metrics,
    monthlyActivity: summary.monthlyActivity,
    monthlyDirectContacts: summary.monthlyDirectContacts,
    dailyActivity: summary.dailyActivity,
    messageTypes: summary.messageTypes,
    textLength: summary.textLength,
    coverage: summary.coverage,
    cache: {
      status: summary.cache.status,
      computedAt: summary.cache.computedAt,
      staleReason: summary.cache.staleReason,
    },
    task: {
      status: summary.task.status,
      startedAt: summary.task.startedAt,
      finishedAt: summary.task.finishedAt,
      processedSessions: summary.task.processedSessions,
      totalSessions: summary.task.totalSessions,
    },
    selection: {
      dailyActivityTotal: summary.dailyActivity.length,
      dailyActivityReturned: summary.dailyActivity.length,
      dailyActivityFormat: 'objects',
      toolResultTruncated: false,
      truncatedReasons: [] as string[],
    },
  }
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

export const readRecentSessionTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'read_recent_session',
  description:
    'Read one exactly resolved session for a concise latest-available recap. The tool internally returns a bounded newest message slice plus up to five existing segment summaries, with source evidence and preprocessing. Use it after resolve_chat_entities when the user asks what happened recently in one private chat or one explicitly selected session without a calendar range. Do not pass message budgets. For explicit dates, durations, keywords, multi-session work, or deeper history, use search_messages_globally instead.',
  inputSchema: recentSessionSchema,
  handler: readRecentSessionHandler,
  category: 'core',
  truncationStrategy: 'keep_first',
}

export const searchMessagesGloballyTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'search_messages_globally',
  description:
    'Search exact keywords across resolved contacts or sessions. Use recent_days=30 for unspecified recent activity, but for a latest available private-chat recap without an explicit date or duration, scope only the direct private session and omit recent_days. Use sender=owner when the user is the subject of the requested action. The tool controls evidence volume internally, prioritizes private-chat evidence, ranks remaining group sources by matching activity, and automatically includes surrounding context. With explicit scopes, omit keywords to sample recent messages. Unscoped global discovery always requires keywords. Results include applied filters, source identity, coverage, and truncation status.',
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
    'Compare already-resolved contact or session scopes within an exact time range. Returns deterministic message counts, active days and members, per-requested-member activity, owner coverage, fixed top members for groups, dataset cutoff, and completeness. It does not discover or rank sessions globally.',
  inputSchema: overviewSchema,
  handler: overviewHandler,
  category: 'core',
}

export const rankPrivateContactsTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'rank_private_contacts',
  description:
    'Deterministically rank private-chat contacts across all eligible imported sessions for an exact time range. Use this for questions such as who the user chatted with most or had the most active private-chat days. This tool counts non-system messages and never uses keyword-search hits as a ranking proxy. Results include owner/contact splits, dataset cutoff, identity coverage, and completeness.',
  inputSchema: rankPrivateContactsSchema,
  handler: rankPrivateContactsHandler,
  category: 'core',
}

export const rankGroupSessionsTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'rank_group_sessions',
  description:
    'Deterministically rank imported group sessions for an exact time range. mode=owner_activity answers where the user personally spoke most; mode=total_activity answers which groups were busiest overall. Never mix these metrics or substitute sampled search hits. Results include total and owner counts, active members/days, owner-resolution coverage, dataset cutoff, and completeness.',
  inputSchema: rankGroupSessionsSchema,
  handler: rankGroupSessionsHandler,
  category: 'core',
}

export const getGlobalActivitySummaryTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'get_global_activity_summary',
  description:
    'Read the existing deterministic owner activity snapshot for the current calendar year, another calendar year, or the rolling latest 365 days. Use it for total sent messages, active days, direct-contact counts, monthly/daily trends, message types, and text-length distribution. It never reads chat text or returns contact/group rankings. fresh and stale states contain usable metrics; preparing and failed do not and must not be described as zero activity. Do not poll a preparing result in the same answer.',
  inputSchema: globalActivitySummarySchema,
  handler: globalActivitySummaryHandler,
  category: 'core',
}

export const inspectContactSessionsTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'inspect_contact_sessions',
  description:
    "Inspect one resolved contact across imported private and group sessions. Returns the contact's own message counts, first/last speech, active days, roster-only presence, dataset cutoff, and coverage. Use recent_days=30 for recent activity without an explicit duration; never derive start_time from the dataset cutoff. Use only for person source/activity questions after exact identity resolution; this tool does not infer relationship labels or return message text.",
  inputSchema: inspectContactSessionsSchema,
  handler: inspectContactSessionsHandler,
  category: 'core',
}

export const inspectSharedInteractionsTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'inspect_shared_interactions',
  description:
    'Inspect common imported sessions for two to five exactly resolved people, including owner when requested. Returns per-person activity, directional replies, proximity signals, co-active days, message anchors, dataset cutoff, and coverage. Use recent_days=30 for recent interaction questions without an explicit duration; never derive start_time from the dataset cutoff. Common sessions contain every requested participant. These structural signals guide evidence reading and must never be treated as relationship labels or replace message context.',
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

type GlobalActivityModelData = ReturnType<typeof buildGlobalActivityModelData>

interface OverviewModelData {
  appliedRange: CrossChatOverviewResult['appliedRange']
  items: Array<Omit<CrossChatOverviewItem, 'memberNames'>>
  coverage: CrossChatOverviewResult['coverage']
}

type OverviewItemFormat = 'compact' | 'core' | 'identity' | 'omitted'

function limitOverviewToBudget(
  fullData: OverviewModelData,
  maxToolResultTokens: number | undefined,
  countTokens: (text: string) => number
): unknown {
  if (!maxToolResultTokens || maxToolResultTokens <= 0) return fullData
  if (countTokens(JSON.stringify(fullData)) <= maxToolResultTokens) return fullData

  const compactItems = fullData.items.map((item) => ({
    ...item,
    sessionName: truncateModelLabel(item.sessionName),
    label: truncateModelLabel(item.label),
    memberActivities: item.memberActivities.map((member) => ({
      memberId: member.memberId,
      memberName: truncateModelLabel(member.memberName),
      messageCount: member.messageCount,
      activeDays: member.activeDays,
      firstMessageTs: member.firstMessageTs,
      lastMessageTs: member.lastMessageTs,
    })),
    topMembers: item.topMembers.map((member) => ({
      memberName: truncateModelLabel(member.memberName),
      messageCount: member.messageCount,
      activeDays: member.activeDays,
      lastMessageTs: member.lastMessageTs,
    })),
  }))
  const buildCandidate = (items: Array<Record<string, unknown>>, itemFormat: OverviewItemFormat) => ({
    appliedRange: fullData.appliedRange,
    items,
    coverage: fullData.coverage,
    selection: buildOverviewSelection(fullData.items, items, itemFormat),
  })
  const fits = (candidate: unknown) => countTokens(JSON.stringify(candidate)) <= maxToolResultTokens

  // 优先保留所有会话的核心统计，先均匀收缩每个会话的成员明细，避免只留下输入顺序靠前的会话。
  const maxTopMembers = compactItems.reduce((max, item) => Math.max(max, item.topMembers.length), 0)
  const topMemberCandidate = findLargestOverviewDetailLimit(maxTopMembers, (limit) =>
    buildCandidate(
      compactItems.map((item) => ({ ...item, topMembers: item.topMembers.slice(0, limit) })),
      'compact'
    )
  )
  if (topMemberCandidate && fits(topMemberCandidate)) return topMemberCandidate

  const maxMemberActivities = compactItems.reduce((max, item) => Math.max(max, item.memberActivities.length), 0)
  const memberActivityCandidate = findLargestOverviewDetailLimit(maxMemberActivities, (limit) =>
    buildCandidate(
      compactItems.map((item) => ({
        ...item,
        memberActivities: item.memberActivities.slice(0, limit),
        topMembers: [],
      })),
      'compact'
    )
  )
  if (memberActivityCandidate && fits(memberActivityCandidate)) return memberActivityCandidate

  const coreItems = compactItems.map((item) => ({
    sessionId: item.sessionId,
    sessionName: item.sessionName,
    sessionType: item.sessionType,
    platform: item.platform,
    label: item.label,
    totalMessages: item.totalMessages,
    activeDays: item.activeDays,
    activeMembers: item.activeMembers,
    firstMessageTs: item.firstMessageTs,
    lastMessageTs: item.lastMessageTs,
    ownerStatus: item.ownerStatus,
    ownerMessages: item.ownerMessages,
    ownerActiveDays: item.ownerActiveDays,
  }))
  const coreCandidate = buildCandidate(coreItems, 'core')
  if (fits(coreCandidate)) return coreCandidate

  const identityItems = compactItems.map((item) => ({
    sessionId: item.sessionId,
    sessionName: item.sessionName,
    sessionType: item.sessionType,
    label: item.label,
    totalMessages: item.totalMessages,
    activeDays: item.activeDays,
    lastMessageTs: item.lastMessageTs,
  }))
  const identityCandidate = buildCandidate(identityItems, 'identity')
  if (fits(identityCandidate)) return identityCandidate

  const returnedItems = findLargestOverviewItemSlice(identityItems, (items) => buildCandidate(items, 'identity'))
  if (returnedItems) return returnedItems

  const omitted = buildCandidate([], 'omitted')
  const candidates: unknown[] = [
    omitted,
    {
      selection: buildOverviewSelection(fullData.items, [], 'omitted'),
    },
    { toolResultTruncated: true, truncatedReasons: ['tool_result_budget'] },
    {},
  ]
  return candidates.find(fits) ?? {}

  function findLargestOverviewDetailLimit(
    maximum: number,
    build: (limit: number) => ReturnType<typeof buildCandidate>
  ): ReturnType<typeof buildCandidate> | null {
    if (!fits(build(0))) return null
    let low = 0
    let high = maximum
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (fits(build(middle))) low = middle
      else high = middle - 1
    }
    return build(low)
  }

  function findLargestOverviewItemSlice(
    items: Array<Record<string, unknown>>,
    build: (items: Array<Record<string, unknown>>) => ReturnType<typeof buildCandidate>
  ): ReturnType<typeof buildCandidate> | null {
    if (!fits(build([]))) return null
    let low = 0
    let high = items.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (fits(build(items.slice(0, middle)))) low = middle
      else high = middle - 1
    }
    return build(items.slice(0, low))
  }
}

function buildOverviewSelection(
  fullItems: OverviewModelData['items'],
  returnedItems: Array<Record<string, unknown>>,
  itemFormat: OverviewItemFormat
) {
  const memberActivitiesTotal = fullItems.reduce((sum, item) => sum + item.memberActivities.length, 0)
  const topMembersTotal = fullItems.reduce((sum, item) => sum + item.topMembers.length, 0)
  const memberActivitiesReturned = returnedItems.reduce(
    (sum, item) => sum + (Array.isArray(item.memberActivities) ? item.memberActivities.length : 0),
    0
  )
  const topMembersReturned = returnedItems.reduce(
    (sum, item) => sum + (Array.isArray(item.topMembers) ? item.topMembers.length : 0),
    0
  )
  const truncatedReasons = [
    ...(memberActivitiesReturned < memberActivitiesTotal ? ['member_activities_budget'] : []),
    ...(topMembersReturned < topMembersTotal ? ['top_members_budget'] : []),
    ...(returnedItems.length < fullItems.length ? ['session_items_budget'] : []),
    'item_fields_budget',
    'tool_result_budget',
  ]
  return {
    sessionItemsTotal: fullItems.length,
    sessionItemsReturned: returnedItems.length,
    memberActivitiesTotal,
    memberActivitiesReturned,
    topMembersTotal,
    topMembersReturned,
    itemFormat,
    toolResultTruncated: true,
    truncatedReasons,
  }
}

function limitGlobalActivitySummaryToBudget(
  fullData: GlobalActivityModelData,
  maxToolResultTokens: number | undefined,
  countTokens: (text: string) => number
): unknown {
  if (!maxToolResultTokens || maxToolResultTokens <= 0) return fullData
  if (countTokens(JSON.stringify(fullData)) <= maxToolResultTokens) return fullData

  const totalDailyPoints = fullData.dailyActivity.length
  const buildCompactedDailyData = (returned: number) => ({
    ...fullData,
    dailyActivity: sampleEvenly(fullData.dailyActivity, returned).map(
      (point) => [point.date, point.messageCount] as const
    ),
    selection: {
      dailyActivityTotal: totalDailyPoints,
      dailyActivityReturned: returned,
      dailyActivityFormat: 'date_message_count_tuples',
      toolResultTruncated: returned < totalDailyPoints,
      truncatedReasons: returned < totalDailyPoints ? ['daily_activity_budget'] : [],
    },
  })

  let low = 0
  let high = totalDailyPoints
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (countTokens(JSON.stringify(buildCompactedDailyData(middle))) <= maxToolResultTokens) low = middle
    else high = middle - 1
  }
  const compacted = buildCompactedDailyData(low)
  if (countTokens(JSON.stringify(compacted)) <= maxToolResultTokens) return compacted

  const truncatedReasons = [...(totalDailyPoints > 0 ? ['daily_activity_budget'] : []), 'tool_result_budget']
  const selection = {
    dailyActivityTotal: totalDailyPoints,
    dailyActivityReturned: 0,
    dailyActivityFormat: 'omitted',
    toolResultTruncated: true,
    truncatedReasons,
  }
  const candidates: unknown[] = [
    {
      mode: fullData.mode,
      dataState: fullData.dataState,
      range: fullData.range,
      metrics: fullData.metrics,
      monthlyActivity: fullData.monthlyActivity,
      monthlyDirectContacts: fullData.monthlyDirectContacts,
      messageTypes: fullData.messageTypes,
      textLength: fullData.textLength,
      coverage: fullData.coverage,
      cache: fullData.cache,
      selection,
    },
    {
      mode: fullData.mode,
      dataState: fullData.dataState,
      range: fullData.range,
      metrics: fullData.metrics,
      coverage: fullData.coverage,
      cache: fullData.cache,
      selection,
    },
    { mode: fullData.mode, dataState: fullData.dataState, metrics: fullData.metrics, selection },
    { dataState: fullData.dataState, selection },
    { toolResultTruncated: true, truncatedReasons: ['tool_result_budget'] },
    {},
  ]
  return candidates.find((candidate) => countTokens(JSON.stringify(candidate)) <= maxToolResultTokens) ?? {}
}

function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (limit <= 0 || items.length === 0) return []
  if (limit >= items.length) return [...items]
  if (limit === 1) return [items[items.length - 1]!]
  return Array.from({ length: limit }, (_, index) => {
    const sourceIndex = Math.round((index * (items.length - 1)) / (limit - 1))
    return items[sourceIndex]!
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
  const priorityIndexes = [...new Set(options.priorityIndexes ?? prepared.map((_, index) => index))].filter(
    (index) => index >= 0 && index < prepared.length
  )

  if (!options.continueAfterOverflow) {
    let low = 0
    let high = priorityIndexes.length
    // 普通搜索按优先级取连续前缀，使用二分将大结果集的完整序列化和 tokenizer 调用降到对数级。
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      const candidateIndexes = priorityIndexes.slice(0, middle).sort((left, right) => left - right)
      const candidateMessages = candidateIndexes.map((candidateIndex) => prepared[candidateIndex])
      const truncated = candidateMessages.length < prepared.length
      const serializedCandidate = JSON.stringify(buildPayload(candidateMessages, truncated))
      if (countTokens(serializedCandidate) <= maxToolResultTokens) low = middle
      else high = middle - 1
    }
    const limitedIndexes = priorityIndexes.slice(0, low).sort((left, right) => left - right)
    const limited = limitedIndexes.map((index) => prepared[index])
    return { messages: limited, truncated: limited.length < prepared.length }
  }

  const selectedIndexes = new Set<number>()
  for (const index of priorityIndexes) {
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
    evidenceRole: message.evidenceRole,
  }
}

function summarizeEvidenceSelection(messages: CrossChatMessageSource[]): Record<string, number> {
  let matchedMessages = 0
  let contextMessages = 0
  let privateMessages = 0
  let groupMessages = 0
  for (const message of messages) {
    if (message.evidenceRole === 'context') contextMessages++
    else matchedMessages++
    if (message.sessionType === 'private') privateMessages++
    else groupMessages++
  }
  return { matchedMessages, contextMessages, privateMessages, groupMessages }
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
