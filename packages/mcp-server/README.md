# chatlab-mcp

ChatLab MCP Server exposes local ChatLab conversation data to MCP clients such as ClaudeCode, Cursor, Codex, and OpenClaw.

It runs over stdio and provides read-only access to imported ChatLab sessions, including session discovery, keyword search, member statistics, time analysis, SQL queries, and conversation context tools.

## Quick Start

Use it directly with `npx`:

```bash
npx -y chatlab-mcp
```

The command starts an MCP stdio server and waits for an MCP client. It does not print a help screen because stdout is reserved for MCP protocol messages.

## MCP Client Configuration

Add this server to your MCP client configuration:

```json
{
  "mcpServers": {
    "chatlab": {
      "command": "npx",
      "args": ["-y", "chatlab-mcp"]
    }
  }
}
```

If you install the package globally, you can also use:

```json
{
  "mcpServers": {
    "chatlab": {
      "command": "chatlab-mcp"
    }
  }
}
```

## Data Directory

`chatlab-mcp` reads the same local data directory as ChatLab:

```text
~/.chatlab/
```

If you configured a custom ChatLab data directory in `~/.chatlab/config.toml`, the MCP server will use that configuration automatically.

MCP tools use native read-only SQLite connections and short read transactions. They do not modify logical chat records, database schema, or the data-directory compatibility marker, and they never automatically migrate sessions. A session with an older schema must first be upgraded explicitly by a writable ChatLab runtime.

**Live SQLite caveat:** WAL-mode reads may create/update `-wal` or `-shm` coordination files beside the database. This mode does **not** guarantee an unchanged filesystem directory, nor universal support for read-only mounts or databases requiring recovery. MCP query tools declare `readOnlyHint: true` and `destructiveHint: false` because they do not intentionally change _logical chat data_, perform migrations, or update compatibility metadata. Whether SQLite's auxiliary WAL/SHM coordination is compatible with the MCP annotation's broader "does not modify its environment" wording is a product/contract question for the upstream maintainers; the annotation is not a filesystem-sandbox guarantee. Queries do not create full temporary copies of chat databases.

## Available Capabilities

The server registers ChatLab tools for:

- Listing imported chat sessions
- Reading session metadata and database schema
- Searching messages and keywords
- Loading recent messages and message context
- Listing members and member activity
- Analyzing active hours, response time, interaction pairs, and daily active users
- Running read-only SQL queries
- Producing text or JSON output for tool results

## Requirements

- Node.js 22.19 or later
- Existing ChatLab data under `~/.chatlab/`

`better-sqlite3` is installed as a runtime dependency. On platforms without a matching prebuilt binary, npm may need local build tools for native modules.

`@node-rs/jieba` is optional and improves Chinese word segmentation for keyword-frequency tools. If it is unavailable, core MCP functionality still works.

## Package API

Advanced callers can import the shared server core:

```js
import { startMcpServer } from 'chatlab-mcp'
```

Most users should prefer the `npx -y chatlab-mcp` command.

## Links

- ChatLab: https://github.com/ChatLab/ChatLab
- Model Context Protocol: https://modelcontextprotocol.io/
