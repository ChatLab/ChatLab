/**
 * Shared output shaping for message-carrying query commands.
 *
 * agent format: AI-facing text from the shared preprocessing pipeline with
 * [#id] / [#id*] message markers and display-only [#a-b] merged ranges.
 * json format: structured items with privacy
 * steps applied (cleaning/blacklist/desensitize) but no merging/denoising.
 */

import { messageTypeToString } from '@openchatlab/core'
import {
  applyPreprocessingPipeline,
  preprocessMessages,
  type PreprocessConfig,
  type PreprocessableMessage,
  type PipelineStats,
  type TruncationStrategy,
} from '@openchatlab/node-runtime'
import { epochToIso, parseLimit } from './parse'
import { QueryError } from './envelope'
import type { QueryContext } from './context'

export interface MessageLike {
  id: number
  senderId?: number
  senderName: string
  senderPlatformId?: string
  content: string | null
  timestamp: number
  type?: number
}

export const MAX_TOKENS_DEFAULT = 4000
export const MAX_TOKENS_CAP = 32000

/** Privacy-only variant of the user's preprocess config: no merging, no denoising. */
export function privacyOnlyConfig(config: PreprocessConfig): PreprocessConfig {
  return { ...config, mergeConsecutive: false, denoise: false, anonymizeNames: false }
}

export interface TokenCliOptions {
  maxTokens?: string
  maxChars?: string
  full?: boolean
  verbose?: boolean
  raw?: boolean
}

export interface AgentTextResult {
  text: string
  stats: PipelineStats
  preprocess: Record<string, unknown>
  preprocessDetail?: Record<string, unknown>
}

/** Reject --raw for agent format: raw output only pairs with json/text (design §6.1). */
export function assertRawFormatCompatible(format: string, options: { raw?: boolean }): void {
  if (options.raw && format === 'agent') {
    throw new QueryError({
      code: 'INVALID_ARGUMENT',
      message: '--raw cannot be combined with --format agent',
      hint: 'Raw output is a debugging path; use --format json or --format text with --raw',
    })
  }
}

/**
 * Build the agent-format text via the shared preprocessing pipeline.
 * Messages must be in chronological order (merge assumes consecutive ordering).
 */
export function buildAgentText(
  messages: MessageLike[],
  ctx: Pick<QueryContext, 'preprocessConfig' | 'locale' | 'ownerPlatformId'>,
  options: TokenCliOptions & {
    hitIds?: Iterable<number>
    strategy: TruncationStrategy
    /** Per-message content char default for this command (search uses 120). */
    defaultMaxChars?: number
  }
): AgentTextResult {
  const maxTokens = parseLimit(options.maxTokens, MAX_TOKENS_DEFAULT, MAX_TOKENS_CAP, '--max-tokens')
  const maxChars = options.full
    ? 0
    : options.maxChars !== undefined
      ? parseLimit(options.maxChars, 200, 10000, '--max-chars')
      : options.defaultMaxChars

  const result = applyPreprocessingPipeline({
    rawMessages: messages as PreprocessableMessage[],
    preprocessConfig: ctx.preprocessConfig,
    locale: ctx.locale,
    anonymizeNames: ctx.preprocessConfig.anonymizeNames ?? false,
    ownerPlatformId: ctx.ownerPlatformId,
    maxToolResultTokens: maxTokens,
    truncationStrategy: options.strategy,
    includeMessageIds: true,
    hitIds: options.hitIds,
    maxContentChars: maxChars,
  })

  const config = ctx.preprocessConfig
  const preprocess = {
    cleaned: config.dataCleaning !== false,
    denoised: !!config.denoise,
    merged: !!config.mergeConsecutive,
    desensitized: !!config.desensitize && config.desensitizeRules.some((r) => r.enabled),
    truncated: result.stats.truncated,
  }

  const preprocessDetail = options.verbose
    ? {
        inputMessages: result.stats.input,
        renderedBlocks: result.stats.renderedBlocks,
        cleaned: result.stats.cleaned,
        blacklistRemoved: result.stats.blacklistRemoved,
        denoiseRemoved: result.stats.denoiseRemoved,
        mergeCombined: result.stats.mergeCombined,
        desensitizeRulesApplied: result.stats.desensitizeRulesApplied,
      }
    : undefined

  return { text: result.text, stats: result.stats, preprocess, preprocessDetail }
}

export interface JsonItemsOptions {
  /** Per-message content char limit (json default 300, search 120); --full disables. */
  maxChars?: string
  full?: boolean
  fields?: string
  /** commander --no-content negated flag: options.content === false means omit content. */
  content?: boolean
  raw?: boolean
  hitIds?: Set<number>
  defaultMaxChars?: number
}

const JSON_ITEM_FIELDS = new Set(['id', 'time', 'senderId', 'senderName', 'type', 'content', 'hit'])

/**
 * Shape messages into json-format items. Privacy steps (cleaning/blacklist/
 * desensitize) apply unless `raw` (which must already be gate-checked).
 */
export function toJsonItems(
  messages: MessageLike[],
  preprocessConfig: PreprocessConfig,
  options: JsonItemsOptions
): Record<string, unknown>[] {
  const visible = options.raw
    ? messages
    : (preprocessMessages(messages as PreprocessableMessage[], privacyOnlyConfig(preprocessConfig)) as MessageLike[])

  const noContent = options.content === false
  const maxChars = options.full
    ? 0
    : options.maxChars !== undefined
      ? parseLimit(options.maxChars, 300, 10000, '--max-chars')
      : (options.defaultMaxChars ?? 300)

  let fields: Set<string> | undefined
  if (options.fields) {
    fields = new Set(options.fields.split(',').map((f) => f.trim()))
    for (const field of fields) {
      if (!JSON_ITEM_FIELDS.has(field)) {
        throw new QueryError({
          code: 'INVALID_ARGUMENT',
          message: `Unknown field: ${field}`,
          hint: `Supported fields: ${[...JSON_ITEM_FIELDS].join(', ')}`,
        })
      }
    }
  }

  return visible.map((msg) => {
    let content: string | null | undefined = msg.content
    if (noContent) {
      content = undefined
    } else if (content && maxChars > 0 && content.length > maxChars) {
      content = content.slice(0, maxChars) + '...'
    }

    const item: Record<string, unknown> = {
      id: msg.id,
      time: epochToIso(msg.timestamp),
      ...(msg.senderId !== undefined ? { senderId: msg.senderId } : {}),
      senderName: msg.senderName,
      ...(msg.type !== undefined ? { type: messageTypeToString(msg.type) } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(options.hitIds?.has(msg.id) ? { hit: true } : {}),
    }

    if (fields) {
      for (const key of Object.keys(item)) {
        if (!fields.has(key)) delete item[key]
      }
    }
    return item
  })
}

/** Chronological ordering for pipeline input (merge assumes consecutive order). */
export function sortChronological<T extends { timestamp: number; id: number }>(messages: T[]): T[] {
  return [...messages].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)
}

export interface MessageResultOptions extends TokenCliOptions {
  fields?: string
  content?: boolean
}

export interface MessageResultShape {
  hitIds?: Set<number>
  strategy: TruncationStrategy
  /** Per-message content char default for this command (search uses 120). */
  defaultMaxChars?: number
}

export interface ShapedMessagesResult {
  data: unknown
  meta?: Record<string, unknown>
  renderText?: () => string
}

/**
 * Shared response assembly for message-carrying commands: agent text via the
 * pipeline, json items with privacy steps, raw text lines when gated --raw.
 */
export function buildMessagesResult(
  format: 'agent' | 'json' | 'text',
  ctx: Pick<QueryContext, 'preprocessConfig' | 'locale' | 'ownerPlatformId'>,
  options: MessageResultOptions,
  messages: MessageLike[],
  meta: Record<string, unknown>,
  shape: MessageResultShape
): ShapedMessagesResult {
  const chronological = sortChronological(messages)

  if (format === 'json') {
    const items = toJsonItems(chronological, ctx.preprocessConfig, {
      maxChars: options.maxChars,
      full: options.full,
      fields: options.fields,
      content: options.content,
      raw: options.raw,
      hitIds: shape.hitIds,
      defaultMaxChars: shape.defaultMaxChars,
    })
    return {
      data: { items },
      meta: {
        ...meta,
        returned: items.length,
        preprocess: options.raw
          ? { raw: true }
          : {
              cleaned: ctx.preprocessConfig.dataCleaning !== false,
              desensitized:
                !!ctx.preprocessConfig.desensitize && ctx.preprocessConfig.desensitizeRules.some((r) => r.enabled),
            },
      },
    }
  }

  if (options.raw) {
    // text format + raw: plain lines without preprocessing
    return {
      data: { items: chronological },
      renderText: () =>
        chronological
          .map((m) => `[#${m.id}] ${new Date(m.timestamp * 1000).toLocaleString()} ${m.senderName}: ${m.content ?? ''}`)
          .join('\n') || 'No messages.',
    }
  }

  const agent = buildAgentText(chronological, ctx, {
    hitIds: shape.hitIds,
    strategy: shape.strategy,
    maxTokens: options.maxTokens,
    maxChars: options.maxChars,
    full: options.full,
    verbose: options.verbose,
    defaultMaxChars: shape.defaultMaxChars,
  })

  return {
    data: { text: agent.text },
    meta: {
      ...meta,
      preprocess: agent.preprocess,
      ...(agent.preprocessDetail ? { preprocessDetail: agent.preprocessDetail } : {}),
    },
    renderText: () => agent.text,
  }
}
