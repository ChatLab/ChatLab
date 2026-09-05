---
name: chatlab-import
description: Preview and import local chat exports into ChatLab with clb, including re-imports and incremental updates. Use for import requests, not read-only analysis or unsupported-format conversion.
---

# ChatLab Import

Import local chat exports through the `clb` CLI. Always preview the exact write. Treat an explicit request to import as authorization to continue after a successful preview; do not ask for a second confirmation.

For analysis of imported records, use `chatlab-analyze` when available. For an unsupported source, use `chatlab-convert` when available; neither skill is required for a supported import.

## Workflow

1. Check the CLI and resolve one exact file path:

```bash
clb --help
```

If the CLI is missing, tell the user to install it with `npm install -g chatlab-cli`. Do not install software without approval. Reuse the user's specified file and target. Ask only if the path remains ambiguous, and quote it in every command.

2. Preview the import without writing:

```bash
clb import "/absolute/path/to/chat-export.json" --dry-run --json
```

If the user selected an existing session, include `--session-id <session-id>` in both preview and import.

3. Summarize only the plan: create or update mode, target session ID, scanned messages, new messages, duplicates, and match method or create reason. Never quote message bodies.

4. Require `ok: true`, then read the plan from `data` and decide:

- If the user asked only to preview or inspect, stop without writing.
- If `importMode` is `incremental` and `newMessageCount` is `0`, report that the session is already up to date and stop.
- If `importMode` is `incremental` and there are new messages, continue automatically without another confirmation.
- If `importMode` is `created`, continue automatically. When `createReason` is `ambiguous`, preserve existing sessions by creating a new one and explain this choice in the final result.
- If the result does not identify a safe action, stop and explain what is missing.

5. When the decision permits writing, run the same command without `--dry-run`, keeping the file, target, and format unchanged:

```bash
clb import "/absolute/path/to/chat-export.json" --json
```

Report the resulting session ID, import mode, new-message count, and duplicate count from the final JSON envelope.

## Guardrails

- Never skip the preview, edit ChatLab databases directly, or delete or merge sessions.
- Never reveal a full chat export or message bodies.
- Never invent a file path, parser format, or session ID.
- Follow `error.hint` only when the correction is unambiguous.
- For `FILE_NOT_FOUND` or `INVALID_SESSION_ID`, resolve from available context or request the correct value. For `UNRECOGNIZED_FORMAT`, inspect `clb formats`. For `IMPORT_IN_PROGRESS`, retry once after the active import finishes; if still blocked, report it instead of polling indefinitely.
