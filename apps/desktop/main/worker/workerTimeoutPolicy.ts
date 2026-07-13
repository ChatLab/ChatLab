const RESTARTABLE_READ_ONLY_REQUEST_TYPES = new Set([
  'pluginQuery',
  'executeRawSQL',
  'getSchema',
  'getAvailableYears',
  'getMemberActivity',
  'getHourlyActivity',
  'getDailyActivity',
  'getWeekdayActivity',
  'getMonthlyActivity',
  'getYearlyActivity',
  'getMessageLengthDistribution',
  'getMessageTypeDistribution',
  'getTimeRange',
  'getMemberNameHistory',
  'getCatchphraseAnalysis',
  'getLanguagePreferenceAnalysis',
  'getMentionAnalysis',
  'getMentionGraph',
  'getLaughAnalysis',
  'getClusterGraph',
  'getRelationshipStats',
  'getAllSessions',
  'getSession',
  'getChatOverview',
  'getMembers',
  'getMembersPaginated',
  'searchMessages',
  'deepSearchMessages',
  'getMessageContext',
  'getSearchMessageContext',
  'getRecentMessages',
  'getAllRecentMessages',
  'getConversationBetween',
  'hasSessionIndex',
  'getSessionStats',
  'getAllIndexStats',
  'getSessions',
  'getSessionsByTimeRange',
  'getRecentChatSessions',
  'getSegmentMessages',
  'getSegmentSummaries',
])

const DEFAULT_WORKER_REQUEST_TIMEOUT_MS = 60 * 1000
const LONG_RUNNING_WORKER_REQUEST_TIMEOUT_MS = 10 * 60 * 1000
const LONG_RUNNING_WORKER_REQUEST_TYPES = new Set(['pushImport'])

export function isRestartableReadOnlyRequestType(type: string): boolean {
  return RESTARTABLE_READ_ONLY_REQUEST_TYPES.has(type)
}

export function getWorkerRequestTimeoutMs(type: string): number {
  return LONG_RUNNING_WORKER_REQUEST_TYPES.has(type)
    ? LONG_RUNNING_WORKER_REQUEST_TIMEOUT_MS
    : DEFAULT_WORKER_REQUEST_TIMEOUT_MS
}
