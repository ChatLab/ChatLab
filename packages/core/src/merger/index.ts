export {
  getCollidingPlatformIds,
  getCollidingPlatformIdsFromMessages,
  normalizePlatformId,
  detectConflictsInMessages,
  mergeMembers,
  deduplicateAndSortMessages,
} from './algorithms'

export type {
  MergerMember,
  MergerMessage,
  MergeConflict,
  ConflictCheckResult,
  MergedMember,
  MergedMessage,
} from './algorithms'
