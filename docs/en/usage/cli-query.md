---
outline: deep
---

# External Agent Calls

ChatLab can act as the local chat-data tool layer for external agents such as Codex, Claude Code, and HermesAgent. The agent handles conversation, planning, and synthesis; ChatLab handles controlled local reads, search, statistics, and organization of local chat records.

This mode does not require opening the ChatLab web UI, and it does not require starting the ChatLab desktop interface first. External agents call the lightweight `chatlab` CLI on demand, run controlled local queries, searches, and statistics, then receive privacy-processed text.

## When to use it

- You already use an external agent such as Codex, Claude Code, or HermesAgent, and want to reuse its subscription, tokens, model capabilities, and workflow.
- You want the agent to analyze ChatLab records on demand, but you do not want to hand it the raw database or a full chat export.
- You want ChatLab to handle desensitization, blacklist filtering, cleaning, merging, and truncation before sending analysis-ready text and traceable single-message ids to the agent.

The `chatlab` CLI ships a set of query commands optimized for AI agents while staying human-readable. All query commands are read-only and apply your ChatLab privacy preprocessing (desensitization, blacklist) by default.

Install with `npm i chatlab-cli -g` (Node.js ≥ 20) and import chat records in ChatLab first.

## Command overview

```bash
chatlab sessions list                # List imported sessions
chatlab sessions show                # Session details
chatlab members list                 # Session members
chatlab members history              # Member name history
chatlab messages list                # List messages in a time window
chatlab messages search <keywords...> # Keyword search (multi-word, context, paging)
chatlab messages context --id <id>   # Messages around a specific id
chatlab messages between             # Conversation between two members
chatlab stats overview               # Session overview
chatlab stats activity               # Member activity ranking
chatlab stats time --by day          # Time distribution (hour/weekday/day/month)
chatlab stats keywords               # High-frequency words (privacy-filtered)
chatlab stats response               # Reply speed ranking
chatlab topics list                  # AI segment summaries
chatlab topics show --id <id>        # Original messages of one segment
chatlab sql "<SELECT ...>"           # Read-only SQL fallback (strings desensitized)
chatlab schema                       # Database schema
chatlab manifest                     # Machine-readable command manifest for agents
```

With a single session `--session` can be omitted; with multiple sessions, commands return candidates for disambiguation.

## Output formats

Pass `--format` explicitly:

- **`agent`**: recommended for AI agents. A JSON envelope whose body is compact text produced by the full preprocessing pipeline (cleaning, blacklist, denoising, merging consecutive messages, desensitization, token-aware truncation). Single-message markers `[#id]` / `[#id*]` can be used with `messages context --id`; merged ranges such as `[#a-b]` are display-only.
- **`json`**: for programmatic parsing. Structured message items with privacy steps applied (cleaning, blacklist, desensitization) but no merging or denoising. The right choice for structural scouting with `--no-content` / `--fields`.
- **`text`**: human-readable output (TTY default).

In agent/json mode stdout contains exactly one JSON envelope; logs go to stderr:

```json
{
  "ok": true,
  "command": "messages.search",
  "data": { "text": "returned: 2\n\n--- 2026/6/1 ---\n[#1*] 09:00 Wang: how about a trip on May Day..." },
  "meta": { "totalHits": 2, "returnedHits": 2, "hasMore": false, "preprocess": { "desensitized": true }, "apiVersion": 1 }
}
```

Failures return `{ "ok": false, "error": { "code", "message", "hint", "candidates" } }` with semantic exit codes: 0 success, 2 invalid argument or disabled capability, 3 not found, 4 ambiguous (with candidates), 5 SQL error.

## Common query parameters

- **Time**: `--since` / `--until` accept `2026-06-01`, `"2026-06-01 08:30"`, ISO 8601, `today`, `yesterday`; `--last 30d` supports h/d/w. Date-only `--until` includes the whole day; resolved bounds are echoed in `meta.timeRange`.
- **Members**: `--member` accepts a member id, exact name, or `me` (the data owner); ambiguous names return candidate ids.
- **Paging**: when `meta.hasMore` is true, pass `--cursor <meta.nextCursor>`; cursors are bound to the exact query conditions.
- **Token budget**: `--limit` (primary objects), `--max-messages` (context expansion cap), `--max-tokens` (agent text budget, default 4000), `--max-chars` (per-message truncation).

## Privacy boundaries

- All query commands apply your ChatLab desensitize rules and blacklist by default — including the `stats keywords` vocabulary, `topics list` summaries, and string cells in `sql` results; reading the message `content` column with `sql` requires explicit `--raw`.
- `--raw` (bypassing preprocessing) is disabled by default; it only works after you explicitly run `chatlab config set cli.allow_raw true` or set `CHATLAB_CLI_ALLOW_RAW=1`.
- If you don't need the SQL fallback, disable it with `chatlab config set cli.allow_sql false`.

## Agent usage guide

Install the official `chatlab-analyze` skill through the general Agent Skills CLI:

```bash
npx skills add ChatLab/ChatLab --skill chatlab-analyze -g
```

After installation, ask Codex, Claude Code, Cursor, or another external agent:

```text
chatlab-analyze help me analyze my chat history with Alice
```

The skill tells the agent to run `chatlab manifest` first, then query chat records safely with explicit `--format agent/json` commands.

`chatlab-analyze` always remains read-only. To let an agent import a new chat export, use the separate `chatlab-import` skill; it previews the import, then automatically creates or incrementally updates a session. See the [Import Chat Records Guide](./how-to-import.md).

A typical recipe — "who mentioned this first? inspect the surrounding context":

```bash
chatlab messages search "server migration" --sort asc --limit 5 --context 3 --format agent
# Take the message id from a single-message [#1021*] marker in the returned text, then dig in:
chatlab messages context --id 1021 --window 10 --format agent
```
