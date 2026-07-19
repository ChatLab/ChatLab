---
outline: deep
---

# Convert Chat Exports with AI

If ChatLab cannot recognize your export yet, a local agent can use the official conversion skill to inspect its structure, write a converter, and produce the [ChatLab standard format](./chatlab-format.md).

The conversion runs locally. The skill limits inspection to required structural information, does not print complete message bodies, and never modifies the source export.

## Prepare the tools

Install the ChatLab CLI:

```bash
npm install -g chatlab-cli
```

Install the conversion skill in a skill-compatible agent environment:

```bash
npx skills add ChatLab/ChatLab --skill chatlab-convert -g
```

## Convert an export

Give the agent the exact export path:

```text
Use $chatlab-convert to convert and import "/absolute/path/to/chat-export" into ChatLab.
```

To create the converted files without importing them:

```text
Use $chatlab-convert to convert "/absolute/path/to/chat-export" to ChatLab format. Do not import it.
```

The skill uses the installed Node.js, Python, or shell tools to:

1. check whether ChatLab already supports the source;
2. inspect only required fields, types, and counts without dumping messages;
3. resolve member, timestamp, conversation, and message-type mappings;
4. write and run a reusable local converter;
5. produce streaming JSONL by default;
6. strictly validate the format and record counts, then preview the import;
7. write to ChatLab only when import was explicitly requested.

If one source contains multiple conversations, the skill creates one output per conversation instead of merging them.

## Completion checks

Before reporting success, the agent must run both commands:

```bash
chatlab validate "/absolute/path/to/converted.jsonl" --json
chatlab import "/absolute/path/to/converted.jsonl" --dry-run --json
```

Success requires strict validation, a successful import preview, and matching source/output message counts. The converter and outputs remain available so a newer export can be converted again.

::: warning Privacy
Use an agent that can work with local files and a local terminal. Do not upload a complete chat export to an online chat box. When an unusual text format requires sampling, inspect the smallest possible range and mask message bodies.
:::
