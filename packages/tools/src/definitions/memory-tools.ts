import type { AIMemoryEntry, AIMemoryScope, AIMemorySourceType, AIEntityRef } from '@openchatlab/shared-types'
import { ChatType } from '@openchatlab/shared-types'
import type { CrossChatToolExecutionContext, JsonSchema, ToolDefinition, ToolResult } from '../types'

const readSchema: JsonSchema = {
  type: 'object',
  properties: {
    scope_type: { type: 'string', enum: ['global', 'self', 'contact', 'group'] },
    scope_id: {
      type: 'string',
      description: 'Stable contactKey or group sessionId. Omit for global and self memory.',
    },
    limit: { type: 'number', minimum: 1, maximum: 50, default: 20 },
  },
  required: ['scope_type'],
}

const writeSchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Stable memory ID. Provide it to update an existing memory.' },
    scope_type: { type: 'string', enum: ['global', 'self', 'contact', 'group'] },
    scope_id: {
      type: 'string',
      description: 'Stable contactKey or group sessionId. Omit for global and self memory.',
    },
    content: { type: 'string', description: 'One durable fact or preference, without chat transcripts.' },
    source_type: {
      type: 'string',
      enum: ['user', 'ai'],
      description: 'Use user only for explicit user-provided facts or corrections; use ai for derived conclusions.',
    },
  },
  required: ['scope_type', 'content', 'source_type'],
}

const forgetSchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Stable memory ID returned by memory_read or memory_write.' },
  },
  required: ['id'],
}

export const memoryReadTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'memory_read',
  description:
    'Read durable global preferences, facts about the user, or memories for one resolved contact/group. Self memory is read on demand and is never injected automatically. AI-derived memories are leads and must be re-verified against current chat evidence.',
  inputSchema: readSchema,
  handler: memoryReadHandler,
}

export const memoryWriteTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'memory_write',
  description:
    'Create or update one durable memory. Read the target scope first, use stable entity IDs, and never store transcripts, temporary requests, or ordinary statistics.',
  inputSchema: writeSchema,
  executionMode: 'sequential',
  handler: memoryWriteHandler,
}

export const memoryForgetTool: ToolDefinition<CrossChatToolExecutionContext> = {
  name: 'memory_forget',
  description:
    'Permanently delete one memory by its stable ID after the user asks to forget or confirms it is invalid.',
  inputSchema: forgetSchema,
  executionMode: 'sequential',
  handler: memoryForgetHandler,
}

async function memoryReadHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const scope = parseScope(params)
  await assertResolvableEntityScope(scope, context)
  const limit = parseLimit(params.limit)
  const allEntries = context.memoryService.list(scope)
  const entries = allEntries.slice(0, limit)
  const truncated = allEntries.length > entries.length
  const verificationGuidance = entries.some((entry) => entry.sourceType === 'ai')
    ? context.locale?.startsWith('zh')
      ? '标记为 ai 的记忆只是调查线索，使用前必须重新查询原始聊天证据。'
      : 'Memories marked ai are investigation leads. Re-query the original chat evidence before using them.'
    : null
  const data = { entries, truncated, verificationGuidance }
  return { content: JSON.stringify(data), data }
}

async function memoryWriteHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const scope = parseScope(params)
  await assertResolvableEntityScope(scope, context)
  const content = requireString(params.content, 'content')
  const sourceType = parseSourceType(params.source_type)
  if (sourceType === 'ai' && !context.allowProactiveMemory) {
    throw new Error('Proactive AI memory is disabled; only explicit user memory writes are allowed')
  }

  const id = optionalString(params.id)
  let entry: AIMemoryEntry
  if (id) {
    const current = context.memoryService.get(id)
    if (!current) throw new Error(`AI memory not found: ${id}`)
    if (current.scopeType !== scope.scopeType || current.scopeId !== scope.scopeId) {
      throw new Error('AI memory scope does not match the existing memory')
    }
    entry = context.memoryService.update(id, {
      content,
      sourceType,
      sourceAIChatId: context.aiChatId,
      sourceMessageId: null,
    })
  } else {
    entry = context.memoryService.create({
      ...scope,
      content,
      sourceType,
      sourceAIChatId: context.aiChatId,
      sourceMessageId: null,
    })
  }

  return { content: JSON.stringify(entry), data: entry }
}

async function memoryForgetHandler(
  params: Record<string, unknown>,
  context: CrossChatToolExecutionContext
): Promise<ToolResult> {
  const id = requireString(params.id, 'id')
  const current = context.memoryService.get(id)
  if (!current) {
    const data = { id, deleted: false }
    return { content: JSON.stringify(data), data }
  }
  await assertResolvableEntityScope(current, context, true)
  const data = { id, deleted: context.memoryService.forget(id) }
  return { content: JSON.stringify(data), data }
}

function parseScope(params: Record<string, unknown>): AIMemoryScope {
  const scopeType = params.scope_type
  if (scopeType !== 'global' && scopeType !== 'self' && scopeType !== 'contact' && scopeType !== 'group') {
    throw new Error('scope_type must be global, self, contact, or group')
  }
  const scopeId = optionalString(params.scope_id)
  if (scopeType === 'global' || scopeType === 'self') {
    if (scopeId) throw new Error(`${scopeType} memory does not accept scope_id`)
    return { scopeType, scopeId: null }
  }
  if (!scopeId) throw new Error(`${scopeType} memory requires a stable scope_id`)
  return { scopeType, scopeId }
}

function parseSourceType(value: unknown): AIMemorySourceType {
  if (value !== 'user' && value !== 'ai') throw new Error('source_type must be user or ai')
  return value
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 20
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error('limit must be an integer between 1 and 50')
  }
  return value
}

function requireString(value: unknown, field: string): string {
  const normalized = optionalString(value)
  if (!normalized) throw new Error(`${field} is required`)
  return normalized
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.trim() || null
}

async function assertResolvableEntityScope(
  scope: AIMemoryScope,
  context: CrossChatToolExecutionContext,
  requireCurrentTurnEntity = false
): Promise<void> {
  if (scope.scopeType === 'global' || scope.scopeType === 'self') return

  const currentTurnRefs = [...(context.entityRefs ?? []), ...(context.resolvedEntityRefs ?? [])]
  const matchesCurrentTurn = currentTurnRefs.some((ref) => matchesMemoryScope(ref, scope))
  if ((requireCurrentTurnEntity || currentTurnRefs.length > 0) && !matchesCurrentTurn) {
    throw new Error('scope_id must match an entity selected or resolved for the current turn')
  }

  const ref: AIEntityRef =
    scope.scopeType === 'contact'
      ? { type: 'contact', contactKey: scope.scopeId!, displayName: scope.scopeId! }
      : { type: 'session', sessionId: scope.scopeId!, displayName: scope.scopeId!, sessionType: ChatType.GROUP }
  const resolution = await context.analysisService.resolveEntities([ref], {
    signal: context.abortSignal,
  })

  if (scope.scopeType === 'contact') {
    const resolved = resolution.contacts.some(
      (item) => item.ref.contactKey === scope.scopeId && (item.status === 'resolved' || item.status === 'partial')
    )
    if (!resolved) throw new Error('scope_id must be a resolvable stable contact ID')
    return
  }

  const resolved = resolution.sessions.some(
    (item) =>
      item.ref.sessionId === scope.scopeId && item.status === 'resolved' && item.session?.sessionType === ChatType.GROUP
  )
  if (!resolved) throw new Error('scope_id must be a resolvable stable group ID')
}

function matchesMemoryScope(ref: AIEntityRef, scope: AIMemoryScope): boolean {
  return scope.scopeType === 'contact'
    ? ref.type === 'contact' && ref.contactKey === scope.scopeId
    : ref.type === 'session' && ref.sessionType === ChatType.GROUP && ref.sessionId === scope.scopeId
}
