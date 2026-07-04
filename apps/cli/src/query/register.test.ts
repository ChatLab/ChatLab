import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatLabConfig } from '@openchatlab/config'

import { assertLegacySqlAllowed } from './register'
import { QueryError } from './envelope'

function configWithSql(allowSql: boolean): ChatLabConfig {
  return {
    llm: { provider: '', model: '', base_url: '' },
    data: { user_data_dir: '', electron_migration_done: false },
    api: { port: 3110, host: '127.0.0.1', token: '', require_auth: false },
    locale: { lang: '' },
    ui: { default_session_tab: 'overview', session_gap_threshold: 1800, summary_strategy: 'standard' },
    cli: { allow_raw: false, allow_sql: allowSql },
  }
}

describe('legacy query alias SQL gate', () => {
  it('rejects SQL when cli.allow_sql is disabled', () => {
    assert.throws(
      () => assertLegacySqlAllowed(configWithSql(false)),
      (err: unknown) => err instanceof QueryError && err.code === 'SQL_DISABLED'
    )
  })

  it('allows SQL when cli.allow_sql is enabled', () => {
    assert.doesNotThrow(() => assertLegacySqlAllowed(configWithSql(true)))
  })

  it('rejects message content SQL because the legacy alias has no raw mode', () => {
    assert.throws(
      () => assertLegacySqlAllowed(configWithSql(true), 'SELECT content FROM message'),
      (err: unknown) => err instanceof QueryError && err.code === 'INVALID_ARGUMENT'
    )
    assert.throws(
      () => assertLegacySqlAllowed(configWithSql(true), 'SELECT * FROM message'),
      (err: unknown) => err instanceof QueryError && err.code === 'INVALID_ARGUMENT'
    )
  })
})
