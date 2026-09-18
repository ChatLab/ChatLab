/**
 * Text units shared by private-chat measurements (pure functions, no database access, Node and browser).
 *
 * Chronology is the timestamp, with the message id only breaking ties inside one second: an auto-increment id does
 * not establish order once an older export is imported after a newer one. Turns and time sessions are derived from
 * that order, and words come from Intl.Segmenter, whose output depends on the runtime's ICU data.
 */

export const TURN_RULE_VERSION = 'turns-v1'
export const TURN_GAP_SECONDS = 300
export const DEFAULT_SESSION_GAP_SECONDS = 1800

/** Timestamp first, then id; the id only decides the order of messages sent in the same second. */
export function compareMessageOrder(a: { id: number; ts: number }, b: { id: number; ts: number }): number {
  return a.ts - b.ts || a.id - b.id
}

export interface TextUnitMessage {
  id: number
  senderId: number
  ts: number
}

export interface Turn {
  index: number
  senderId: number
  startTs: number
  endTs: number
  messageIds: number[]
}

/**
 * Consecutive messages from one sender form a turn. A new turn starts when the sender changes or the gap to the
 * previous message is greater than `gapSeconds`. The input must already be sorted with compareMessageOrder.
 */
export function buildTurns(messages: readonly TextUnitMessage[], gapSeconds = TURN_GAP_SECONDS): Turn[] {
  const turns: Turn[] = []
  let current: Turn | undefined
  for (const message of messages) {
    if (!current || message.senderId !== current.senderId || message.ts - current.endTs > gapSeconds) {
      current = {
        index: turns.length,
        senderId: message.senderId,
        startTs: message.ts,
        endTs: message.ts,
        messageIds: [message.id],
      }
      turns.push(current)
    } else {
      current.endTs = message.ts
      current.messageIds.push(message.id)
    }
  }
  return turns
}

/**
 * Time sessions: a new session starts when the gap to the previous message is greater than `gapSeconds`.
 * Returns the zero-based session index of each message, in input order. The input must be sorted.
 */
export function assignSessionIndexes(
  messages: readonly TextUnitMessage[],
  gapSeconds = DEFAULT_SESSION_GAP_SECONDS
): number[] {
  const indexes: number[] = []
  let session = 0
  for (let i = 0; i < messages.length; i++) {
    if (i > 0 && messages[i].ts - messages[i - 1].ts > gapSeconds) session++
    indexes.push(session)
  }
  return indexes
}

export interface WordToken {
  /** The word as it appears in the input, `text === input.slice(start, end)`. */
  text: string
  /** NFC with Latin letters lower-cased; the form phrases are compared in. */
  norm: string
  start: number
  end: number
  script: 'han' | 'latin' | 'other'
}

const HAN_ONLY_REGEX = /^\p{Script=Han}+$/u
const HAN_CHAR_REGEX = /\p{Script=Han}/u
const LATIN_CHAR_REGEX = /\p{Script=Latin}/u
const LATIN_RUN_REGEX = /\p{Script=Latin}+/gu
const HAN_RUN_REGEX = /\p{Script=Han}+/gu
const FALLBACK_WORD_REGEX = /[\p{L}\p{N}]+/gu

let cachedSegmenter: Intl.Segmenter | undefined

/** Checked on every call so a runtime without Intl.Segmenter always takes the regex path. */
function getWordSegmenter(): Intl.Segmenter | undefined {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return undefined
  cachedSegmenter ??= new Intl.Segmenter('zh', { granularity: 'word' })
  return cachedSegmenter
}

/**
 * Word-like segments of `Intl.Segmenter('zh', { granularity: 'word' })`, with offsets into `text`.
 * Falls back to segmentWordsWithRegex when the runtime has no Intl.Segmenter.
 */
export function segmentWords(text: string): WordToken[] {
  const segmenter = getWordSegmenter()
  if (!segmenter) return segmentWordsWithRegex(text)
  const tokens: WordToken[] = []
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) tokens.push(createWordToken(segment.segment, segment.index))
  }
  return tokens
}

/** The `[\p{L}\p{N}]+` rule segmentWords uses without Intl.Segmenter; exported so the fallback is testable alone. */
export function segmentWordsWithRegex(text: string): WordToken[] {
  return Array.from(text.matchAll(FALLBACK_WORD_REGEX), (match) => createWordToken(match[0], match.index))
}

function createWordToken(text: string, start: number): WordToken {
  return {
    text,
    norm: text.normalize('NFC').replace(LATIN_RUN_REGEX, (run) => run.toLowerCase()),
    start,
    end: start + text.length,
    script: HAN_ONLY_REGEX.test(text)
      ? 'han'
      : LATIN_CHAR_REGEX.test(text) && !HAN_CHAR_REGEX.test(text)
        ? 'latin'
        : 'other',
  }
}

/** Maximal runs of Han characters (`\p{Script=Han}`); `start` is the offset into `text`. */
export function extractHanRuns(text: string): Array<{ text: string; start: number }> {
  return Array.from(text.matchAll(HAN_RUN_REGEX), (match) => ({ text: match[0], start: match.index }))
}

/**
 * Identifies the segmentation a result was produced with: `intl-segmenter/icu-<version>` in Node,
 * `intl-segmenter/browser` where the ICU version is not exposed, `regex-fallback` without Intl.Segmenter.
 */
export function tokenizerIdentity(): string {
  if (!getWordSegmenter()) return 'regex-fallback'
  const icu = (globalThis as { process?: { versions?: { icu?: string } } }).process?.versions?.icu
  return icu ? `intl-segmenter/icu-${icu}` : 'intl-segmenter/browser'
}
