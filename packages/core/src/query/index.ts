export { buildTimeFilter, buildSystemMessageFilter, hasTable, hasColumn } from './filters'

export {
  isChatSessionDb,
  getSessionMeta,
  getSessionOverview,
  getDatabaseSchema,
  getChatOverview,
  searchSegments,
  getSegmentMessages,
  getSegmentSummaries,
  buildSessionInfo,
  getSessionInfo,
  getSummaryCount,
  getLastPlatformMessageId,
  // Session index (segment) helpers
  DEFAULT_SESSION_GAP_THRESHOLD,
  hasSessionIndex,
  getSessionIndexStats,
  getChatSessionList,
  getSessionsByTimeRange,
  getRecentChatSessions,
  loadSegmentMessages,
  getSegmentSummary,
  saveSegmentSummary,
  updateSessionGapThreshold,
  updateSessionOwnerId,
  renameSession,
  clearSessionIndex,
  generateSessionIndex,
  generateIncrementalSessionIndex,
  getPrivateChatMemberAvatar,
  getExportSessionData,
} from './session-queries'
export type {
  SessionMeta,
  SessionOverview,
  SessionInfo,
  CoreSessionInfo,
  ChatOverviewData,
  SegmentSearchItem,
  SegmentMessagesData,
  SegmentSummaryData,
  ChatSessionItem,
  SessionIndexStats,
  SessionPreviewMessage,
  SearchSegmentsOptions,
  ExportSessionData,
} from './session-queries'

export {
  getTimeRange,
  getAvailableYears,
  getMemberActivity,
  getHourlyActivity,
  getDailyActivity,
  getWeekdayActivity,
  getMessageTypeStats,
  getMonthlyActivity,
  getYearlyActivity,
  getMessageLengthDistribution,
} from './basic-queries'
export type {
  MemberActivity,
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  MessageTypeStats,
  MonthlyActivity,
  YearlyActivity,
  MessageLengthDistribution,
} from './basic-queries'

export {
  queryMessages,
  searchMessagesLike,
  getRecentMessages,
  getMembers,
  getMembersDetailed,
  executeReadonlySql,
  executeSql,
  getSchemaDetailed,
  getMessageContext,
  getSearchMessageContext,
  getConversationBetween,
  getMemberNameHistory,
  getMembersWithAliases,
  getMembersPaginated,
  executeParameterizedSql,
} from './message-queries'
export type {
  QueryMessagesOptions,
  QueryMessagesResult,
  MessageResult,
  PaginatedMessages,
  MemberDetailed,
  ContextMessage,
  ConversationData,
  MemberNameHistoryEntry,
  MemberWithAliases,
  MembersPaginationParams,
  MembersPaginatedResult,
  SqlExecutionOptions,
  SqlExecutionResult,
  TableSchema,
} from './message-queries'

// Shared full-message SQL, types, and mapper
export {
  FULL_MSG_COLUMNS,
  FULL_MSG_FROM,
  FULL_MSG_SELECT,
  MSG_COUNT_FROM,
  SYSTEM_MSG_FILTER,
  TEXT_ONLY_FILTER,
  mapMessageRow,
  buildMsgConditions,
} from './message-sql'
export type { FullMessageRow, MappedMessage, MsgQueryConditions } from './message-sql'

// Async SQL executor abstraction
export type { AsyncSqlExecutor } from './executor'

// Shared async message query functions (platform-agnostic)
export {
  fetchMessagesBefore,
  fetchMessagesAfter,
  searchMessagesLikeAsync,
  searchMessagesWithFtsAsync,
  fetchMessageContext,
  fetchSearchMessageContext,
  fetchAllRecentMessages,
  fetchRecentTextMessages,
  fetchConversationBetween,
} from './message-query-functions'
export type { AsyncPaginatedMessages, AsyncMessagesWithTotal, AsyncConversationData } from './message-query-functions'

// Member write operations (merge, delete, update aliases, DDL migration)
export { updateMemberAliases, mergeMembers, deleteMember, ensureAliasesColumn, ensureAvatarColumn } from './member-ops'

// Advanced analytics
export {
  getCatchphraseAnalysis,
  getMentionAnalysis,
  getMentionGraph,
  getLaughAnalysis,
  getClusterGraph,
  getRelationshipStats,
  getLanguagePreferenceAnalysis,
} from './advanced'
export type {
  CatchphraseAnalysis,
  MemberCatchphrase,
  CatchphraseItem,
  MentionGraphData,
  MentionGraphNode,
  MentionGraphLink,
  ClusterGraphData,
  ClusterGraphNode,
  ClusterGraphLink,
  ClusterGraphOptions,
  RelationshipStats,
  RelationshipMonthStats,
  IceBreakerItem,
  ResponseLatencyMember,
  PerseveranceMember,
  MonthlyResponseLatency,
  MonthlyPerseverance,
  RelationshipOptions,
  NlpProvider,
  PosTagResult,
  LanguagePreferenceParams,
} from './advanced'
