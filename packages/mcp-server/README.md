# @chatlab/mcp-server

ChatLab MCP Server — Expose ChatLab's chat analysis capabilities via MCP protocol and REST API.

## Features

- **MCP Protocol** (stdio + SSE) for AI agent integration (Claude Code, Cursor, etc.)
- **REST API** for programmatic access
- **Read-only** — only queries data, never modifies
- **Standalone** — runs independently without the Electron app

## Usage

### Stdio Mode (for Claude Code, Cursor, etc.)

```bash
node dist/index.js --db-dir /path/to/ChatLab/data/databases
```

### HTTP Mode (REST API + SSE)

```bash
node dist/index.js --http --port 3000 --db-dir /path/to/ChatLab/data/databases
```

### Options

| Option | Description |
|--------|-------------|
| `--db-dir <path>` | Path to the ChatLab databases directory |
| `--http` | Start HTTP/SSE server instead of stdio |
| `--port <number>` | HTTP server port (default: 3000) |

Environment variable `CHATLAB_DB_DIR` can also be used to set the database directory.

## Claude Code Integration

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "chatlab": {
      "command": "node",
      "args": ["/path/to/packages/mcp-server/dist/index.js", "--db-dir", "/path/to/databases"]
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_sessions` | List all available chat sessions |
| `search_messages` | Search messages by keywords |
| `get_recent_messages` | Get most recent messages |
| `get_members` | Get all members with message counts |
| `get_member_stats` | Member activity ranking |
| `get_member_name_history` | Member historical nicknames |
| `get_time_stats` | Time-based activity statistics (hourly/daily/weekday/monthly) |
| `get_conversation_between` | Get conversation between two members |
| `get_message_context` | Get messages surrounding a specific message |
| `execute_sql` | Execute read-only SQL queries |
| `get_schema` | Get database table structure |

## REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/sessions` | List sessions |
| GET | `/api/v1/sessions/:id/members` | Get members |
| GET | `/api/v1/sessions/:id/messages?keywords=&limit=` | Search messages |
| GET | `/api/v1/sessions/:id/recent?limit=` | Get recent messages |
| GET | `/api/v1/sessions/:id/member-stats?top_n=` | Member activity stats |
| GET | `/api/v1/sessions/:id/stats/:type` | Time stats (hourly/daily/weekday/monthly) |
| POST | `/api/v1/sessions/:id/sql` | Execute SQL `{"sql": "SELECT ..."}` |
| GET | `/api/v1/sessions/:id/schema` | Get database schema |

## Build

```bash
npm install
npm run build
```
