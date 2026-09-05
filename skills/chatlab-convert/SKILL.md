---
name: chatlab-convert
description: Convert unsupported local chat exports into validated ChatLab JSONL or JSON with a reproducible local script. Use for unknown-format adaptation, not analysis or direct import of already supported files.
---

# ChatLab Convert

Convert an unsupported local export without modifying the source. Prefer a reproducible script and a validated JSONL result over a one-off rewritten file.

## Non-negotiable rules

- Keep every source file read-only. Write scripts, samples, extracted archives, and output to a separate working directory, using the user's output location when specified.
- Keep chat data local. Do not upload it, send it to a network service, or dump message bodies into model-visible terminal output.
- Inspect structure first: keys, column names, value types, counts, timestamp shapes, and masked samples. Replace message text in diagnostic output with its type and length.
- Never silently skip a malformed or unsupported source record. Fail with its source row/index, or preserve it as message type `99` and count the mapping explicitly.
- Never install a package or system tool without approval. Prefer the installed Node.js/Python standard library; use shell only for inspection and orchestration.
- Do not import or modify ChatLab data unless the user explicitly requested import. A request to “convert and import” is sufficient authorization after all gates pass.

## Workflow

### 1. Confirm the source and CLI

Resolve the source from the request and conversation; ask only if it remains ambiguous. Quote paths in every command. Check available capabilities once, reusing results within the task.

```bash
clb --help
clb validate --help
clb formats
clb import "/absolute/path/to/source" --dry-run --json
```

If the dry run recognizes the source, report that conversion is unnecessary. Import only if requested, using `chatlab-import` when available or the preview/write steps below.

If `clb validate` is unavailable, continue with `scripts/validate-chatlab.mjs` without pausing conversion to propose installation. The bundled validator needs Node.js 22.19 or later. An older CLI may still support `formats` and import dry-run; use the capabilities it actually provides. If no CLI is available, state that native format support and import readiness could not be checked.

If neither strict validator can run, finish the converter where possible and report the output as unvalidated. Do not replace strict validation with visual inspection. Request installation authorization only when a missing runtime or CLI blocks the requested outcome.

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

Read the field contract and chosen output format in [references/chatlab-format.md](references/chatlab-format.md) before writing the converter. Record the mapping from source fields to ChatLab fields, including:

- conversation boundaries and group/private type;
- stable member identity and owner identity;
- timestamp unit and timezone;
- message type, content, original message ID, and reply relation;
- source record count and any records that cannot be represented exactly.

Ask the user only when an ambiguity changes identity, conversation boundaries, timestamp meaning, or ownership. Do not guess those fields.

One ChatLab file represents one conversation. If the source contains multiple conversations, produce one output per conversation with collision-safe deterministic names; never merge them accidentally.

### 4. Write a deterministic converter

Prefer JSONL. Use JSON only for a small, naturally structured export where holding the full result in memory is clearly safe.

Use the simplest suitable installed Node.js or Python runtime; the source format does not mandate a particular language.

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

For a large file or uncertain mapping, run a bounded local sample first. A small input can be converted and validated in full directly. With the CLI available, validate that output with:

```bash
clb validate "/absolute/path/to/sample.jsonl" --json
```

Without the CLI, locate the directory containing this `SKILL.md` and use the bundled validator:

```bash
node "/absolute/path/to/chatlab-convert/scripts/validate-chatlab.mjs" "/absolute/path/to/sample.jsonl"
```

Fix every validation error before running the full conversion. Review warnings and explain why each is acceptable; do not ignore them automatically.

### 6. Convert and validate everything

Run the full converter, then validate every generated file with the CLI or bundled validator. With the CLI available, also run the import dry run:

```bash
clb validate "/absolute/path/to/converted.jsonl" --json
clb import "/absolute/path/to/converted.jsonl" --dry-run --json
```

Without the CLI, run:

```bash
node "/absolute/path/to/chatlab-convert/scripts/validate-chatlab.mjs" "/absolute/path/to/converted.jsonl"
```

Keep the result levels distinct:

- **Format validated**: the CLI or bundled strict validator returns `ok: true`; converter and validator message counts match; source messages equal output messages plus explicitly accepted skipped records; and no source parse error was hidden.
- **Import validated**: format validation passed and `clb import --dry-run --json` also returns `ok: true`.

Without the CLI, report only “format validated.” Tell the user they can install the CLI later to run the dry-run or drag the result into ChatLab. Do not claim import validation passed.

### 7. Import only when requested

If the user asked only to convert, stop after all validation available in the current environment. Report output and script paths, conversations, members, messages, skipped records, warnings, mapping limitations, and the validation level actually reached without quoting messages.

If the user explicitly asked to import, run the same validated file without `--dry-run`:

```bash
clb import "/absolute/path/to/converted.jsonl" --json
```

If the CLI is still unavailable, explain that automatic import requires `chatlab-cli`, recommend installation, and obtain permission before installing it. Never treat “format validated” as already imported.

For multiple outputs, preview and import each independently. Report every resulting session ID and count; do not delete the converter or converted files.
