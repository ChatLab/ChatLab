---
name: chatlab-analyze
description: Analyze local ChatLab chat records through the clb CLI. Use when the user asks an external agent to inspect conversations, find evidence, summarize topics, compare members, or analyze a named relationship from imported ChatLab data.
---

# ChatLab Analyze

Query and analyze records already imported into ChatLab through the read-only `clb` CLI.

For importing a new chat export, use `chatlab-import` when available; otherwise follow `clb import --help` and preview the exact import before writing.

## Workflow

### 1. Prepare the Query

Load the current command contract once per task. List sessions only when the target is not already known:

```bash
clb manifest
clb sessions list --format json
```

Reuse the session, member, and time range already identified in the conversation. Ask only when the returned candidates and context cannot resolve a material ambiguity. If the CLI is unavailable, report the missing capability; installation requires authorization.

### 2. Start with a Dedicated Command

Use the simplest command that directly answers the question:

```bash
clb messages search "<keyword>" --session <session-id> --format agent
clb messages between --member me --member <member> --session <session-id> --last 90d --format agent
clb topics list --session <session-id> --last 30d --format agent
```

Use `--format agent` for message text and `--format json` for structural scouting such as sessions, members, counts, and `--no-content` searches.

### 3. Add Context or Statistics

Only deepen the query when the first result is insufficient:

```bash
clb messages context --id 1021 --session <session-id> --window 10 --format agent
clb stats keywords --session <session-id> --member <member> --last 90d --top 20 --format json
```

When more evidence is needed and `meta.hasMore` is true, continue with `--cursor <meta.nextCursor>` and the same query conditions. Stop when the question is answered; disclose any partial coverage instead of treating a page as the complete dataset.

### 4. Use SQL Only as a Fallback

Use read-only SQL only when no dedicated command can answer the question:

```bash
clb schema --session <session-id> --format json
clb sql "SELECT COUNT(*) AS n FROM message" --session <session-id> --format json
```

## Privacy and Answers

- Queries keep privacy preprocessing enabled; do not use `--raw` or mutate data/config. A separate request to import follows the import workflow.
- Never reveal full chat dumps. ChatLab's safe output applies the user's privacy preprocessing.
- Cite available evidence with `[#1021]`, `[#1021*]`, or `[#1021-1024]`. Only individual IDs can be passed to `messages context --id`; merged ranges are display-only.
- Start with the answer, name the queried session and time range, then separate observed facts from interpretation.
- Avoid overclaiming emotional intent in relationship analysis. Follow `error.hint` only when the correction is clear.
