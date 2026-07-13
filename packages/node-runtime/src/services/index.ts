// Adapters
export type { SessionRuntimeAdapter } from './adapters'
export { createDatabaseManagerAdapter } from './adapters'

// Session service
export {
  listAnalysisSessions,
  getAnalysisSession,
  renameSession,
  updateSessionOwnerId,
  deleteSession,
} from './session-service'
export type { AnalysisSessionDTO, ListSessionsOptions } from './session-service'

// Member service
export {
  getMembers,
  getMembersPaginated,
  updateMemberAliases,
  mergeMembers,
  deleteMember,
  getMemberNameHistory,
} from './member-service'
export type { MembersPaginatedDTO } from './member-service'

// Owner profile service
export {
  tryApplyOwnerProfile,
  setOwnerAndApplyProfile,
  dismissOwnerPrompt,
  clearSessionOwner,
} from './owner-profile-service'
export type {
  ApplyOwnerProfileReason,
  ApplyOwnerProfileResult,
  SetOwnerAndApplyProfileResult,
} from './owner-profile-service'

// Session index service
export {
  generateIndex,
  generateIncrementalIndex,
  clearIndex,
  getFtsStatus,
  searchFts,
  rebuildFts,
  getAllIndexStats,
} from './session-index-service'
export type { SessionIndexStatusItem } from './session-index-service'

// Summary service
export { generateSummary, generateAllSummaries } from './summary-service'
export type { LlmConfig, SummaryServiceDeps } from './summary-service'

// Export service
export { exportMarkdown } from './export-service'

// Contacts service
export { CONTACTS_ALGORITHM_VERSION, createContactsService } from './contacts'
export type { ContactsComputeRunner, ContactsService, ContactsServiceDeps, ContactsServiceOptions } from './contacts'

// People relationships service
export { PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION, createPeopleRelationshipsService } from './people/relationships'
export type {
  PeopleRelationshipsComputeRunner,
  PeopleRelationshipsService,
  PeopleRelationshipsServiceDeps,
  PeopleRelationshipsServiceOptions,
} from './people/relationships'

// Global insight service
export { ANNUAL_SUMMARY_ALGORITHM_VERSION, createGlobalInsightService } from './global-insight'
export type {
  AnnualSummaryComputeRunner,
  GlobalInsightService,
  GlobalInsightServiceDeps,
  GlobalInsightServiceOptions,
} from './global-insight'

// Merge cache
export { MergeSessionCache } from './merge-cache'

// Push import (POST /api/v1/imports/:sessionId)
export { executePushImportUnlocked, pushImport } from './push-importer'
export type {
  PushImportAnalysisOutcome,
  PushImportAnalysisResult,
  PushImportExecutionDeps,
  PushImportPayload,
  PushImportResult,
  PushImportOutcome,
  PushImportMessage,
  PushImportMember,
  PushImportMeta,
} from './push-importer'

export { DEFAULT_IMPORT_IDEMPOTENCY_TTL_MS, hashImportBody, ImportIdempotencyCache } from './import-idempotency'
export type { ImportIdempotencyStartResult } from './import-idempotency'
