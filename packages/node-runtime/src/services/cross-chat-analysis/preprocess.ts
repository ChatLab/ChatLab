import { getNonSystemMembersForContacts, getSessionMeta } from '@openchatlab/core'
import type { CrossChatMessageSource, CrossChatRecentSessionSummary } from '@openchatlab/shared-types'
import type { PreprocessConfig } from '../../ai/preprocessor'
import { desensitizeText, matchesBlacklist, preprocessMessages } from '../../ai/preprocessor'
import type { SessionRuntimeAdapter } from '../adapters'

/**
 * Apply message cleaning per source session before cross-chat evidence reaches an LLM.
 * Session-qualified pseudonyms prevent unrelated local member IDs from being conflated across databases.
 */
export function preprocessCrossChatMessages(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  messages: CrossChatMessageSource[],
  config?: PreprocessConfig
): CrossChatMessageSource[] {
  const safeConfig = config ? { ...config, mergeConsecutive: false, anonymizeNames: false } : undefined
  const processed = preprocessMessages(
    messages.map((message) => ({ ...message })),
    safeConfig
  )
  if (!config?.anonymizeNames) return processed

  let ownerPlatformId: string | null = null
  try {
    const db = adapter.openReadonly(sessionId)
    ownerPlatformId = db ? getSessionMeta(db)?.ownerId?.trim() || null : null
  } catch {
    // Anonymization remains safe without owner labeling.
  }

  return processed.map((message) => ({
    ...message,
    senderName:
      ownerPlatformId && message.senderPlatformId === ownerPlatformId ? 'Owner' : `U${message.senderId}@${sessionId}`,
  }))
}

/** Apply the current privacy policy to persisted summaries before they reach an LLM. */
export function preprocessCrossChatSummaries(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  summaries: CrossChatRecentSessionSummary[],
  config?: PreprocessConfig
): CrossChatRecentSessionSummary[] {
  if (!config) return summaries.map(cloneSummary)

  const participantPseudonyms = config.anonymizeNames
    ? buildParticipantPseudonyms(
        adapter,
        sessionId,
        summaries.flatMap((summary) => summary.participants)
      )
    : null

  return summaries.flatMap((summary) => {
    if (matchesBlacklist(summary.summary, config.blacklistKeywords)) return []

    let safeSummary = config.desensitize ? desensitizeText(summary.summary, config.desensitizeRules) : summary.summary
    if (participantPseudonyms) {
      const anonymizedSummary = replaceKnownParticipantNames(safeSummary, participantPseudonyms)
      if (anonymizedSummary === null) return []
      safeSummary = anonymizedSummary
    }
    const participants = summary.participants
      .filter((participant) => !matchesBlacklist(participant, config.blacklistKeywords))
      .map((participant) => {
        if (participantPseudonyms) return participantPseudonyms.get(participant) ?? `Participant@${sessionId}`
        return config.desensitize ? desensitizeText(participant, config.desensitizeRules) : participant
      })
      .filter((participant, index, values) => participant.length > 0 && values.indexOf(participant) === index)

    return [{ ...summary, participants, summary: safeSummary }]
  })
}

/** Apply privacy settings to a model-visible structural label without changing its local source data. */
export function preprocessCrossChatLabel(value: string, pseudonym: string, config?: PreprocessConfig): string {
  if (!config) return value
  if (config.anonymizeNames || matchesBlacklist(value, config.blacklistKeywords)) return pseudonym
  return config.desensitize ? desensitizeText(value, config.desensitizeRules) : value
}

function cloneSummary(summary: CrossChatRecentSessionSummary): CrossChatRecentSessionSummary {
  return { ...summary, participants: [...summary.participants] }
}

function replaceKnownParticipantNames(summary: string, pseudonyms: Map<string, string>): string | null {
  const replacements = new Map<string, string>()
  for (const [participantName, pseudonym] of pseudonyms) {
    const trimmedName = participantName.trim()
    if (participantName) replacements.set(participantName, pseudonym)
    if (trimmedName) replacements.set(trimmedName, pseudonym)
  }
  if (replacements.size === 0) return summary

  const ambiguousLabels = new Set<string>()
  const alternatives = [...replacements.keys()]
    .sort((left, right) => Array.from(right).length - Array.from(left).length)
    .map((participantName) => {
      const escapedName = escapeRegExp(participantName)
      if (/^[\p{Script=Latin}\p{N}_]+$/u.test(participantName)) {
        return `(?<![\\p{Script=Latin}\\p{N}_])${escapedName}(?![\\p{Script=Latin}\\p{N}_])`
      }
      if (Array.from(participantName).length === 1 && /[\p{L}\p{N}]/u.test(participantName)) {
        ambiguousLabels.add(participantName)
        return `(?<![\\p{L}\\p{N}_])${escapedName}(?![\\p{L}\\p{N}_])`
      }
      return escapedName
    })

  // One alternation prevents overlapping nicknames from rewriting pseudonyms inserted earlier in the same pass.
  const pattern = new RegExp(alternatives.join('|'), 'gu')
  const anonymized = summary.replace(pattern, (participantName) => replacements.get(participantName) ?? participantName)
  // A one-character non-Latin name cannot be distinguished safely inside an unsegmented word. Dropping the cached
  // summary preserves both privacy and meaning; the recent-session tool can still answer from preprocessed messages.
  return [...ambiguousLabels].some((participantName) => anonymized.includes(participantName)) ? null : anonymized
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildParticipantPseudonyms(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  participantNames: string[]
): Map<string, string> {
  const pseudonyms = new Map<string, string>()
  const fallbackPseudonyms = new Map<string, string>()
  let ownerPlatformId: string | null = null
  let members: ReturnType<typeof getNonSystemMembersForContacts> = []

  try {
    const db = adapter.openReadonly(sessionId)
    if (db) {
      ownerPlatformId = getSessionMeta(db)?.ownerId?.trim() || null
      members = getNonSystemMembersForContacts(db)
    }
  } catch {
    // Unknown names still receive deterministic session-local pseudonyms below.
  }

  for (const participantName of participantNames) {
    if (pseudonyms.has(participantName)) continue
    const normalizedName = participantName.trim().toLocaleLowerCase()
    const matches = members.filter((member) =>
      [member.name, member.platformId, ...member.aliases].some(
        (candidate) => candidate.trim().toLocaleLowerCase() === normalizedName
      )
    )
    const uniqueMatches = [...new Map(matches.map((member) => [member.id, member])).values()]
    if (uniqueMatches.length === 1) {
      const member = uniqueMatches[0]
      pseudonyms.set(
        participantName,
        ownerPlatformId && member.platformId === ownerPlatformId ? 'Owner' : `U${member.id}@${sessionId}`
      )
      continue
    }

    let fallback = fallbackPseudonyms.get(normalizedName)
    if (!fallback) {
      fallback = `Participant${fallbackPseudonyms.size + 1}@${sessionId}`
      fallbackPseudonyms.set(normalizedName, fallback)
    }
    pseudonyms.set(participantName, fallback)
  }
  return pseudonyms
}
