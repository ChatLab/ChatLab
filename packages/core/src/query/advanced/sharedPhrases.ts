/**
 * Shared phrases of a private chat (platform-agnostic): expressions both participants used, counted in turns.
 *
 * Candidates come from the text messages of the two participants, in two channels: runs of 1–4 words from
 * Intl.Segmenter ("token") and 2–6 character substrings of Han runs ("han"). A phrase is shown when each participant
 * used it in at least one turn, in at least three turns together, across at least two time sessions. Ranking uses
 * sqrt(a*b) of the two turn counts, which is never returned; the list describes reuse, not what a phrase means.
 */

import { MessageType, type TimeFilter } from '@openchatlab/shared-types'
import type { DatabaseAdapter } from '../../interfaces'
import {
  TURN_RULE_VERSION,
  assignSessionIndexes,
  buildTurns,
  cleanText,
  compareMessageOrder,
  extractHanRuns,
  isMediaPlaceholderContent,
  isStopword,
  segmentWords,
  tokenizerIdentity,
  type WordToken,
} from '../../nlp'
import { buildTimeFilter } from '../filters'
import { resolvePrivateChatParticipants } from '../private-participants'
import { getSessionIndexStats } from '../session-queries'

export const SHARED_PHRASES_RULE_VERSION = 'shared-phrases-v1'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MIN_TURNS = 3
const MIN_SESSIONS = 2
const MAX_EXAMPLES = 3
const TOKEN_LENGTHS = { min: 1, max: 4 }
const HAN_LENGTHS = { min: 2, max: 6 }

const PURE_NUMBER_REGEX = /^\p{N}+$/u
const SINGLE_HAN_REGEX = /^\p{Script=Han}$/u
const LATIN_REGEX = /\p{Script=Latin}/u
const LETTER_REGEX = /\p{L}/gu

/** Separators inside the compact per-message views; neither can occur inside a word or a Han run. */
const RUN_BREAK = '\n'
const UNIT_BREAK = String.fromCharCode(1)

export interface SharedPhrasesParams {
  timeFilter?: TimeFilter
  /** Default 50, at most 200. */
  limit?: number
}

export interface SharedPhraseMemberUse {
  memberId: number
  turns: number
  firstMessageId: number
  firstTs: number
  /** At most 3 messages from different turns, in chronological order; the first is the first observed use. */
  exampleMessageIds: number[]
}

export interface SharedPhrase {
  phrase: string
  channels: Array<'token' | 'han'>
  sessions: number
  members: [SharedPhraseMemberUse, SharedPhraseMemberUse]
}

export interface SharedPhraseExampleMessage {
  id: number
  ts: number
  content: string
}

export type SharedPhrasesResult =
  | { available: false; reason: 'not_private_chat' | 'fewer_than_two_speakers' }
  | {
      available: true
      participants: Array<{ memberId: number; name: string; turns: number }>
      phrases: SharedPhrase[]
      /** Every message listed in `exampleMessageIds` of the returned phrases, in chronological order. */
      exampleMessages: SharedPhraseExampleMessage[]
      hasMore: boolean
      coverage: {
        startTs: number | null
        endTs: number | null
        textMessages: number
        excludedMessages: number
        turns: number
        sessions: number
      }
      rule: {
        version: string
        turnRuleVersion: string
        tokenizer: string
        sessionGapSeconds: number
        minTurns: typeof MIN_TURNS
        minSessions: typeof MIN_SESSIONS
      }
    }

interface MessageRow {
  id: number
  senderId: number
  ts: number
  type: number
  content: string | null
}

type Channel = 'token' | 'han'

/**
 * One text message reduced to two compact views, so a long chat stays small in memory; units are split out per run
 * when a pass needs them. `token`: runs of words joined by RUN_BREAK, words inside a run joined by UNIT_BREAK, every
 * word after the first carrying its separator (' ' or '') in front. `han`: NFC Han runs joined by RUN_BREAK.
 */
interface TextSource {
  /** Index into the loaded messages, which are in chronological order. */
  position: number
  /** 0 or 1: which participant wrote the message. */
  slot: number
  turn: number
  session: number
  token: string
  han: string
}

export function getSharedPhrases(db: DatabaseAdapter, params: SharedPhrasesParams = {}): SharedPhrasesResult {
  const resolved = resolvePrivateChatParticipants(db)
  if (!resolved.ok) return { available: false, reason: resolved.reason }
  const participants = resolved.participants
  const memberIds = participants.map((participant) => participant.memberId)

  // Both ends of the range are inclusive; a third sender's messages are never read.
  const range = buildTimeFilter({ startTs: params.timeFilter?.startTs, endTs: params.timeFilter?.endTs })
  const rows = db
    .prepare(
      `SELECT id, sender_id AS senderId, ts, type, content
       FROM message
       ${range.clause ? `${range.clause} AND` : 'WHERE'} sender_id IN (?, ?)
       ORDER BY ts ASC, id ASC`
    )
    .all(...range.params, ...memberIds) as unknown as MessageRow[]

  // Non-text messages still split turns and sessions.
  const sessionGapSeconds = getSessionIndexStats(db).gapThreshold
  const turns = buildTurns(rows)
  const sessionIndexes = assignSessionIndexes(rows, sessionGapSeconds)
  const turnOf = new Int32Array(rows.length)
  let position = 0
  for (const turn of turns) {
    turnOf.fill(turn.index, position, position + turn.messageIds.length)
    position += turn.messageIds.length
  }

  const sources: TextSource[] = []
  rows.forEach((row, index) => {
    if (row.type !== MessageType.TEXT || !row.content?.trim() || isMediaPlaceholderContent(row.content)) return
    const cleaned = cleanText(row.content)
    sources.push({
      position: index,
      slot: memberIds.indexOf(row.senderId),
      turn: turnOf[index],
      session: sessionIndexes[index],
      token: buildTokenView(cleaned),
      han: extractHanRuns(cleaned)
        .map((run) => run.text.normalize('NFC'))
        .join(RUN_BREAK),
    })
  })

  const tokenTexts = findRecurringTexts(sources, 'token', TOKEN_LENGTHS, isDisplayedTokenText)
  const hanTexts = findRecurringTexts(sources, 'han', HAN_LENGTHS, () => true)
  const occurrences = collectOccurrences(sources, tokenTexts, hanTexts)

  const candidates = dropNestedDuplicates(
    [...occurrences].map(([phrase, stats]) => {
      const channels: SharedPhrase['channels'] = []
      if (tokenTexts.has(phrase)) channels.push('token')
      if (hanTexts.has(phrase)) channels.push('han')
      const firstUses = stats.examples.map((examples) => rows[examples[0]])
      return {
        phrase,
        channels,
        stats,
        length: [...phrase].length,
        first: compareMessageOrder(firstUses[0], firstUses[1]) <= 0 ? firstUses[0] : firstUses[1],
      }
    })
  )
  const ranked = candidates
    .map((candidate) => ({ ...candidate, allStopwords: isAllStopwords(candidate.phrase, candidate.channels) }))
    .sort(
      (x, y) =>
        Number(x.allStopwords) - Number(y.allStopwords) ||
        // Same order as sqrt(a*b); the value itself is never returned.
        y.stats.turns[0] * y.stats.turns[1] - x.stats.turns[0] * x.stats.turns[1] ||
        y.length - x.length ||
        compareMessageOrder(x.first, y.first) ||
        (x.phrase < y.phrase ? -1 : x.phrase > y.phrase ? 1 : 0)
    )
  const limit = normalizeLimit(params.limit)
  const shown = ranked.slice(0, limit)

  const phrases = shown.map(
    ({ phrase, channels, stats }): SharedPhrase => ({
      phrase,
      channels,
      sessions: stats.sessions,
      members: [0, 1].map((slot) => ({
        memberId: memberIds[slot],
        turns: stats.turns[slot],
        firstMessageId: rows[stats.examples[slot][0]].id,
        firstTs: rows[stats.examples[slot][0]].ts,
        exampleMessageIds: stats.examples[slot].map((index) => rows[index].id),
      })) as [SharedPhraseMemberUse, SharedPhraseMemberUse],
    })
  )
  const exampleRows = [...new Set(shown.flatMap(({ stats }) => stats.examples.flat()))]
    .map((index) => rows[index])
    .sort(compareMessageOrder)

  return {
    available: true,
    participants: participants.map((participant) => ({
      memberId: participant.memberId,
      name: participant.name,
      turns: turns.filter((turn) => turn.senderId === participant.memberId).length,
    })),
    phrases,
    exampleMessages: exampleRows.map((row) => ({ id: row.id, ts: row.ts, content: row.content ?? '' })),
    hasMore: ranked.length > limit,
    coverage: {
      startTs: rows[0]?.ts ?? null,
      endTs: rows.at(-1)?.ts ?? null,
      textMessages: sources.length,
      excludedMessages: rows.length - sources.length,
      turns: turns.length,
      sessions: sessionIndexes.length > 0 ? sessionIndexes[sessionIndexes.length - 1] + 1 : 0,
    },
    rule: {
      version: SHARED_PHRASES_RULE_VERSION,
      turnRuleVersion: TURN_RULE_VERSION,
      tokenizer: tokenizerIdentity(),
      sessionGapSeconds,
      minTurns: MIN_TURNS,
      minSessions: MIN_SESSIONS,
    },
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT)
}

/**
 * Chinese words are joined directly, so they must touch in the cleaned text to stay in one run; a Latin word is
 * joined with one space, so one space may separate it from its neighbour. Anything cleanText replaced with a space
 * (punctuation, URL, mention, emoji) therefore ends a run between Chinese words.
 */
function buildTokenView(cleaned: string): string {
  let view = ''
  let previous: WordToken | undefined
  for (const token of segmentWords(cleaned)) {
    if (previous) {
      const gap = cleaned.slice(previous.end, token.start)
      const latin = previous.script === 'latin' || token.script === 'latin'
      view += gap === '' || (gap === ' ' && latin) ? UNIT_BREAK + (latin ? ' ' : '') : RUN_BREAK
    }
    view += token.norm
    previous = token
  }
  return view
}

/** Single Han characters, Latin words with fewer than two letters and pure numbers are counted but never shown. */
function isDisplayedTokenText(text: string, length: number): boolean {
  if (PURE_NUMBER_REGEX.test(text.replaceAll(' ', ''))) return false
  if (length > 1) return true
  if (SINGLE_HAN_REGEX.test(text)) return false
  return !LATIN_REGEX.test(text) || (text.match(LETTER_REGEX)?.length ?? 0) >= 2
}

/** The units of each run of one channel: words with their leading separator, or Han code points. */
function runsOf(source: TextSource, channel: Channel): string[][] {
  const view = source[channel]
  if (view === '') return []
  return view.split(RUN_BREAK).map((run) => (channel === 'token' ? run.split(UNIT_BREAK) : [...run]))
}

/** The text of `length` units from `start`; the first unit's leading separator is dropped. */
function gramAt(units: string[], start: number, length: number): string {
  let text = units[start].startsWith(' ') ? units[start].slice(1) : units[start]
  for (let offset = 1; offset < length; offset++) text += units[start + offset]
  return text
}

/** Counts turn presence; occurrences must arrive in chronological order. */
class TurnPresence {
  readonly turns = [0, 0]
  sessions = 0
  private lastTurn = -1
  private lastSession = -1

  /** Returns whether the occurrence opened a turn that was not counted yet. */
  add(source: TextSource): boolean {
    if (source.session !== this.lastSession) {
      this.lastSession = source.session
      this.sessions++
    }
    if (source.turn === this.lastTurn) return false
    this.lastTurn = source.turn
    this.turns[source.slot]++
    return true
  }

  passesGate(): boolean {
    const [a, b] = this.turns
    return a >= 1 && b >= 1 && a + b >= MIN_TURNS && this.sessions >= MIN_SESSIONS
  }
}

class PhraseOccurrences extends TurnPresence {
  /** Hash of the turn indexes the phrase occurs in; with equal counts it identifies an identical occurrence set. */
  hash = 0
  /** Loaded-message indexes per participant, one per turn. */
  readonly examples: [number[], number[]] = [[], []]

  record(source: TextSource): void {
    if (!this.add(source)) return
    this.hash = mixTurn(this.hash, source.turn)
    const examples = this.examples[source.slot]
    if (examples.length < MAX_EXAMPLES) examples.push(source.position)
  }
}

function mixTurn(hash: number, turn: number): number {
  let h = Math.imul(hash ^ (turn + 0x9e3779b9), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return h ^ (h >>> 16)
}

/**
 * Texts of one channel that pass the display gate, counted length by length: a phrase of length k is only counted
 * where its prefix and suffix of length k - 1 both passed, which cannot drop a passing phrase because each occurrence
 * of it contains both. Texts rejected by `isShown` still take part in that pruning.
 */
function findRecurringTexts(
  sources: TextSource[],
  channel: Channel,
  lengths: { min: number; max: number },
  isShown: (text: string, length: number) => boolean
): Set<string> {
  const shown = new Set<string>()
  let passed: Set<string> | undefined
  for (let length = lengths.min; length <= lengths.max; length++) {
    const counts = new Map<string, TurnPresence>()
    for (const source of sources) {
      for (const units of runsOf(source, channel)) {
        let previousPrefix: string | undefined
        for (let start = 0; start + length <= units.length; start++) {
          let text: string
          if (passed) {
            // The suffix of this position is the prefix of the next one, so each shorter text is built once.
            const prefix = previousPrefix ?? gramAt(units, start, length - 1)
            const suffix = gramAt(units, start + 1, length - 1)
            previousPrefix = suffix
            if (!passed.has(prefix) || !passed.has(suffix)) continue
            text = prefix + units[start + length - 1]
          } else {
            text = gramAt(units, start, length)
          }
          let presence = counts.get(text)
          if (!presence) counts.set(text, (presence = new TurnPresence()))
          presence.add(source)
        }
      }
    }
    passed = new Set<string>()
    for (const [text, presence] of counts) {
      if (!presence.passesGate()) continue
      passed.add(text)
      if (isShown(text, length)) shown.add(text)
    }
    if (passed.size === 0) break
  }
  return shown
}

/**
 * Exact turn presence of the recurring texts, keyed by text across both channels and all run lengths: the same text
 * written with a different word segmentation, or produced by both channels, counts once per turn.
 */
function collectOccurrences(
  sources: TextSource[],
  tokenTexts: Set<string>,
  hanTexts: Set<string>
): Map<string, PhraseOccurrences> {
  const occurrences = new Map<string, PhraseOccurrences>()
  const channels: Array<[Channel, Set<string>, { min: number; max: number }]> = [
    ['token', tokenTexts, TOKEN_LENGTHS],
    ['han', hanTexts, HAN_LENGTHS],
  ]
  for (const source of sources) {
    for (const [channel, texts, lengths] of channels) {
      if (texts.size === 0) continue
      for (const units of runsOf(source, channel)) {
        for (let start = 0; start < units.length; start++) {
          let text = ''
          for (let length = 1; length <= lengths.max && start + length <= units.length; length++) {
            text = length === 1 ? gramAt(units, start, 1) : text + units[start + length - 1]
            if (length < lengths.min || !texts.has(text)) continue
            let phrase = occurrences.get(text)
            if (!phrase) occurrences.set(text, (phrase = new PhraseOccurrences()))
            phrase.record(source)
          }
        }
      }
    }
  }
  return occurrences
}

/** Among phrases with the same occurrence set, a phrase contained in a longer one is dropped. */
function dropNestedDuplicates<T extends { phrase: string; length: number; stats: PhraseOccurrences }>(
  candidates: T[]
): T[] {
  const groups = new Map<string, T[]>()
  for (const candidate of candidates) {
    const { turns, sessions, hash } = candidate.stats
    const key = `${turns[0]}:${turns[1]}:${sessions}:${hash}`
    const group = groups.get(key)
    if (group) group.push(candidate)
    else groups.set(key, [candidate])
  }
  const kept: T[] = []
  for (const group of groups.values()) {
    const survivors: T[] = []
    for (const candidate of group.sort((x, y) => y.length - x.length)) {
      if (!survivors.some((longer) => longer.phrase.includes(candidate.phrase))) survivors.push(candidate)
    }
    kept.push(...survivors)
  }
  return kept
}

/** Every word is a stopword for its script, or a Han-channel phrase is itself a stopword. */
function isAllStopwords(phrase: string, channels: SharedPhrase['channels']): boolean {
  if (channels.includes('han') && isStopword(phrase, 'zh-CN')) return true
  return segmentWords(phrase).every((word) => isStopword(word.norm, word.script === 'latin' ? 'en-US' : 'zh-CN'))
}
