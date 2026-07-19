---
name: chatlab-convert
description: Convert unsupported local chat exports into validated ChatLab JSONL or JSON by inspecting their structure, writing and running a local Node.js or Python converter, and verifying record counts before import. Use when ChatLab cannot recognize a CSV, HTML, TXT, XML, SQLite/database, vendor-specific JSON/JSONL, archive, or other chat export format, or when a user asks an agent to adapt an unknown chat format for ChatLab.
---

# ChatLab Convert

Convert an unsupported local export without modifying the source. Prefer a reproducible script and a validated JSONL result over a one-off rewritten file.

Install this skill with:

```bash
npx skills add ChatLab/ChatLab --skill chatlab-convert -g
```

## Non-negotiable rules

- Keep every source file read-only. Write scripts, samples, extracted archives, and output to a separate sibling directory.
- Keep chat data local. Do not upload it, send it to a network service, or dump message bodies into model-visible terminal output.
- Inspect structure first: keys, column names, value types, counts, timestamp shapes, and masked samples. Replace message text in diagnostic output with its type and length.
- Never silently skip a malformed or unsupported source record. Fail with its source row/index, or preserve it as message type `99` and count the mapping explicitly.
- Never install a package or system tool without approval. Prefer the installed Node.js/Python standard library; use shell only for inspection and orchestration.
- Do not import or modify ChatLab data unless the user explicitly requested import. A request to “convert and import” is sufficient authorization after all gates pass.

## Workflow

### 1. Confirm the source and CLI

Resolve the exact source path. If several files could be the export, ask the user instead of guessing. Quote paths in every command.

```bash
chatlab --help
chatlab validate --help
chatlab formats
chatlab import "/absolute/path/to/source" --dry-run --json
```

If the dry run recognizes the source, do not convert it. Use `chatlab-import` for the supported file. If `chatlab validate` is unavailable, ask the user to update `chatlab-cli`; do not replace the required validator with visual inspection.

### 2. Inspect without exposing content

Start with file metadata, encoding, archive members, JSON keys, CSV headers, XML/HTML element names, or database table schemas. Do not run `cat`, unrestricted `head`, or SQL queries that print raw message columns.

When values must be sampled, write a short local inspector that outputs only:

- field names and value types;
- record and null counts;
- timestamp and identifier shapes;
- masked text such as `<TEXT length=42>`;
- a bounded number of structurally distinct records.

For an archive, extract into the separate working directory and reject entries that escape it. For a database, open it read-only.

### 3. Define the mapping

Read [references/chatlab-format.md](references/chatlab-format.md) completely before writing the converter. Record the mapping from source fields to ChatLab fields, including:

- conversation boundaries and group/private type;
- stable member identity and owner identity;
- timestamp unit and timezone;
- message type, content, original message ID, and reply relation;
- source record count and any records that cannot be represented exactly.

Ask the user only when an ambiguity changes identity, conversation boundaries, timestamp meaning, or ownership. Do not guess those fields.

One ChatLab file represents one conversation. If the source contains multiple conversations, produce one output per conversation with collision-safe deterministic names; never merge them accidentally.

### 4. Write a deterministic converter

Prefer JSONL. Use JSON only for a small, naturally structured export where holding the full result in memory is clearly safe.

Choose the simplest installed runtime:

- Node.js for JSON, JSONL, HTML, and JavaScript-shaped exports;
- Python for CSV, SQLite, XML, encoding-heavy text, and tabular data;
- shell for file discovery and command composition only.

The converter must:

- accept input and output paths as arguments instead of embedding local paths;
- keep the source unchanged and refuse to overwrite it;
- write to a temporary output and rename only after success;
- preserve source ordering, or sort by timestamp plus a stable source ordinal;
- preserve source IDs; when an ID is absent, omit optional message IDs unless a deterministic ID is required for replies;
- derive missing member IDs deterministically from stable identity fields, never from a random value;
- stream records for large files and print progress without message bodies;
- exit nonzero on parse failures and print a final source/output/skipped count summary.

Default `skipped` to zero. Mapping an unknown message to type `99` is preservation, not a skipped record.

### 5. Prove a small sample

Run the converter on a bounded local sample or sample mode first. Validate that output:

```bash
chatlab validate "/absolute/path/to/sample.jsonl" --json
```

Fix every validation error before running the full conversion. Review warnings and explain why each is acceptable; do not ignore them automatically.

### 6. Convert and validate everything

Run the full converter, then validate every generated file:

```bash
chatlab validate "/absolute/path/to/converted.jsonl" --json
chatlab import "/absolute/path/to/converted.jsonl" --dry-run --json
```

Require all of the following before calling conversion successful:

- strict validation returns `ok: true`;
- the import dry run returns `ok: true`;
- converter output message count equals the validator message count;
- source message count equals output message count plus explicitly accepted skipped records;
- no source parse error was hidden.

### 7. Import only when requested

If the user asked only to convert, stop after validation and dry-run preview. Report output and script paths, conversations, members, messages, skipped records, warnings, and mapping limitations without quoting messages.

If the user explicitly asked to import, run the same validated file without `--dry-run`:

```bash
chatlab import "/absolute/path/to/converted.jsonl" --json
```

For multiple outputs, preview and import each independently. Report every resulting session ID and count; do not delete the converter or converted files.
