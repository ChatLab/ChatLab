/**
 * Owner profile matching — platform-independent "who am I" resolution.
 *
 * Given a platform-level owner profile (stored in preferences) and the member
 * list of a session, decide which member is the owner. Matching is strictly
 * deterministic: exact platformId first, then normalized-name equality for an
 * allowlisted set of platforms whose exports lack stable native IDs.
 * No fuzzy matching, no heuristics, no LLM inference.
 */

import type { OwnerProfile } from '@openchatlab/shared-types'

/**
 * Platforms whose text exports use display names as platformId, so a
 * normalized-name fallback is safe and necessary. All other platforms
 * (including 'unknown') match by exact platformId only.
 */
export const NAME_MATCH_PLATFORMS: ReadonlySet<string> = new Set(['whatsapp', 'line', 'instagram'])

export function isNameMatchPlatform(platform: string): boolean {
  return NAME_MATCH_PLATFORMS.has(platform)
}

/** Minimal member shape needed for owner matching. */
export interface OwnerMatchCandidate {
  platformId: string
  accountName?: string | null
  groupNickname?: string | null
  aliases?: string[] | null
  /** Computed display name, if the caller already derived one. */
  displayName?: string | null
}

export type OwnerMatchResult =
  | { type: 'exact'; platformId: string }
  | { type: 'name'; platformId: string }
  | { type: 'none' }
  | { type: 'ambiguous'; platformIds: string[] }

// Invisible direction/control characters that chat exports commonly embed
// around names (LRM/RLM, directional embeddings/isolates, zero-width chars, BOM).
const INVISIBLE_CHARS_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

/**
 * Deterministic name normalization for matching:
 * strip invisible chars → NFKC → collapse whitespace → trim → lowercase.
 * Stored names keep their original form; normalize only at compare time.
 */
export function normalizeOwnerName(name: string): string {
  return name.replace(INVISIBLE_CHARS_RE, '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Collect all candidate name strings of a member (original, non-normalized, deduped, non-empty). */
export function collectCandidateNames(member: OwnerMatchCandidate): string[] {
  const names = [
    member.platformId,
    member.accountName ?? '',
    member.groupNickname ?? '',
    ...(member.aliases ?? []),
    member.displayName ?? '',
  ]
  const result: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (!name || !name.trim()) continue
    if (seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

/**
 * Merge a member's candidate names into an existing confirmedNames list.
 * Keeps original strings; dedupes by exact string equality, preserving order.
 */
export function mergeConfirmedNames(existing: string[], member: OwnerMatchCandidate): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const name of [...existing, ...collectCandidateNames(member)]) {
    if (!name || !name.trim()) continue
    if (seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

/**
 * Match a platform owner profile against a session's members.
 *
 * 1. Exact platformId match wins immediately.
 * 2. Name fallback only for NAME_MATCH_PLATFORMS: a member matches when any
 *    of its normalized candidate names equals any normalized confirmed name.
 * 3. Exactly one member must match; zero → none, multiple → ambiguous.
 */
export function matchOwnerProfile(
  platform: string,
  profile: OwnerProfile,
  members: OwnerMatchCandidate[]
): OwnerMatchResult {
  const exact = members.find((m) => m.platformId === profile.platformId)
  if (exact) {
    return { type: 'exact', platformId: exact.platformId }
  }

  if (!isNameMatchPlatform(platform)) {
    return { type: 'none' }
  }

  const confirmed = new Set(profile.confirmedNames.map(normalizeOwnerName).filter((n) => n.length > 0))
  if (confirmed.size === 0) {
    return { type: 'none' }
  }

  const matched = members.filter((m) =>
    collectCandidateNames(m).some((name) => confirmed.has(normalizeOwnerName(name)))
  )

  if (matched.length === 1) {
    return { type: 'name', platformId: matched[0].platformId }
  }
  if (matched.length > 1) {
    return { type: 'ambiguous', platformIds: matched.map((m) => m.platformId) }
  }
  return { type: 'none' }
}
