import { createHash } from 'node:crypto'
import type { ChatTopic, ChatTopicEvidence } from '@openchatlab/shared-types'
import type { TopicSourceMessage } from './source'

const TOPIC_RANGE_GAP_SECONDS = 60 * 60

export interface TopicLedgerItem {
  id: string
  title: string
  summary: string
  state: 'active' | 'closed'
  evidence: ChatTopicEvidence[]
  messageIds: number[]
}

export interface TopicLedger {
  topics: TopicLedgerItem[]
}

export type TopicModelOperation =
  | {
      operation: 'create'
      localId: string
      title: string
      summary: string
      state: 'active' | 'closed'
      evidence: ChatTopicEvidence[]
    }
  | {
      operation: 'append'
      topicId: string
      title?: string
      summary: string
      evidence: ChatTopicEvidence[]
    }
  | {
      operation: 'merge'
      targetTopicId: string
      sourceTopicIds: string[]
      title: string
      summary: string
      state: 'active' | 'closed'
      evidence: ChatTopicEvidence[]
    }
  | {
      operation: 'close' | 'reopen'
      topicId: string
      title?: string
      summary?: string
      evidence: ChatTopicEvidence[]
    }

export interface TopicMessageAssignment {
  topicRef: string
  messageIds: number[]
}

export interface TopicModelBlockResponse {
  operations: TopicModelOperation[]
  assignments: TopicMessageAssignment[]
}

export interface TopicFinalization {
  overview: string
  topics: Array<{
    id: string
    title: string
    summary: string
    state: 'active' | 'closed'
  }>
}

export function createEmptyTopicLedger(): TopicLedger {
  return { topics: [] }
}

export function applyTopicOperations(
  ledger: TopicLedger,
  response: TopicModelBlockResponse,
  context: {
    sessionId: string
    dayKey: string
    localIdNamespace: string
    currentMessages: TopicSourceMessage[]
  }
): TopicLedger {
  const next = cloneLedger(ledger)
  const currentMessageIds = new Set(context.currentMessages.map((message) => message.id))
  const currentMessagesById = new Map(context.currentMessages.map((message) => [message.id, message]))
  const localTopicIds = new Map<string, string>()
  const mergedTopicIds = new Map<string, string>()
  const assignedTopicsByMessageId = new Map<number, string>()

  for (const operation of response.operations) {
    validateNewEvidence(operation.evidence, currentMessageIds)
    const evidence = operation.evidence.map((item) => ({
      ...item,
      timestamp: currentMessagesById.get(item.messageId)!.timestamp,
    }))
    if (operation.operation === 'create') {
      if (evidence.length === 0) throw new Error('A new topic must cite at least one current message')
      const id = createCanonicalTopicId(context.sessionId, context.dayKey, context.localIdNamespace, operation.localId)
      if (next.topics.some((topic) => topic.id === id)) throw new Error(`Topic already exists: ${id}`)
      if (localTopicIds.has(operation.localId)) throw new Error(`Duplicate local topic id: ${operation.localId}`)
      next.topics.push({
        id,
        title: operation.title,
        summary: operation.summary,
        state: operation.state,
        evidence: deduplicateEvidence(evidence),
        messageIds: [],
      })
      localTopicIds.set(operation.localId, id)
      assignEvidence(evidence, id)
      continue
    }

    if (operation.operation === 'merge') {
      const target = requireLedgerTopic(next, operation.targetTopicId)
      const sourceIds = [...new Set(operation.sourceTopicIds)]
      if (sourceIds.includes(target.id)) throw new Error('A merge target cannot also be a source')
      const sources = sourceIds.map((id) => requireLedgerTopic(next, id))
      target.title = operation.title
      target.summary = operation.summary
      target.state = operation.state
      target.evidence = deduplicateEvidence([
        ...target.evidence,
        ...sources.flatMap((topic) => topic.evidence),
        ...evidence,
      ])
      target.messageIds = deduplicateMessageIds([...target.messageIds, ...sources.flatMap((topic) => topic.messageIds)])
      for (const sourceId of sourceIds) mergedTopicIds.set(sourceId, target.id)
      assignEvidence(evidence, target.id)
      next.topics = next.topics.filter((topic) => !sourceIds.includes(topic.id))
      continue
    }

    const topic = requireLedgerTopic(next, operation.topicId)
    if (operation.title) topic.title = operation.title
    if (operation.summary) topic.summary = operation.summary
    topic.evidence = deduplicateEvidence([...topic.evidence, ...evidence])
    assignEvidence(evidence, topic.id)
    if (operation.operation === 'close') topic.state = 'closed'
    if (operation.operation === 'reopen') topic.state = 'active'
  }

  for (const assignment of response.assignments) {
    const topicId = resolveTopicRef(assignment.topicRef)
    for (const messageId of assignment.messageIds) assignMessage(messageId, topicId)
  }

  for (const [messageId, topicId] of assignedTopicsByMessageId) {
    const topic = requireLedgerTopic(next, followMergedTopicId(topicId))
    topic.messageIds = deduplicateMessageIds([...topic.messageIds, messageId])
  }

  return next

  function resolveTopicRef(topicRef: string): string {
    const resolved = followMergedTopicId(localTopicIds.get(topicRef) ?? topicRef)
    requireLedgerTopic(next, resolved)
    return resolved
  }

  function followMergedTopicId(topicId: string): string {
    let resolved = topicId
    const visited = new Set<string>()
    while (mergedTopicIds.has(resolved)) {
      if (visited.has(resolved)) throw new Error(`Circular merged topic reference: ${topicId}`)
      visited.add(resolved)
      resolved = mergedTopicIds.get(resolved)!
    }
    return resolved
  }

  function assignEvidence(evidence: ChatTopicEvidence[], topicId: string): void {
    for (const item of evidence) assignMessage(item.messageId, topicId)
  }

  function assignMessage(messageId: number, topicId: string): void {
    if (!Number.isInteger(messageId) || !currentMessageIds.has(messageId)) {
      throw new Error(`Assigned message is not in the current block: ${messageId}`)
    }
    const resolvedTopicId = followMergedTopicId(topicId)
    const existingTopicId = assignedTopicsByMessageId.get(messageId)
    if (existingTopicId && followMergedTopicId(existingTopicId) !== resolvedTopicId) {
      throw new Error(`Message ${messageId} is assigned to multiple topics`)
    }
    assignedTopicsByMessageId.set(messageId, resolvedTopicId)
  }
}

export function applyTopicFinalization(ledger: TopicLedger, finalization: TopicFinalization): TopicLedger {
  const next = cloneLedger(ledger)
  const updates = new Map(finalization.topics.map((topic) => [topic.id, topic]))
  if (updates.size !== finalization.topics.length) throw new Error('Finalization contains duplicate topic ids')
  if (updates.size !== next.topics.length || next.topics.some((topic) => !updates.has(topic.id))) {
    throw new Error('Finalization must include each existing topic exactly once')
  }
  for (const topic of next.topics) {
    const update = updates.get(topic.id)
    if (!update) continue
    topic.title = update.title
    topic.summary = update.summary
    topic.state = update.state
  }
  return next
}

export function materializeChatTopics(ledger: TopicLedger, messages: TopicSourceMessage[]): ChatTopic[] {
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  return ledger.topics
    .filter((topic) => topic.messageIds.some((messageId) => messagesById.has(messageId)))
    .map((topic) => {
      const evidence = deduplicateEvidence(topic.evidence)
        .filter((item) => messagesById.has(item.messageId))
        .sort((left, right) => left.timestamp - right.timestamp || left.messageId - right.messageId)
      const assignedMessages = deduplicateMessageIds(topic.messageIds)
        .map((messageId) => messagesById.get(messageId))
        .filter((message): message is TopicSourceMessage => message !== undefined)
        .sort((left, right) => left.timestamp - right.timestamp || left.id - right.id)
      const participants: string[] = []
      for (const message of assignedMessages) {
        const senderName = message.senderName
        if (senderName && !participants.includes(senderName)) participants.push(senderName)
      }
      return {
        id: topic.id,
        title: topic.title,
        summary: topic.summary,
        participants,
        timeRanges: buildTopicTimeRanges(assignedMessages),
        messageIds: assignedMessages.map((message) => message.id),
        assignmentMode: 'exact' as const,
        state: topic.state,
        evidence,
      }
    })
    .sort((left, right) => {
      const leftTs = messagesById.get(left.messageIds[0] ?? -1)?.timestamp ?? left.evidence[0]?.timestamp ?? 0
      const rightTs = messagesById.get(right.messageIds[0] ?? -1)?.timestamp ?? right.evidence[0]?.timestamp ?? 0
      return leftTs - rightTs
    })
}

export function serializeTopicLedger(ledger: TopicLedger): string {
  return JSON.stringify(ledger)
}

export function parseTopicLedger(value: string): TopicLedger {
  const parsed = JSON.parse(value) as unknown
  if (!isRecord(parsed) || !Array.isArray(parsed.topics)) throw new Error('Invalid topic ledger checkpoint')
  const topics = parsed.topics.map((topic) => parseLedgerItem(topic))
  return { topics }
}

function createCanonicalTopicId(sessionId: string, dayKey: string, localIdNamespace: string, localId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(localId)) throw new Error(`Invalid local topic id: ${localId}`)
  return `topic:${createHash('sha256')
    .update(`${sessionId}\u0000${dayKey}\u0000${localIdNamespace}\u0000${localId}`)
    .digest('hex')
    .slice(0, 24)}`
}

function buildTopicTimeRanges(messages: TopicSourceMessage[]): ChatTopic['timeRanges'] {
  const ranges: ChatTopic['timeRanges'] = []
  for (const message of messages) {
    const previous = ranges.at(-1)
    if (!previous || message.timestamp - previous.endTs > TOPIC_RANGE_GAP_SECONDS) {
      ranges.push({ startTs: message.timestamp, endTs: message.timestamp })
    } else {
      previous.endTs = message.timestamp
    }
  }
  return ranges
}

function validateNewEvidence(evidence: ChatTopicEvidence[], currentMessageIds: Set<number>): void {
  for (const item of evidence) {
    if (!currentMessageIds.has(item.messageId)) {
      throw new Error(`Evidence message is not in the current block: ${item.messageId}`)
    }
  }
}

function deduplicateEvidence(evidence: ChatTopicEvidence[]): ChatTopicEvidence[] {
  const byMessageId = new Map<number, ChatTopicEvidence>()
  for (const item of evidence) {
    const current = byMessageId.get(item.messageId)
    if (!current || evidencePriority(item.role) > evidencePriority(current.role)) byMessageId.set(item.messageId, item)
  }
  return [...byMessageId.values()]
}

function deduplicateMessageIds(messageIds: number[]): number[] {
  return [...new Set(messageIds)]
}

function evidencePriority(role: ChatTopicEvidence['role']): number {
  return role === 'primary' ? 3 : role === 'counter' ? 2 : 1
}

function requireLedgerTopic(ledger: TopicLedger, topicId: string): TopicLedgerItem {
  const topic = ledger.topics.find((item) => item.id === topicId)
  if (!topic) throw new Error(`Unknown topic: ${topicId}`)
  return topic
}

function cloneLedger(ledger: TopicLedger): TopicLedger {
  return {
    topics: ledger.topics.map((topic) => ({
      ...topic,
      evidence: topic.evidence.map((item) => ({ ...item })),
      messageIds: [...topic.messageIds],
    })),
  }
}

function parseLedgerItem(value: unknown): TopicLedgerItem {
  if (!isRecord(value)) throw new Error('Invalid topic ledger item')
  const id = requireString(value.id, 'id')
  const title = requireString(value.title, 'title')
  const summary = requireString(value.summary, 'summary')
  const state = requireState(value.state)
  if (!Array.isArray(value.evidence)) throw new Error('Invalid topic ledger evidence')
  const evidence = value.evidence.map(parseEvidence)
  const rawMessageIds = value.messageIds ?? evidence.map((item) => item.messageId)
  if (!Array.isArray(rawMessageIds) || rawMessageIds.some((messageId) => !Number.isInteger(messageId))) {
    throw new Error('Invalid topic ledger message ids')
  }
  return { id, title, summary, state, evidence, messageIds: deduplicateMessageIds(rawMessageIds as number[]) }
}

export function parseEvidence(value: unknown): ChatTopicEvidence {
  if (!isRecord(value)) throw new Error('Invalid topic evidence')
  const messageId = Number(value.messageId)
  const timestamp = Number(value.timestamp)
  const role = value.role
  if (!Number.isInteger(messageId) || !Number.isFinite(timestamp)) throw new Error('Invalid topic evidence reference')
  if (role !== 'primary' && role !== 'supporting' && role !== 'counter') throw new Error('Invalid topic evidence role')
  return { messageId, timestamp, role }
}

export function requireState(value: unknown): 'active' | 'closed' {
  if (value !== 'active' && value !== 'closed') throw new Error('Invalid topic state')
  return value
}

export function requireString(value: unknown, field: string, maxLength = 4_000): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new Error(`Invalid topic ${field}`)
  }
  return value.trim()
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
