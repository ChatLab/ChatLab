/**
 * Shared member service layer.
 *
 * Delegates to @openchatlab/core member-ops and query functions,
 * ensuring CLI Web and Electron use identical business semantics
 * (merge strategy, delete scope, name history source, etc.).
 */

import {
  getMembersWithAliases as coreGetMembersWithAliases,
  getMembersPaginated as coreGetMembersPaginated,
  getMemberNameHistory as coreGetMemberNameHistory,
  updateMemberAliases as coreUpdateMemberAliases,
  mergeMembers as coreMergeMembers,
  deleteMember as coreDeleteMember,
  deleteMembers as coreDeleteMembers,
} from '@openchatlab/core'
import type { MemberWithAliases, MembersPaginationParams, MembersPaginatedResult } from '@openchatlab/core'
import type { SessionRuntimeAdapter } from './adapters'

export type { MemberWithAliases, MembersPaginationParams, MembersPaginatedResult }

export interface MembersPaginatedDTO {
  items: MemberWithAliases[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * Get all members with aliases for a session.
 */
export function getMembers(adapter: SessionRuntimeAdapter, sessionId: string): MemberWithAliases[] {
  const db = adapter.ensureReadonly(sessionId)
  return coreGetMembersWithAliases(db)
}

/**
 * Get paginated member list with search and sort.
 */
export function getMembersPaginated(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  params: MembersPaginationParams
): MembersPaginatedDTO {
  const db = adapter.ensureReadonly(sessionId)
  const result = coreGetMembersPaginated(db, params)
  return {
    items: result.members,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  }
}

/**
 * Update member aliases.
 * Uses core's updateMemberAliases which properly serializes the JSON array.
 */
export function updateMemberAliases(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  memberId: number,
  aliases: string[]
): boolean {
  const db = adapter.ensureWritable(sessionId)
  return coreUpdateMemberAliases(db, memberId, aliases)
}

/**
 * Merge two members using core semantics:
 * - Primary determined by message count (higher wins, lower id on tie)
 * - Merges aliases, avatar, account_name, group_nickname
 * - Reassigns messages and member_name_history
 * - Updates meta.owner_id if secondary was owner
 * - Runs in a transaction
 */
export function mergeMembers(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  memberId1: number,
  memberId2: number
): boolean {
  const db = adapter.ensureWritable(sessionId)
  return coreMergeMembers(db, memberId1, memberId2)
}

/**
 * Delete a member and all associated data:
 * - messages, member_name_history, member row (in transaction)
 */
export function deleteMember(adapter: SessionRuntimeAdapter, sessionId: string, memberId: number): boolean {
  const db = adapter.ensureWritable(sessionId)
  return coreDeleteMember(db, memberId)
}

/**
 * Delete multiple members and all associated data atomically.
 */
export function deleteMembers(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  memberIds: readonly number[]
): boolean {
  const db = adapter.ensureWritable(sessionId)
  return coreDeleteMembers(db, memberIds)
}

/**
 * Get member name change history.
 * Core prefers member_name_history and falls back to message-derived names for legacy sessions.
 */
export function getMemberNameHistory(adapter: SessionRuntimeAdapter, sessionId: string, memberId: number) {
  const db = adapter.ensureReadonly(sessionId)
  return coreGetMemberNameHistory(db, memberId)
}
