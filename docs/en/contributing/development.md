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
| `pnpm dev` | Select a development target interactively |
| `pnpm dev:desktop` | Start the Electron desktop app in development mode |
| `pnpm dev:web` | Start the CLI Web UI in development mode |
| `pnpm docs:dev` | Start the public docs site locally |
| `pnpm build:desktop` | Build the desktop app |
| `pnpm build:web` | Build the Web UI |
| `pnpm docs:build` | Build the public docs site |
| `pnpm run type-check:all` | Run both web and Node type checks |
| `pnpm lint` | Run ESLint with auto-fix |
| `pnpm format` | Run Prettier formatting |

For small changes, prefer targeted checks for the files or package you changed. For cross-module, release, or architecture changes, run the broader checks.

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

ChatLab maintains both an Electron desktop app and a CLI Web app. When changing shared business behavior, put the logic in `packages/node-runtime/src/services/` or `packages/core/` first, and keep entry points thin.

- Do not duplicate complex business flows inside Electron IPC handlers or CLI HTTP routes.
- Do not bypass `packages/core/` in entry points to write core SQL operations such as member merge, delete, or alias updates.
- Isolate platform differences through adapters or service options, and keep returned frontend data shapes consistent.
- For new session, member, index, summary, export, or import behavior, first check whether an existing shared service can be reused or extended.

## Common Change Entry Points

| If you want to change | Start here |
| --- | --- |
| Frontend pages and components | `src/pages/`, `src/components/`, `src/features/` |
| Chart analysis | `src/features/charts-*`, `src/components/charts/` |
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
- Unit tests tightly coupled to one business module should live next to the tested file and use `*.test.ts` or `*.test.js`.
- Cross-module, integration, E2E, test utility, or unclear-ownership tests should live in the root `tests/` directory.

## i18n And Copy

When changing UI copy, update Simplified Chinese, English, Japanese, and Traditional Chinese translations together. Logs, code comments, AI tool descriptions, error messages, and other non-UI text should default to English. If runtime locale is available, support bilingual Chinese/English responses where appropriate.

## Using AI While Contributing

AI can help read code, draft patches, and add tests, but public PRs must remain understandable from public context. Ask AI to read `AGENTS.md` and this page first. If you maintain your own `.docs/`, you can use it as extra context, but do not leave change rationale, test reasoning, or design assumptions only in private `.docs/` files.

## PR And Commit Rules

- Obvious bug fixes can be submitted directly.
- For new features, open an Issue for discussion first. Feature PRs submitted without prior discussion may be closed.
- Keep one PR focused on one task. Split large changes into independent PRs when possible.
- Use Conventional Commits, such as `fix(import): handle empty source` or `docs: add contributor guide`.
- Use platform scopes such as `electron`, `cli`, or `web` only for platform-specific changes. For general changes, use the module name as the scope.
