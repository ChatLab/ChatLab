---
outline: deep
---

# Import Chat Records

ChatLab supports several ways to import chat records.

## Desktop: Drag a file into ChatLab

This is the simplest import path:

1. Drag the chat platform's exported **data file** into the upload area on the homepage.
2. Wait for parsing and import to finish.

The homepage also supports incremental imports. When a new file matches an imported session, ChatLab adds the new messages.

## Agent: Import with an AI Skill

Use this when you already work with Codex, Claude Code, or another AI agent and want the agent to handle the import for you.

Node.js 20 or newer is required. Install ChatLab CLI and the English skill:

```bash
npm install -g chatlab-cli
npx skills add ChatLab/ChatLab --skill chatlab-import -g
```

Then ask the agent:

```text
chatlab-import import /absolute/path/to/chat-export.json into ChatLab
```

The agent previews the import in the background, then automatically creates or incrementally updates a session without asking for another confirmation.

## Terminal: Import from the command line

Install ChatLab CLI:

```bash
npm install -g chatlab-cli
```

The simplest command imports one file directly:

```bash
chatlab import "/absolute/path/to/chat-export.json"
```

### Target an existing session

To append to a specific session, use `--session-id`:

```bash
chatlab import "/absolute/path/to/chat-export.json" --session-id <session-id>
```

## Automation: Use an API or automatic sync

These advanced options are intended for ongoing integrations. The **API Import** section on the homepage provides two directions:

- **Automatic Sync (Pull):** ChatLab periodically fetches new chat records from a configured data source. See the [Pull Remote Data Source Protocol](/standard/chatlab-pull).
- **API Push (Push):** a third-party tool, plugin, or script writes records through ChatLab's local API. See the [Push Import Protocol](/standard/chatlab-import).

## If an import fails

Open **Settings** → **Storage** → **Log Files** in ChatLab, then inspect the `import` directory.

In command-line mode, the JSON `error.code` and `error.hint` fields can identify path, format, concurrent-import, or session-ID problems. If the issue remains, submit a GitHub Issue with desensitized error details.
