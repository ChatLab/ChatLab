/**
 * MCP-only guard for user-provided SQL. SQLite can change global settings
 * during prepare() (e.g. some PRAGMAs), before stmt.readonly can be checked.
 * This lexical precheck is deliberately narrow, not a replacement for SQLite's
 * native single-statement/read-only verification in the shared SQL executor.
 */
export function assertMcpSqlReadOnly(sql: string): void {
  let pos = 0
  while (pos < sql.length) {
    while (pos < sql.length && /\s/.test(sql[pos])) pos++
    if (sql.startsWith('--', pos)) {
      const end = sql.indexOf('\n', pos + 2)
      pos = end < 0 ? sql.length : end + 1
      continue
    }
    if (sql.startsWith('/*', pos)) {
      const end = sql.indexOf('*/', pos + 2)
      if (end < 0) throw new Error('Only SELECT or WITH queries are allowed in MCP')
      pos = end + 2
      continue
    }
    break
  }
  if (!/^(SELECT|WITH)\b/i.test(sql.slice(pos))) {
    throw new Error('Only SELECT or WITH queries are allowed in MCP')
  }
}
