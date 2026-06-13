/**
 * Shared owner profile service.
 *
 * Manages the platform-level "who am I" identity: writes per-session
 * meta.owner_id, maintains ownerProfilesByPlatform in preferences.json, and
 * applies a confirmed profile to other unowned sessions of the same platform.
 * Used by both CLI Web routes and Electron IPC.
 */

import {
  getSessionMeta,
  getMembersWithAliases,
  isChatSessionDb,
  updateSessionOwnerId as coreUpdateSessionOwnerId,
  matchOwnerProfile,
  mergeConfirmedNames,
  isNameMatchPlatform,
} from '@openchatlab/core'
import type { MemberWithAliases } from '@openchatlab/core'
import type {
  OwnerProfile,
  ApplyOwnerProfileReason,
  ApplyOwnerProfileResult,
  SetOwnerAndApplyProfileResult,
} from '@openchatlab/shared-types'
import type { PreferencesManager } from '../preferences'
import type { SessionRuntimeAdapter } from './adapters'

export type { ApplyOwnerProfileReason, ApplyOwnerProfileResult, SetOwnerAndApplyProfileResult }

function memberDisplayName(member: MemberWithAliases): string {
  return member.groupNickname || member.accountName || member.platformId
}

function isDismissed(preferences: PreferencesManager, sessionId: string): boolean {
  return preferences.load().ownerPromptDismissedSessionIds.includes(sessionId)
}

/**
 * Try to apply the stored platform owner profile to one session.
 * Writes meta.owner_id only on a unique (exact or name) match.
 * Never overrides an existing owner.
 */
export function tryApplyOwnerProfile(
  adapter: SessionRuntimeAdapter,
  preferences: PreferencesManager,
  sessionId: string
): ApplyOwnerProfileResult {
  const dismissed = isDismissed(preferences, sessionId)

  const db = adapter.openReadonly(sessionId)
  if (!db || !isChatSessionDb(db)) {
    return { applied: false, reason: 'missing_session', dismissed }
  }
  const meta = getSessionMeta(db)
  if (!meta) {
    return { applied: false, reason: 'missing_session', dismissed }
  }
  if (meta.ownerId) {
    return { applied: false, ownerId: meta.ownerId, reason: 'already_set', dismissed }
  }

  const profile = preferences.load().ownerProfilesByPlatform[meta.platform]
  if (!profile) {
    return { applied: false, reason: 'no_profile', dismissed }
  }

  const result = matchOwnerProfile(meta.platform, profile, getMembersWithAliases(db))
  if (result.type === 'exact' || result.type === 'name') {
    const writable = adapter.ensureWritable(sessionId)
    coreUpdateSessionOwnerId(writable, result.platformId)
    return { applied: true, ownerId: result.platformId, dismissed }
  }
  return { applied: false, reason: result.type === 'ambiguous' ? 'ambiguous' : 'no_match', dismissed }
}

/**
 * Manually set the owner of one session, update the platform profile, and
 * batch-apply the profile to other unowned sessions of the same platform.
 *
 * Re-selecting the same identity merges new names into confirmedNames;
 * selecting a different member replaces the profile (names start fresh,
 * so the previous person's names cannot cause wrong matches).
 */
export function setOwnerAndApplyProfile(
  adapter: SessionRuntimeAdapter,
  preferences: PreferencesManager,
  sessionId: string,
  ownerPlatformId: string
): SetOwnerAndApplyProfileResult {
  const db = adapter.ensureWritable(sessionId)
  const meta = getSessionMeta(db)
  if (!meta) {
    throw Object.assign(new Error(`Session has no meta: ${sessionId}`), { statusCode: 404 })
  }

  const members = getMembersWithAliases(db)
  const selected = members.find((m) => m.platformId === ownerPlatformId)
  if (!selected) {
    throw Object.assign(new Error(`Member not found in session: ${ownerPlatformId}`), { statusCode: 400 })
  }

  coreUpdateSessionOwnerId(db, ownerPlatformId)

  const prefs = preferences.load()
  const existing = prefs.ownerProfilesByPlatform[meta.platform]
  const baseNames = existing && existing.platformId === ownerPlatformId ? existing.confirmedNames : []
  const profile: OwnerProfile = {
    platformId: ownerPlatformId,
    displayName: memberDisplayName(selected),
    confirmedNames: mergeConfirmedNames(baseNames, { ...selected, displayName: memberDisplayName(selected) }),
    matchMode: isNameMatchPlatform(meta.platform) ? 'name' : 'platform_id',
    updatedAt: Date.now(),
  }

  const updatedSessions = applyProfileToOtherSessions(adapter, meta.platform, profile, sessionId)
  const updatedSessionIds = updatedSessions.map((s) => s.id)
  const updatedSessionOwnerIds: Record<string, string> = {}
  for (const s of updatedSessions) {
    updatedSessionOwnerIds[s.id] = s.ownerId
  }

  const noLongerDismissed = new Set([sessionId, ...updatedSessionIds])
  preferences.save({
    ownerProfilesByPlatform: { ...prefs.ownerProfilesByPlatform, [meta.platform]: profile },
    ownerPromptDismissedSessionIds: prefs.ownerPromptDismissedSessionIds.filter((id) => !noLongerDismissed.has(id)),
  })

  return { sessionId, platform: meta.platform, ownerId: ownerPlatformId, updatedSessionIds, updatedSessionOwnerIds }
}

/**
 * Apply a profile to all other unowned sessions of the same platform.
 * Unique match only; sessions with an existing owner are never touched.
 * Returns the id and the actual platformId written for each updated session
 * (may differ from profile.platformId on name-match platforms).
 */
function applyProfileToOtherSessions(
  adapter: SessionRuntimeAdapter,
  platform: string,
  profile: OwnerProfile,
  excludeSessionId: string
): Array<{ id: string; ownerId: string }> {
  const updated: Array<{ id: string; ownerId: string }> = []
  for (const id of adapter.listSessionIds()) {
    if (id === excludeSessionId) continue
    try {
      const db = adapter.openReadonly(id)
      if (!db || !isChatSessionDb(db)) continue
      const meta = getSessionMeta(db)
      if (!meta || meta.platform !== platform || meta.ownerId) continue

      const result = matchOwnerProfile(platform, profile, getMembersWithAliases(db))
      if (result.type === 'exact' || result.type === 'name') {
        coreUpdateSessionOwnerId(adapter.ensureWritable(id), result.platformId)
        updated.push({ id, ownerId: result.platformId })
      }
    } catch (err) {
      console.warn(`[OwnerProfile] Failed to apply profile to session ${id}:`, err)
    }
  }
  return updated
}

/**
 * Suppress the owner prompt for one session. UI-only: does not imply owner
 * knowledge and does not block later automatic profile application.
 */
export function dismissOwnerPrompt(preferences: PreferencesManager, sessionId: string): void {
  const prefs = preferences.load()
  if (prefs.ownerPromptDismissedSessionIds.includes(sessionId)) return
  preferences.save({
    ownerPromptDismissedSessionIds: [...prefs.ownerPromptDismissedSessionIds, sessionId],
  })
}

/**
 * Clear the owner of one session only. The platform profile is kept and may
 * re-apply automatically later if it still uniquely matches.
 */
export function clearSessionOwner(adapter: SessionRuntimeAdapter, sessionId: string): void {
  const db = adapter.ensureWritable(sessionId)
  coreUpdateSessionOwnerId(db, null)
}
