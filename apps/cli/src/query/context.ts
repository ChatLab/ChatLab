/**
 * Query command context: runtime bootstrap + session resolution + privacy config.
 *
 * Privacy defaults (design §6.1): the user's aiPreprocessConfig (with builtin
 * locale-aware desensitize rules merged) applies to every query command. The
 * --raw escape hatch is gated behind the user-side cli.allow_raw switch.
 */

import * as path from 'node:path'
import type { DatabaseAdapter } from '@openchatlab/core'
import { getSessionMeta } from '@openchatlab/core'
import type { PreprocessConfig } from '@openchatlab/node-runtime'
import { initNlpDir } from '@openchatlab/node-runtime'
import { initRuntime } from '../runtime'
import { loadCliPreprocessConfig, resolveCliLocale } from './preprocess-config'
import { resolveSession } from './resolve'
import { QueryError } from './envelope'

export interface QueryContext {
  db: DatabaseAdapter
  session: { id: string; name: string }
  locale: string
  preprocessConfig: PreprocessConfig
  ownerPlatformId?: string
  allowRaw: boolean
  allowSql: boolean
  close: () => void
}

export interface RawCapableOptions {
  raw?: boolean
}

/** Bootstrap the runtime and resolve the target session for a query command. */
export function createQueryContext(options: { session?: string }): QueryContext {
  const { config, pathProvider, dbManager } = initRuntime()
  const resolved = resolveSession(dbManager, options.session)

  const locale = resolveCliLocale(config.locale.lang)
  const preprocessConfig = loadCliPreprocessConfig(pathProvider.getSystemDir(), locale)
  const ownerPlatformId = getSessionMeta(resolved.db)?.ownerId ?? undefined
  // Same dict location as the web NLP routes, so stats keywords can use downloaded dicts
  initNlpDir(path.join(pathProvider.getSystemDir(), 'nlp'))

  return {
    db: resolved.db,
    session: { id: resolved.id, name: resolved.name },
    locale,
    preprocessConfig,
    ownerPlatformId,
    allowRaw: config.cli.allow_raw,
    allowSql: config.cli.allow_sql,
    close: () => dbManager.closeAll(),
  }
}

/** Enforce the user-side gate for --raw (design §6.1: RAW_DISABLED unless opted in). */
export function assertRawAllowed(ctx: Pick<QueryContext, 'allowRaw'>, options: RawCapableOptions): void {
  if (options.raw && !ctx.allowRaw) {
    throw new QueryError({
      code: 'RAW_DISABLED',
      message: '--raw output is disabled by default',
      hint: 'The user must opt in: set CHATLAB_CLI_ALLOW_RAW=1 or `chatlab config set cli.allow_raw true`',
    })
  }
}
