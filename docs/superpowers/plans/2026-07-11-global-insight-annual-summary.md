# Global Insight Annual Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cached cross-session annual summary described in `docs/superpowers/specs/2026-07-11-global-insight-annual-summary-design.md` for both Desktop and CLI Web.

**Architecture:** A new core query produces owner-scoped facts for one chat database and pure helpers aggregate those facts. A shared node-runtime service reuses the existing session-cache, DB/WAL signatures, temporary worker, atomic snapshot, and stale-while-revalidate patterns; one shared HTTP route feeds the existing frontend data adapter and the `/insight` Vue page.

**Tech Stack:** TypeScript, SQLite/better-sqlite3 adapters, Node worker threads, Fastify, Vue 3, Nuxt UI, ECharts, node:test, pnpm 9.

---

### Task 1: Shared types and contact identity

**Files:**

- Modify: `packages/shared-types/index.ts`
- Create: `packages/core/src/query/contact-identity.ts`
- Create: `packages/core/src/query/__tests__/contact-identity.test.ts`
- Modify: `packages/core/src/query/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/node-runtime/src/services/contacts/compute.ts`
- Modify: `packages/node-runtime/src/services/people/relationships/compute.ts`

- [ ] Add `AnnualSummary*` range, metrics, coverage, cache, task, text-length, and response types to shared-types.
- [ ] Write a failing contact identity test for platform-level and session-scoped keys.
- [ ] Run `corepack pnpm test -- packages/core/src/query/__tests__/contact-identity.test.ts` and confirm the missing export failure.
- [ ] Extract `buildContactKey` and `shouldScopeContactToSession` into core and replace the two existing private copies.
- [ ] Re-run the new test and existing contacts/relationships compute tests.

### Task 2: Core session facts and aggregation

**Files:**

- Create: `packages/core/src/query/global-insight.ts`
- Create: `packages/core/src/query/__tests__/global-insight.test.ts`
- Modify: `packages/core/src/query/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] Write failing integration tests using temporary SQLite adapters for owner-only daily/type/length facts, private contacts, group reply contacts, missing/unresolved owner, and available years.
- [ ] Run the test and confirm failure because `getAnnualSummarySessionFacts` is absent.
- [ ] Implement the minimum SQL facts query with local calendar dates and existing system-member filtering.
- [ ] Write failing pure aggregation tests for cross-session contact de-duplication, zero-filled months, active days, daily averages, message types, median/P90, and fixed length buckets.
- [ ] Implement `aggregateAnnualSummaryFacts` and range/day helpers; rerun the focused test until green.

### Task 3: Node-runtime cache, snapshot, compute, and worker

**Files:**

- Create: `packages/node-runtime/src/services/global-insight/paths.ts`
- Create: `packages/node-runtime/src/services/global-insight/time-range.ts`
- Create: `packages/node-runtime/src/services/global-insight/facts-cache.ts`
- Create: `packages/node-runtime/src/services/global-insight/signature.ts`
- Create: `packages/node-runtime/src/services/global-insight/snapshot.ts`
- Create: `packages/node-runtime/src/services/global-insight/compute.ts`
- Create: `packages/node-runtime/src/services/global-insight/worker-entry.ts`
- Create: `packages/node-runtime/src/services/global-insight/worker-runner.ts`
- Create tests beside each behavior-bearing module.

- [ ] Test and implement normalization for current year, historical year, recent 365 days, current-day denominator, and local-date signature identity.
- [ ] Test and implement versioned session facts cache entries using the existing generic `session-cache` and DB/WAL fingerprints.
- [ ] Test and implement atomic range-specific snapshots with corrupt-file backup and temp cleanup.
- [ ] Test and implement signatures containing algorithm, normalized range, local day, sorted session IDs, and DB/WAL versions.
- [ ] Test and implement cross-session compute with progress, per-session diagnostic facts, cache statistics, coverage, and privacy-safe logs.
- [ ] Test worker entry resolution for TS development, CLI `.mjs`, and Desktop bundled `.js`, then implement runner and entry.

### Task 4: Node-runtime service and lifecycle

**Files:**

- Create: `packages/node-runtime/src/services/global-insight/service.ts`
- Create: `packages/node-runtime/src/services/global-insight/service.test.ts`
- Create: `packages/node-runtime/src/services/global-insight/index.ts`
- Modify: `packages/node-runtime/src/services/index.ts`
- Modify: `packages/node-runtime/src/index.ts`
- Modify: `apps/cli/tsup.config.ts`
- Modify: `apps/desktop/electron.vite.config.ts`

- [ ] Write failing service tests for fresh, stale, missing, task reuse, explicit retry after failure, superseded worker output, and close abort.
- [ ] Implement `GlobalInsightService` by following the contacts service state machine without adding a generic framework.
- [ ] Export the service and add the global-insight worker to CLI/Desktop build inputs.
- [ ] Run service and worker-runner tests.

### Task 5: Shared HTTP route and frontend data adapter

**Files:**

- Create: `packages/http-routes/src/routes/web/global-insight.ts`
- Create: `packages/http-routes/src/routes/web/global-insight.test.ts`
- Modify: `packages/http-routes/src/context.ts`
- Modify: `packages/http-routes/src/register.ts`
- Modify: `packages/http-routes/src/index.ts`
- Modify: `src/services/data/types.ts`
- Modify: `src/services/data/fetch.ts`

- [ ] Write failing Fastify contract tests for year/recent normalization, `acceptStale`, recompute, and route-owned service shutdown.
- [ ] Implement GET annual-summary and POST recompute routes with a shared service fallback.
- [ ] Register/export the route and add typed DataAdapter methods.
- [ ] Add a focused FetchDataAdapter URL-construction test if an existing suitable test harness is present; otherwise cover it through route contracts and type checking.

### Task 6: Reusable global TimeSelect

**Files:**

- Modify: `src/components/common/TimeSelect.vue`
- Create: `src/components/common/TimeSelect.test.ts`

- [ ] Extract and test pure option/range normalization needed to supply external years/range while preserving session-driven defaults.
- [ ] Add external `rangeSource`, `allowedModes`, and `allowedRecentDays` props; watch external changes and avoid session API calls when supplied.
- [ ] Keep existing private/group behavior unchanged and default the insight page to current-year mode.
- [ ] Run the focused test and `type-check:web` after the component change.

### Task 7: Annual summary UI

**Files:**

- Modify: `src/pages/insight/index.vue`
- Create: `src/pages/insight/annual-summary/index.vue`
- Create: `src/pages/insight/annual-summary/components/AnnualInsightBoard.vue`
- Create: `src/pages/insight/annual-summary/components/AnnualCalendarGrid.vue`
- Create: `src/pages/insight/annual-summary/components/AnnualMessageTrend.vue`
- Create: `src/pages/insight/components/InsightSubnav.vue`
- Create: `src/pages/insight/time-investment/index.vue`
- Create: `src/pages/insight/relationship-changes/index.vue`
- Modify: `src/i18n/locales/{zh-CN,zh-TW,en-US,ja-JP}/insight.json`

- [ ] Implement one-page loading, fresh, stale, missing-owner, no-data, latest-year switch, and retry states.
- [ ] Implement a borderless Bento grid with top-level cards for annual KPIs/trend, activity calendar, message types, text length, and peak metrics.
- [ ] Use the existing bar chart for monthly activity and a compact CSS month calendar for daily activity.
- [ ] Reserve top-level tabs and child routes for time investment and relationship changes without preloading their business logic.
- [ ] Poll only while a task is running and stop on unmount or range change.
- [ ] Report frontend load/retry errors through the existing log-report service without exposing contact data.

### Task 8: Verification and completion audit

**Files:** All files changed above.

- [ ] Run focused core, node-runtime, HTTP route, route registration, contacts, relationships, and TimeSelect tests.
- [ ] Run `corepack pnpm run type-check:all`.
- [ ] Run ESLint only on modified TypeScript/Vue files.
- [ ] Run Prettier only on modified source, test, JSON, spec, and plan files.
- [ ] Run `corepack pnpm build:web` and the relevant CLI/Desktop worker build checks if type checking cannot prove the entries.
- [ ] Start a local dev server and verify `/insight` at desktop and mobile widths with Playwright screenshots; confirm non-overlap, empty/loading states, and chart rendering.
- [ ] Run `git diff --check` and inspect `git diff --stat` plus every changed file group.
- [ ] Audit every requirement in the design document against code/tests/runtime evidence before marking the goal complete.
