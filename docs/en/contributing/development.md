---
layout: doc
title: Development Guide
---

# Development Guide

This guide is for contributors who want to work on ChatLab code. It covers local setup, repository structure, common change entry points, and contribution rules. Product usage belongs in the usage docs; internal tasks, drafts, and personal maintenance context are not required for public contributions.

## Read This First

- Start with this page to understand the public collaboration baseline.
- When using AI while contributing, ask it to read the root `AGENTS.md` file and this page first.
- If your workspace contains `.docs/`, you can also read `.docs/README.md` and related files. `.docs/` is an optional private development context for an individual or team. It can store tasks, decisions, AI collaboration memory, and temporary plans; public docs and public PRs should not require `.docs/` to be understood.

## Requirements

- Node.js `>=24 <25`
- pnpm `>=9 <10`

Install dependencies:

```bash
pnpm install
```

## Local Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Select Desktop, CLI Web, Web WASM, API Server, or docs interactively |
| `pnpm dev:desktop` | Start the Electron desktop app in development mode |
| `pnpm dev:cli-web` | Start CLI Web (Node backend + Web UI) in development mode at `http://127.0.0.1:3100/` by default |
| `pnpm dev:web-wasm` | Start Web WASM (browser-only runtime) at `http://127.0.0.1:3130/` by default |
| `pnpm docs:dev` | Start the public docs site locally |
| `pnpm build:desktop` | Build the desktop app |
| `pnpm build:cli-web` | Build the CLI Web UI |
| `pnpm build:web-wasm` | Build Web WASM |
| `pnpm docs:build` | Build the public docs site |
| `pnpm run type-check:all` | Run both web and Node type checks |
| `pnpm lint` | Run ESLint with auto-fix |
| `pnpm format` | Run Prettier formatting |

For small changes, prefer targeted checks for the files or package you changed. For cross-module, release, or architecture changes, run the broader checks.

## Platform Terminology

- **CLI Web** runs through `chatlab start` and includes a Node.js backend plus the Web UI.
- **Web WASM** has no Node.js backend; parsing, storage, and queries run in the browser.
- "Web" is the umbrella term. When context cannot distinguish the platform, it defaults to **Web WASM**.
- "Backend" and "API Server" refer only to the Node.js process, not the complete CLI Web platform.
- **Browser Runtime** refers only to technical capabilities such as Workers, OPFS, SQLite WASM, and browser adapters; it is not another platform name.

## Repository Structure

| Path | Responsibility |
| --- | --- |
| `src/` | Shared frontend app code, including pages, components, services, stores, and i18n |
| `src/services/` | Frontend service layer for Electron, CLI Web API, and platform capabilities |
| `apps/desktop/` | Electron main process, preload, and desktop build configuration |
| `apps/cli/` | CLI, HTTP API, CLI Web runtime, and import commands |
| `packages/core/` | Platform-independent data model, queries, imports, and member operations |
| `packages/node-runtime/` | Node.js runtime services, database, AI, exports, caches, and migrations |
| `packages/tools/` | Shared AI tool definitions and data access adapters |
| `docs/` | Public documentation site source |
| `changelogs/` | Multilingual changelogs used by the app and releases |
| `.docs/` | Optional private development context for an individual or team, not required for public contributions |

## Architecture Boundaries

ChatLab maintains the Electron desktop app, CLI Web, and Web WASM. When changing shared business behavior, put the logic in `packages/node-runtime/src/services/` or `packages/core/` first, and keep entry points thin.

- Do not duplicate complex business flows inside Electron IPC handlers or CLI HTTP routes.
- Do not bypass `packages/core/` in entry points to write core SQL operations such as member merge, delete, or alias updates.
- Isolate platform differences through adapters or service options, and keep returned frontend data shapes consistent.
- For new session, member, index, summary, export, or import behavior, first check whether an existing shared service can be reused or extended.

## Data Directory Compatibility Gate

Electron desktop, CLI Web, and MCP can share the same `userDataDir`. If a newer runtime changes the database schema, AI data, auth config, or data directory layout, an older runtime may read incorrect data or corrupt user data. Any change that makes old runtimes unsafe for the same data directory must use the data directory compatibility gate.

The compatibility metadata file is:

```text
<userDataDir>/.chatlab-meta.json
```

The existing `<userDataDir>/.chatlab` file remains only a directory marker and should not be converted to JSON.

### When To Raise The Gate

Usually raise `minRuntimeVersion` when:

- a database migration deletes, renames, or changes the meaning of tables/columns that older versions access
- AI chats, assistants, skills, tool allowlists, auth profiles, or config files change in a way older versions cannot safely parse
- the `userDataDir` layout changes so older versions would read or write the wrong location
- shared cross-runtime data changes canonical names or structure in a non-backward-compatible way

Adding optional fields that old versions safely ignore, or changing only regenerable derived data, usually does not require raising the gate.

### Implementation Rules

- Use the helpers in `packages/node-runtime/src/data-dir-compat.ts`; do not hand-roll JSON reads, writes, or semver comparison in entry points.
- CLI, MCP, and Desktop startup must check compatibility. `DatabaseManager` also checks before opening a database so long-running stale services can notice when another newer runtime raises the gate.
- A migration that raises the gate should write `.chatlab-meta.json` only after the migration actually succeeds. If writing the meta file fails, startup or database open must abort instead of continuing to serve requests.
- `minRuntimeVersion` must be a stable semver such as `0.25.1`; prerelease versions are not accepted as the formal compatibility version.
- Raising can only increase the requirement. If an existing meta file already requires a higher version, keep it.
- Merge and de-duplicate `reasons` so future debugging can identify which migration raised the gate.
- HTTP routes that hit a data directory compatibility error should return `DATA_DIR_INCOMPATIBLE` with HTTP 409, not a generic 500.

Hidden rescue override:

```bash
CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR=1
```

This only bypasses “current runtime is below the required version.” It must not bypass broken JSON, invalid fields, or invalid versions. When used, the runtime must print a clear warning about data corruption risk.

### Test Requirements

Compatibility-related changes should cover:

- upgrades from the previous stable version and earlier released versions without data loss
- missing `.chatlab-meta.json` allowing old data directories to start
- CLI/Desktop/MCP or `DatabaseManager` blocking when the current runtime is below `minRuntimeVersion`
- successful migrations writing or merging `minRuntimeVersion`, `dataCompatibilityVersion`, and `reasons`
- existing higher `minRuntimeVersion` values not being lowered
- HTTP routes mapping compatibility failures to `DATA_DIR_INCOMPATIBLE`

## Common Change Entry Points

| If you want to change | Start here |
| --- | --- |
| Frontend pages and components | `src/pages/`, `src/components/` |
| Chart analysis | `src/components/analysis/`, `src/components/charts/` |
| Data, message, and session API calls | `src/services/` |
| Electron main process | `apps/desktop/main/`, `apps/desktop/preload/` |
| CLI and Web API | `apps/cli/` |
| Shared business logic | `packages/node-runtime/src/services/`, `packages/core/` |
| AI tools and agents | `packages/tools/`, `packages/node-runtime/src/ai/`, `src/services/ai*` |
| Import parsing | `packages/core/`, `apps/cli/src/import/`, `src/services/import/` |
| Documentation site | `docs/`, `docs/.vitepress/config.mts` |
| Changelog | `changelogs/` |

## Tests And Checks

- After changing TypeScript or Vue code, run at least the relevant type check.
- After changing public docs, run `pnpm docs:build` or targeted formatting checks for the changed Markdown/config files.
- After changing shared cross-platform logic, confirm Electron and CLI Web entry points do not diverge in behavior.
- Daily default test command is `pnpm test`; to prioritize related tests, run `pnpm test -- path/to/file.test.ts`.
- `pnpm test` should include only unit/integration tests and must not depend on real LLMs, real Electron, real browsers, real network, or long-running E2E.
- Unit tests tightly coupled to one business module should live next to the tested file and use `*.test.ts` or `*.test.js`.
- Cross-module, integration, E2E, test utility, or unclear-ownership tests should live in the root `tests/` directory.
- SQL behavior, database migrations, Fastify routes, and cross-package services should prefer lightweight in-memory SQLite or temporary file fixtures that exercise real behavior. Adapter-layer tests should focus on argument passing, permission filtering, error mapping, and response contracts instead of repeating lower-level algorithm matrices.

## i18n And Copy

When changing UI copy, update Simplified Chinese, English, Japanese, and Traditional Chinese translations together. Logs, code comments, AI tool descriptions, error messages, and other non-UI text should default to English. If runtime locale is available, support bilingual Chinese/English responses where appropriate.

## Using AI While Contributing

AI can help read code, draft patches, and add tests, but public PRs must remain understandable from public context. Ask AI to read `AGENTS.md` and this page first. If you maintain your own `.docs/`, you can use it as extra context, but do not leave change rationale, test reasoning, or design assumptions only in private `.docs/` files.

## PR And Commit Rules

- Obvious bug fixes can be submitted directly.
- For new features, open an Issue for discussion first. Feature PRs submitted without prior discussion may be closed.
- Use Conventional Commits, such as `fix(import): handle empty source` or `docs: add contributor guide`.
- Use platform scopes such as `electron`, `cli`, or `web` only for platform-specific changes. For general changes, use the module name as the scope.
