---
name: chatlab-import
description: Safely preview and import local chat export files into ChatLab through the chatlab CLI. Use when a user asks an external agent to import, re-import, or incrementally update ChatLab from a local QQ, WeChat, Telegram, WhatsApp, LINE, Discord, Instagram, Google Chat, ChatLab JSON/JSONL, or other supported chat export.
---

# ChatLab Import

Import local chat exports through the `chatlab` CLI. Always preview the exact write. Treat an explicit request to import as authorization to continue after a successful preview; do not ask for a second confirmation.

## Good Fit

- Import a local chat export for the first time.
- Re-import a newer export and add only new messages.
- Let an external agent handle file detection and session matching safely.

For read-only analysis of records already in ChatLab, use `chatlab-analyze` instead.

Install this skill with:

```bash
npx skills add ChatLab/ChatLab --skill chatlab-import -g
```

## Workflow

1. Check the CLI and resolve one exact file path:

```bash
chatlab --help
```

If the CLI is missing, tell the user to install it with `npm install -g chatlab-cli`. Do not install software without approval. Do not guess between multiple files, and quote the path in every command.

2. Preview the import without writing:

```bash
chatlab import "/absolute/path/to/chat-export.json" --dry-run --json
```

If the user selected an existing session, include `--session-id <session-id>` in both preview and import.

3. Summarize only the plan: create or update mode, target session ID, scanned messages, new messages, duplicates, and match method or create reason. Never quote message bodies.

4. Decide from the preview:

- If the user asked only to preview or inspect, stop without writing.
- If `importMode` is `incremental` and `newMessageCount` is `0`, report that the session is already up to date and stop.
- If `importMode` is `incremental` and there are new messages, continue automatically without another confirmation.
- If `importMode` is `created`, continue automatically. When `createReason` is `ambiguous`, preserve existing sessions by creating a new one and explain this choice in the final result.
- If the result does not identify a safe action, stop and explain what is missing.

5. When the decision permits writing, run the same command without `--dry-run`, keeping the file, target, and format unchanged:

```bash
chatlab import "/absolute/path/to/chat-export.json" --json
```

Report the resulting session ID, import mode, new-message count, and duplicate count from the final JSON envelope.

## Guardrails

- Never skip the preview, edit ChatLab databases directly, or delete or merge sessions.
- Never reveal a full chat export or message bodies.
- Never invent a file path, parser format, or session ID.
- Follow `error.hint` only when the correction is unambiguous.
- For `FILE_NOT_FOUND`, request the correct path. For `UNRECOGNIZED_FORMAT`, inspect `chatlab formats`. For `IMPORT_IN_PROGRESS`, retry later. For `INVALID_SESSION_ID`, request a valid ID.
