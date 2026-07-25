const SECONDS_PER_MINUTE = 60
const DEFAULT_DEMO_TIME_ZONE_OFFSET_MINUTES = 8 * 60
const MAX_TIME_ZONE_OFFSET_MINUTES = 14 * 60

interface ChatLabDemoTimeline {
  timeZoneOffsetMinutes?: unknown
}

interface ChatLabDemoHeader extends Record<string, unknown> {
  exportedAt: number
  demoTimeline?: ChatLabDemoTimeline
}

interface ChatLabDemoMessage extends Record<string, unknown> {
  timestamp: number
}

interface ChatLabDemoDocument extends Record<string, unknown> {
  chatlab: ChatLabDemoHeader
  messages: ChatLabDemoMessage[]
}

export interface RebasedChatLabDemoDocuments {
  documents: string[]
  offsetSeconds: number
  sourceLatestTimestamp: number
  latestTimestamp: number
}

/**
 * Rebase official Demo documents as one timeline so their latest message falls
 * on yesterday in the importing user's local calendar.
 *
 * The same offset is applied to every document. This preserves message
 * intervals and keeps the group/private story lines aligned.
 */
export function rebaseChatLabDemoDocuments(
  jsonDocuments: readonly string[],
  now: Date = new Date(),
  targetTimeZone?: string
): RebasedChatLabDemoDocuments {
  if (jsonDocuments.length === 0) throw new Error('Demo timeline requires at least one document')
  if (!Number.isFinite(now.getTime())) throw new Error('Demo timeline requires a valid import time')

  const documents = jsonDocuments.map((json, index) => parseDemoDocument(json, index))
  const timeZoneOffsetMinutes = resolveTimeZoneOffsetMinutes(documents)
  const sourceLatestTimestamp = Math.max(
    ...documents.flatMap((document) => document.messages.map((message) => message.timestamp))
  )

  // Restore the source wall-clock time before mapping it to yesterday in the user's local calendar.
  const sourceLatestWallTime = new Date((sourceLatestTimestamp + timeZoneOffsetMinutes * SECONDS_PER_MINUTE) * 1000)
  const latestTimestamp = resolveTargetLatestTimestamp(now, sourceLatestWallTime, targetTimeZone)
  const offsetSeconds = latestTimestamp - sourceLatestTimestamp
  const exportedAt = Math.floor(now.getTime() / 1000)

  for (const document of documents) {
    document.chatlab.exportedAt = exportedAt
    for (const message of document.messages) {
      message.timestamp += offsetSeconds
    }
  }

  return {
    documents: documents.map((document) => JSON.stringify(document)),
    offsetSeconds,
    sourceLatestTimestamp,
    latestTimestamp,
  }
}

function resolveTargetLatestTimestamp(now: Date, sourceWallTime: Date, targetTimeZone?: string): number {
  if (!targetTimeZone) {
    const targetLatestTime = new Date(now)
    targetLatestTime.setDate(targetLatestTime.getDate() - 1)
    targetLatestTime.setHours(
      sourceWallTime.getUTCHours(),
      sourceWallTime.getUTCMinutes(),
      sourceWallTime.getUTCSeconds(),
      0
    )
    return Math.floor(targetLatestTime.getTime() / 1000)
  }

  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: targetTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
  } catch {
    throw new Error('Demo timeline has an invalid target time zone')
  }

  const currentDate = getZonedDateTimeParts(now, formatter)
  const yesterday = new Date(Date.UTC(currentDate.year, currentDate.month - 1, currentDate.day - 1))
  const targetParts: ZonedDateTimeParts = {
    year: yesterday.getUTCFullYear(),
    month: yesterday.getUTCMonth() + 1,
    day: yesterday.getUTCDate(),
    hour: sourceWallTime.getUTCHours(),
    minute: sourceWallTime.getUTCMinutes(),
    second: sourceWallTime.getUTCSeconds(),
  }

  return Math.floor(zonedWallTimeToUnixMillis(targetParts, formatter) / 1000)
}

interface ZonedDateTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function getZonedDateTimeParts(date: Date, formatter: Intl.DateTimeFormat): ZonedDateTimeParts {
  const values = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  const read = (type: keyof ZonedDateTimeParts) => Number(values.get(type))
  const parts: ZonedDateTimeParts = {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
  if (Object.values(parts).some((value) => !Number.isInteger(value))) {
    throw new Error('Demo timeline could not resolve the target time zone')
  }
  return parts
}

function zonedWallTimeToUnixMillis(target: ZonedDateTimeParts, formatter: Intl.DateTimeFormat): number {
  const targetAsUtc = dateTimePartsToUtcMillis(target)
  let candidate = targetAsUtc

  // Intl maps timestamps to zoned wall-clock time; iterative corrections resolve the inverse mapping.
  for (let attempt = 0; attempt < 3; attempt++) {
    const actual = getZonedDateTimeParts(new Date(candidate), formatter)
    const correction = targetAsUtc - dateTimePartsToUtcMillis(actual)
    candidate += correction
    if (correction === 0) return candidate
  }

  const actual = getZonedDateTimeParts(new Date(candidate), formatter)
  if (dateTimePartsToUtcMillis(actual) !== targetAsUtc) {
    throw new Error('Demo timeline target wall time does not exist in the selected time zone')
  }
  return candidate
}

function dateTimePartsToUtcMillis(parts: ZonedDateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
}

function parseDemoDocument(json: string, index: number): ChatLabDemoDocument {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new Error(`Demo document ${index + 1} is not valid JSON`)
  }

  if (!isRecord(value) || !isRecord(value.chatlab) || !Array.isArray(value.messages)) {
    throw new Error(`Demo document ${index + 1} is not a ChatLab JSON document`)
  }
  if (value.messages.length === 0) {
    throw new Error(`Demo document ${index + 1} has no messages`)
  }

  const messages = value.messages.map((message, messageIndex) => {
    if (!isRecord(message) || !isUnixSeconds(message.timestamp)) {
      throw new Error(`Demo document ${index + 1} has an invalid timestamp at message ${messageIndex + 1}`)
    }
    return message as ChatLabDemoMessage
  })

  return {
    ...value,
    chatlab: value.chatlab as ChatLabDemoHeader,
    messages,
  }
}

function resolveTimeZoneOffsetMinutes(documents: readonly ChatLabDemoDocument[]): number {
  const offsets = new Set<number>()

  for (const document of documents) {
    const configured = document.chatlab.demoTimeline?.timeZoneOffsetMinutes
    const offset = configured ?? DEFAULT_DEMO_TIME_ZONE_OFFSET_MINUTES
    if (typeof offset !== 'number' || !Number.isInteger(offset) || Math.abs(offset) > MAX_TIME_ZONE_OFFSET_MINUTES) {
      throw new Error('Demo timeline has an invalid time zone offset')
    }
    offsets.add(offset)
  }

  if (offsets.size !== 1) {
    throw new Error('Demo documents must use the same time zone offset')
  }
  return offsets.values().next().value as number
}

function isUnixSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
