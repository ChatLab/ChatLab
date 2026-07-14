---
name: chatlab-analyze
description: Analyze local ChatLab chat records through the chatlab CLI. Use when the user asks an external agent to inspect conversations, find evidence, summarize topics, compare members, or analyze a named relationship from imported ChatLab data.
---

# ChatLab Analyze

Query and analyze records already imported into ChatLab through the read-only `chatlab` CLI.

## Good Fit

- Find conversations or determine who mentioned something first.
- Summarize recent topics or inspect a named relationship.
- Compare member activity, keywords, or response patterns.

For importing a new chat export, use `chatlab-import` instead.

Install this skill with:

```bash
npx skills add ChatLab/ChatLab --skill chatlab-analyze -g
```

## Workflow

### 1. Prepare the Query

Check the CLI, load its current command contract, and list sessions:

```bash
chatlab --help
chatlab manifest
chatlab sessions list --format json
```

Use the only relevant session. If multiple sessions or members match the request, ask the user to choose from the returned candidates.

### 2. Start with a Dedicated Command

Use the simplest command that directly answers the question:

```bash
chatlab messages search "<keyword>" --session <session-id> --format agent
chatlab messages between --member me --member <member> --session <session-id> --last 90d --format agent
chatlab topics list --session <session-id> --last 30d --format agent
```

Use `--format agent` for message text and `--format json` for structural scouting such as sessions, members, counts, and `--no-content` searches.

### 3. Add Context or Statistics

Only deepen the query when the first result is insufficient:

```bash
chatlab messages context --id 1021 --session <session-id> --window 10 --format agent
chatlab stats keywords --session <session-id> --member <member> --last 90d --top 20 --format json
```

When `meta.hasMore` is true, continue with `--cursor <meta.nextCursor>` and the same query conditions. Use limits and token controls to retrieve only the context needed.

### 4. Use SQL Only as a Fallback

Use read-only SQL only when no dedicated command can answer the question:

```bash
chatlab schema --session <session-id> --format json
chatlab sql "SELECT COUNT(*) AS n FROM message" --session <session-id> --format json
```

## Privacy and Answers

- Never use `--raw`, modify ChatLab data, import files, change config, or start long-running services.
- Never reveal full chat dumps. ChatLab's safe output applies the user's privacy preprocessing.
- Cite available message evidence with markers such as `[#1021]`, `[#1021*]`, or `[#1021-1024]`.
- Start with the answer, name the queried session and time range, then separate observed facts from interpretation.
- Avoid overclaiming emotional intent in relationship analysis. Follow `error.hint` only when the correction is clear.
