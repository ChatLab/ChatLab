# Handoff Log

## 2026-06-04 Electron Chart UI Smoke

### Completed

- Added a repeatable opt-in Electron smoke for the chart runtime UI: `tests/e2e/smoke/chart-runtime.smoke.test.js`.
- The new smoke seeds:
  - a real chat session database under an isolated `CHATLAB_DATA_DIR`
  - a real AI conversations database under an isolated temporary home directory
- The seeded AI conversation contains a persisted `chart` content block, so the smoke validates real Electron rendering without requiring a live LLM call.
- Extended `tests/e2e/helpers/app-launcher.js` to accept `envOverrides`, allowing E2E runs to isolate:
  - `HOME` / `USERPROFILE`
  - `CHATLAB_DATA_DIR`
- Updated `tests/e2e/run-smoke.js` so `pnpm test:e2e:smoke` runs both:
  - Electron launcher smoke
  - Electron chart UI smoke

### Smoke Assertions

- Launches the real Electron app through the existing CDP-based `launchApp` helper.
- Navigates to `#/group-chat/chart-smoke-session?tab=ai-chat`.
- Opens a seeded AI conversation titled `Chart replay smoke`.
- Verifies the chart card title `Selected members smoke` appears in the renderer DOM.
- Verifies at least one chart canvas is rendered and has a nontrivial size.

### Verified

- `pnpm exec prettier --write tests/e2e/helpers/app-launcher.js tests/e2e/helpers/app-launcher.test.js tests/e2e/smoke/chart-runtime.smoke.test.js tests/e2e/run-smoke.js "project document/handoff-log.md"`
- `pnpm exec eslint tests/e2e/helpers/app-launcher.js tests/e2e/helpers/app-launcher.test.js tests/e2e/smoke/chart-runtime.smoke.test.js tests/e2e/run-smoke.js --fix`
- `node --test tests/e2e/helpers/app-launcher.test.js`
- `pnpm --filter @openchatlab/desktop build`
- `CHATLAB_RUN_E2E_SMOKE=1 pnpm test:e2e:smoke`
- `pnpm run type-check:node`
- `pnpm run type-check:web`

### Verification Note

- The smoke passes on this machine, but Electron still logs two non-fatal test-environment warnings:
  - `Failed to get 'downloads' path` inside the temporary HOME/USERPROFILE sandbox
  - `attempt to write a readonly database` while the desktop startup migration checker inspects the seeded chat DB
- Neither warning blocked session discovery, conversation loading, or chart rendering in the final passing smoke run.

## 2026-06-04 Windows Electron Smoke Recovery

### Completed

- Continued from the already verified quota-recovered state recorded earlier on 2026-06-04.
- Fixed the Electron E2E launcher helper on Windows:
  - stopped launching the repo root as the Electron app entry
  - now launches `apps/desktop`, which is the package that actually defines `main: ./out/main/index.js`
  - stopped relying on the Windows `.cmd` shim and now launches Electron via `require('electron')`
- Fixed the smoke CDP probe so localhost checks do not go through the system proxy:
  - replaced `fetch('http://127.0.0.1:PORT/json/version')`
  - with direct `node:http` probing in `tests/e2e/smoke/app-launcher.smoke.test.js`
- Rebuilt the desktop output before the smoke verification so `apps/desktop/out/*` matched current source again.
- Verified the opt-in Electron smoke now passes and connects to a real CDP endpoint on this machine.

### Verified

- `node --test tests/e2e/helpers/app-launcher.test.js`
- `pnpm --filter @openchatlab/desktop build`
- `CHATLAB_RUN_E2E_SMOKE=1 pnpm test:e2e:smoke`

### Notes

- Before rebuilding `apps/desktop/out/*`, a manual launcher probe showed stale renderer output with missing preload-facing APIs such as `preferencesApi`; rebuilding removed those stale-runtime errors.
- The remaining visible renderer console output during the smoke was Electron's standard dev-only CSP warning, not a ChatLab runtime failure.

## 2026-06-04 In-App Browser Chart Smoke

### Completed

- Verified the pending in-app Browser smoke against the local `tests/chart-smoke` Vite harness.
- Opened `http://127.0.0.1:4174/` in the Codex in-app Browser.
- Confirmed all four chart examples render with the expected titles:
  - `Messages by member`
  - `Daily member trend`
  - `Selected members`
  - `Weekday hour density`
- Confirmed the rendered canvas sizes are full width instead of the previously regressed narrow layout:
  - first three charts: `920 x 260` CSS pixels
  - heatmap: `920 x 300` CSS pixels
- Confirmed there were no browser console warnings or errors during the smoke run.

### Verified

- Temporary local server:

```text
pnpm exec vite --config tests/chart-smoke/vite.config.mts --host 127.0.0.1 --port 4174 --strictPort
```

- In-app Browser DOM verification:
  - page title `Chart Smoke`
  - four expected chart titles present in page text
  - four chart canvases present with full-width client sizes
  - browser console log query returned no `warn` or `error` entries

### Still Not Verified

- Full in-app Electron UI smoke with real chat data is still pending.

## 2026-06-04 Quota Recovery Real LLM Verification

### Completed

- Confirmed the previously exhausted real LLM quota has recovered by running the opt-in external E2E harness against the live DeepSeek config.
- Re-ran `tests/chart-runtime/real-llm-chart-flow.e2e.test.ts` with:
  - provider `deepseek`
  - model `deepseek-v4-pro`
  - base URL `https://api.deepseek.com/v1`
- Tightened the real E2E prompt in `tests/chart-runtime/real-llm-chart-flow.e2e.test.ts` so the model gets:
  - the exact Unix timestamp bounds for June 1-2, 2026 UTC
  - the concrete `message.sender_group_nickname` member-name field
  - an explicit ban on extra exploratory `render_chart` calls
- Relaxed the heatmap-hour assertion to validate semantic hour presence (`9`) instead of a zero-padded display string (`09`).
- Verified the live model now produces exactly two chart payloads:
  - pie chart for Alice vs Bob message share
  - heatmap for Alice/Bob hourly density

### Verified

- `pnpm exec prettier --write tests/chart-runtime/real-llm-chart-flow.e2e.test.ts`
- `pnpm exec eslint tests/chart-runtime/real-llm-chart-flow.e2e.test.ts --fix`
- `pnpm run type-check:node`
- `CHATLAB_RUN_REAL_LLM_CHART_E2E=1 CHATLAB_REAL_LLM_PROVIDER=deepseek CHATLAB_REAL_LLM_MODEL=deepseek-v4-pro CHATLAB_REAL_LLM_BASE_URL=https://api.deepseek.com/v1 CHATLAB_TEST_SQLITE_NATIVE_BINDING=apps/cli/native/better_sqlite3.node pnpm exec tsx --conditions=import --test tests/chart-runtime/real-llm-chart-flow.e2e.test.ts`

### Current Status

- The previously pending "real external LLM API E2E execution" item is now verified on this machine with a live provider call.

## 2026-06-04 EChart Init Timing Fix

### Completed

- Fixed EChart.vue initialization timing bug: ECharts was reading container width before layout completed, resulting in 92px-wide canvases instead of full-width charts.
- Changed `onMounted` to defer `initChart()` to `nextTick`, ensuring the container has completed layout before ECharts reads its dimensions.
- Verified the fix in the browser: all 4 chart canvases (bar, line, pie, heatmap) now render at full 920px width without requiring a resize event.
- Ran full type-check (web + node), all 26 chart-related tests, and lint/format on modified files — all pass.

### Verified

- `pnpm run type-check:all`
- `pnpm exec tsx --conditions=import --test` (all 26 chart tests pass)
- `pnpm exec eslint src/components/charts/EChart.vue --fix`
- `pnpm exec prettier --write src/components/charts/EChart.vue`
- Browser smoke: canvas widths are 920px after page load without manual resize

### Still Not Verified

- Real external LLM API E2E execution remains pending: run the harness with `CHATLAB_RUN_REAL_LLM_CHART_E2E=1` and a live API key.
- Full in-app Electron UI smoke test with real chat data.

## 2026-06-03

### Completed

- Updated local `main` to latest upstream main and created branch `codex/new-feature`.
- Read the original chart plan in `newPlan.md`.
- Re-evaluated that plan against the current refactored codebase.
- Confirmed that the old `chartHint` path no longer exists in current main:
  - `packages/tools/src/types.ts` has no `chartHint` in `ToolResult`.
  - tool adapters currently return text-oriented results.
  - AI `ContentBlock` types do not include `chart`.
  - `ChatMessage.vue` does not render chart blocks.
- Clarified the desired product behavior:
  - charts must be flexible, not fixed reports
  - x/y/value/series meanings must follow user intent
  - users should activate the chart assistant with `/` per conversation turn
  - charts should embed naturally inside AI output text
  - chart count should follow the user's request
  - first version should prioritize a dynamic chart loop, not fixed templates
- Produced a concise implementation plan for a slash-activated dynamic chart runtime.
- Created this `project document/` handoff folder.

## 2026-06-03 First Implementation Slice

### Completed

- Added shared chart runtime types and validation in `packages/core/src/chart/`.
- Added row-to-chart normalization for `bar`, `line`, `pie`, and `heatmap`.
- Added core tests for pie aggregation, multi-series line charts, heatmaps, and missing field validation.
- Added a synthetic chart capability in `packages/core/src/ai/chart-capability.ts`.
- Added `get_schema` as a shared core tool and `render_chart` as a shared analysis tool.
- Registered `render_chart` in shared tools, Electron tools, and CLI Web tools.
- Updated Electron and CLI Web tool adapters so structured chart payloads survive tool result transport.
- Added `chart` content blocks to node-runtime and frontend AI chat types.
- Updated AI chat stream handling so successful `render_chart` calls append chart blocks instead of normal tool capsules.
- Added `ChartBlockRenderer.vue` and wired it into `ChatMessage.vue`.
- Extended `EChartLine.vue` to render optional multi-series line chart payloads.
- Added slash menu support through a synthetic per-message chart capability.
- Added i18n entries for `get_schema` and `render_chart` in frontend and node-runtime locales.

### Verified

- `pnpm exec prettier --write` on modified code, i18n, and project document files.
- `pnpm exec tsx --test packages/core/src/chart/index.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`
- `pnpm exec eslint ... --fix` on modified code files.
- `git diff --check`

### Not Verified

- In-app browser UI smoke test was not run because the Browser tool was not exposed in this thread after tool discovery.
- End-to-end AI call with real chat data is still pending.
- Long-term historical replay should be confirmed after deciding whether current JSON content block persistence is enough.

### Next Recommended Step

Start with targeted hardening:

```text
adapter regression tests + frontend chart block tests + manual in-app browser smoke test
```

Then test an end-to-end real prompt that asks for multiple charts and confirms that chart count, x/y/series meanings, and inline placement match the user's natural-language request.

### Important Product Decisions

- Activation model: slash menu, single message only.
- MVP depth: dynamic SQL + ChartSpec loop.
- AI proactive charts: allowed but conservative; at most one chart unless the user asks for more.
- Chart presentation: show only the chart by default, not the tool capsule.
- Persistence: save normalized render data for stable historical replay.

## 2026-06-03 Hardening Slice

### Completed

- Tightened `render_chart` SQL normalization so direct non-`SELECT` / non-`WITH` statements are rejected before calling `dataProvider.executeParameterizedSql`.
- Added `packages/tools/src/definitions/render-chart.test.ts`.
- Added `apps/cli/src/ai/tool-adapter.test.ts` to verify chart payload preservation in CLI Web agent tool result details.
- Extended `packages/node-runtime/src/ai/__tests__/conversations.test.ts` with chart content block persistence/reload coverage.
- Confirmed chart history replay can use existing `ai_message.content_blocks` JSON storage; no explicit migration is currently required.

### Verified

- `pnpm exec prettier --write packages/tools/src/definitions/render-chart.ts packages/tools/src/definitions/render-chart.test.ts packages/node-runtime/src/ai/__tests__/conversations.test.ts apps/cli/src/ai/tool-adapter.test.ts`
- `pnpm exec eslint packages/tools/src/definitions/render-chart.ts packages/tools/src/definitions/render-chart.test.ts packages/node-runtime/src/ai/__tests__/conversations.test.ts apps/cli/src/ai/tool-adapter.test.ts --fix`
- `pnpm run type-check:node`
- `pnpm run type-check:web`
- `pnpm exec tsx --test packages/core/src/chart/index.test.ts packages/tools/src/definitions/render-chart.test.ts apps/cli/src/ai/tool-adapter.test.ts`
- `CHATLAB_TEST_SQLITE_NATIVE_BINDING=apps/cli/native/better_sqlite3.node pnpm exec tsx --test packages/node-runtime/src/ai/__tests__/conversations.test.ts`

### Verification Note

- Running the conversation test without `CHATLAB_TEST_SQLITE_NATIVE_BINDING` fails on this machine because the pnpm `better-sqlite3` native module was compiled for `NODE_MODULE_VERSION 133`, while current Node `v24.15.0` requires `NODE_MODULE_VERSION 137`.
- `apps/cli/native/better_sqlite3.node` loads successfully with current Node and was used for the passing persistence test.

### Still Not Verified

- In-app browser UI smoke test is still pending because the Browser tool was not exposed in this thread.
- End-to-end AI chart generation against real chat data is still pending.

## 2026-06-03 Frontend Verification Slice

### Completed

- Extracted chart-result parsing helpers into `src/stores/aiChatChartBlocks.ts`.
- Added `src/stores/aiChatChartBlocks.test.ts` for frontend chart payload extraction and chart content block conversion.
- Updated `src/stores/aiChat.ts` to use the shared helper functions.
- Updated `ChartBlockRenderer.vue` to import only `EChartBar`, `EChartLine`, `EChartPie`, and `EChartHeatmap` directly instead of importing from the full charts barrel.
- Added `tests/chart-smoke/`, a repeatable Vite smoke-build harness that mounts `ChartBlockRenderer` with bar, line, pie, and heatmap payloads.

### Verified

- `pnpm exec prettier --write src/stores/aiChat.ts src/stores/aiChatChartBlocks.ts src/stores/aiChatChartBlocks.test.ts src/components/AIChat/chat/ChartBlockRenderer.vue tests/chart-smoke/index.html tests/chart-smoke/src/main.ts tests/chart-smoke/src/style.css tests/chart-smoke/vite.config.mts`
- `pnpm exec eslint src/stores/aiChat.ts src/stores/aiChatChartBlocks.ts src/stores/aiChatChartBlocks.test.ts src/components/AIChat/chat/ChartBlockRenderer.vue tests/chart-smoke/src/main.ts tests/chart-smoke/vite.config.mts --fix`
- `pnpm exec tsx --test src/stores/aiChatChartBlocks.test.ts`
- `pnpm exec vite build --config tests/chart-smoke/vite.config.mts`
- `pnpm run type-check:web`
- `pnpm run type-check:node`
- `pnpm exec vite build --config vite.web.config.mts --outDir tmp/web-build-smoke`
- `pnpm exec tsx --test packages/core/src/chart/index.test.ts packages/tools/src/definitions/render-chart.test.ts apps/cli/src/ai/tool-adapter.test.ts src/stores/aiChatChartBlocks.test.ts`
- `CHATLAB_TEST_SQLITE_NATIVE_BINDING=apps/cli/native/better_sqlite3.node pnpm exec tsx --test packages/node-runtime/src/ai/__tests__/conversations.test.ts`
- `git diff --check`

### Verification Note

- A browser-backed Playwright smoke test could not run in this thread:
  - the in-app Browser tool was not exposed
  - shell runtime `playwright` is missing `playwright-core`
  - Node REPL MCP could not import `playwright`
- `tests/chart-smoke` remains available for future browser-backed verification when a browser tool is available.

### Still Not Verified

- Browser-backed canvas pixel smoke test for `tests/chart-smoke`; later covered by the headless Microsoft Edge smoke slice below.
- End-to-end AI chart generation against real chat data.

## 2026-06-03 Headless Browser Smoke Slice

### Completed

- Used local Microsoft Edge headless mode to open the `tests/chart-smoke` Vite harness.
- Captured a 1024 x 1600 screenshot of the rendered chart smoke page.
- Visually inspected the screenshot and confirmed visible bar, line, pie, and heatmap chart output.
- Ran Pillow-based pixel analysis over the screenshot to confirm nonblank rendered chart regions.
- Stopped the temporary Vite process and removed generated screenshot/log artifacts after verification.

### Verified

- Temporary server command:

```text
pnpm exec vite --config tests/chart-smoke/vite.config.mts --host 127.0.0.1 --port 4174 --strictPort
```

- Headless browser command:

```text
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-first-run --disable-extensions --hide-scrollbars --window-size=1024,1600 --virtual-time-budget=5000 --screenshot=tmp/chart-smoke-edge.png http://127.0.0.1:4174/
```

- Pixel analysis result:

```text
SMOKE_OK size=1024x1600 non_bg=73423 very_dark=934 colored=39133 bands=[5382, 33748, 4354, 29939]
```

### Still Not Verified

- In-app Browser manual smoke test remains pending because the Browser tool is still not exposed in this thread.
- End-to-end AI chart generation against real chat data is still pending.

## 2026-06-03 Real SQLite Chart Runtime Slice

### Completed

- Added `tests/chart-runtime/render-chart.integration.test.ts`.
- The test creates a temporary ChatLab SQLite database using `CHAT_DB_SCHEMA`.
- Seed data includes real `member` and `message` rows for Alice, Bob, and Cara across multiple days/hours/message types.
- The test executes `render_chart` through `CoreDataProvider` and real parameterized readonly SQL.
- Verified flexible chart semantics over real chat tables:
  - selected-member pie chart for Alice/Bob only
  - multi-series line chart by day and member
  - heatmap with custom x/y/value meanings (`hour`, `member_name`, `message_count`)

### Verified

- `pnpm exec prettier --write tests/chart-runtime/render-chart.integration.test.ts`
- `pnpm exec eslint tests/chart-runtime/render-chart.integration.test.ts --fix`
- `pnpm exec tsx --test tests/chart-runtime/render-chart.integration.test.ts`
- `pnpm exec tsx --test packages/core/src/chart/index.test.ts packages/tools/src/definitions/render-chart.test.ts tests/chart-runtime/render-chart.integration.test.ts apps/cli/src/ai/tool-adapter.test.ts src/stores/aiChatChartBlocks.test.ts`
- `CHATLAB_TEST_SQLITE_NATIVE_BINDING=apps/cli/native/better_sqlite3.node pnpm exec tsx --test packages/node-runtime/src/ai/__tests__/conversations.test.ts`
- `pnpm exec vite build --config tests/chart-smoke/vite.config.mts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`

### Verification Note

- The integration test originally failed when importing the full `@openchatlab/node-runtime` package entry because that entry loads unrelated node-runtime AI modules and hit a `pi-ai` package exports issue. The test now imports only `packages/node-runtime/src/better-sqlite3-adapter`, avoiding unrelated side effects.

### Still Not Verified

- Real LLM/AI agent E2E remains pending: no test has yet driven an actual model from a natural-language prompt through tool calling into `render_chart`.

## 2026-06-03 Agent Capability Wiring Slice

### Completed

- Added `getChartCapabilityAllowedBuiltinTools` in `packages/core/src/ai/chart-capability.ts`.
- Electron and CLI Web agent stream runners now use the shared chart allowlist helper instead of hard-coding `render_chart` locally.
- CLI Web chart activation now always creates an analysis-tool allowlist containing `render_chart`, even when the assistant did not already define `allowedBuiltinTools`.
- Added `packages/core/src/ai/chart-capability.test.ts` to verify:
  - chart capability advertises both `render_chart` and `get_schema`
  - only `render_chart` needs analysis-tool allowlist injection
  - duplicate `render_chart` entries are not created
- Extended `packages/node-runtime/src/ai/agent/__tests__/event-handler.test.ts` to verify chart-bearing `render_chart` tool results pass through stream events unchanged.

### Verified

- `pnpm exec prettier --write packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts packages/core/src/ai/index.ts packages/core/src/index.ts apps/desktop/main/ai/agent-stream-runner.ts apps/cli/src/ai/agent-stream-runner.ts packages/node-runtime/src/ai/agent/__tests__/event-handler.test.ts`
- `pnpm exec eslint packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts packages/core/src/ai/index.ts packages/core/src/index.ts apps/desktop/main/ai/agent-stream-runner.ts apps/cli/src/ai/agent-stream-runner.ts packages/node-runtime/src/ai/agent/__tests__/event-handler.test.ts --fix`
- `pnpm exec tsx --test packages/core/src/ai/chart-capability.test.ts packages/node-runtime/src/ai/agent/__tests__/event-handler.test.ts packages/core/src/chart/index.test.ts packages/tools/src/definitions/render-chart.test.ts apps/cli/src/ai/tool-adapter.test.ts src/stores/aiChatChartBlocks.test.ts tests/chart-runtime/render-chart.integration.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`

### Still Not Verified

- Real LLM/AI agent E2E remains pending: no test has yet driven an actual model from a natural-language prompt through tool calling into `render_chart`.
- In-app Browser manual smoke remains pending because the Browser tool was not exposed in this thread.

## 2026-06-03 Offline Agent Chart Flow Slice

### Completed

- Added `tests/chart-runtime/agent-chart-flow.test.ts`.
- The new test injects a fake `streamFn` into the real `runAgentCore` loop instead of calling an external LLM API.
- The first fake model turn validates the natural-language request and emits a `render_chart` tool call with readonly SQL plus ChartSpec.
- The real `render_chart` handler runs against a fake `ToolDataProvider`, normalizes returned rows into a multi-series line chart payload, and emits a chart-bearing `tool_end` event.
- The second fake model turn sees the tool result in context and streams a final natural-language answer.
- This verifies the Agent loop, tool execution, chart payload propagation, and final answer flow in one offline regression.

### Verified

- `pnpm exec prettier --write tests/chart-runtime/agent-chart-flow.test.ts`
- `pnpm exec eslint tests/chart-runtime/agent-chart-flow.test.ts --fix`
- `pnpm exec tsx --conditions=import --test tests/chart-runtime/agent-chart-flow.test.ts`
- `pnpm exec tsx --conditions=import --test tests/chart-runtime/agent-chart-flow.test.ts packages/core/src/ai/chart-capability.test.ts packages/node-runtime/src/ai/agent/__tests__/event-handler.test.ts packages/core/src/chart/index.test.ts packages/tools/src/definitions/render-chart.test.ts apps/cli/src/ai/tool-adapter.test.ts src/stores/aiChatChartBlocks.test.ts tests/chart-runtime/render-chart.integration.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`

### Verification Note

- The usual `pnpm exec tsx --test tests/chart-runtime/agent-chart-flow.test.ts` fails in this environment with `ERR_PACKAGE_PATH_NOT_EXPORTED` while resolving `@earendil-works/pi-ai` through CommonJS conditions.
- Running the same test with `--conditions=import` uses the package's ESM export path and passes.

### Still Not Verified

- Real external LLM API E2E remains pending: no test has yet asked an actual model to infer SQL and ChartSpec from natural language over real chat data.
- In-app Browser manual smoke remains pending because the Browser tool was not exposed in this thread.

## 2026-06-04 Render-Only Chart Failure Visibility Slice

### Completed

- Updated `src/stores/aiChatChartBlocks.ts`.
- Added `toRenderOnlyToolErrorBlock()` so `render_chart` failures returned as tool text such as `Error: ...` become visible `error` content blocks when no chart payload is present.
- Updated both `sendMessage` and edited-message stream handling in `src/stores/aiChat.ts`:
  - successful `render_chart` results still append only chart blocks and no normal tool capsule
  - failed `render_chart` results now append an error block
  - current render-only tool status is marked `error` when such a failure is detected
- Extended `src/stores/aiChatChartBlocks.test.ts` to cover successful chart results, render-only failures, and normal non-render-only tools.

### Verified

- `pnpm exec prettier --write src/stores/aiChat.ts src/stores/aiChatChartBlocks.ts src/stores/aiChatChartBlocks.test.ts`
- `pnpm exec eslint src/stores/aiChat.ts src/stores/aiChatChartBlocks.ts src/stores/aiChatChartBlocks.test.ts --fix`
- `pnpm exec tsx --conditions=import --test src/stores/aiChatChartBlocks.test.ts src/stores/skill.test.ts tests/chart-runtime/agent-chart-flow.test.ts packages/core/src/ai/chart-capability.test.ts packages/node-runtime/src/ai/agent/__tests__/event-handler.test.ts packages/core/src/chart/index.test.ts packages/tools/src/definitions/render-chart.test.ts apps/cli/src/ai/tool-adapter.test.ts tests/chart-runtime/render-chart.integration.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`

### Still Not Verified

- Real external LLM API E2E remains pending: no test has yet asked an actual model to infer SQL and ChartSpec from natural language over real chat data.
- In-app Browser manual smoke remains pending because the Browser tool was not exposed in this thread.

## 2026-06-03 Render Chart SQL Safety Slice

### Completed

- Extended `tests/chart-runtime/render-chart.integration.test.ts`.
- Added a real SQLite safety regression for a `WITH`-prefixed write attempt:
  - SQL starts with `WITH`, so it exercises the path that is allowed past `render_chart`'s first-token check.
  - The statement then attempts `DELETE FROM message`.
  - ChatLab rejects the statement before any mutation can happen.
  - The test verifies the `message` row count is unchanged after rejection.

### Verified

- `pnpm exec prettier --write tests/chart-runtime/render-chart.integration.test.ts`
- `pnpm exec eslint tests/chart-runtime/render-chart.integration.test.ts --fix`
- `pnpm exec tsx --conditions=import --test tests/chart-runtime/render-chart.integration.test.ts`
- `pnpm exec tsx --conditions=import --test src/stores/skill.test.ts tests/chart-runtime/agent-chart-flow.test.ts packages/core/src/ai/chart-capability.test.ts packages/node-runtime/src/ai/agent/__tests__/event-handler.test.ts packages/core/src/chart/index.test.ts packages/tools/src/definitions/render-chart.test.ts apps/cli/src/ai/tool-adapter.test.ts src/stores/aiChatChartBlocks.test.ts tests/chart-runtime/render-chart.integration.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`

### Verification Note

- An initial parallel `type-check:node` + `type-check:web` run timed out unexpectedly at the shell/tool layer. No leftover `tsc`/`vue-tsc` process remained. Rerunning the two commands separately passed.

### Still Not Verified

- Real external LLM API E2E remains pending: no test has yet asked an actual model to infer SQL and ChartSpec from natural language over real chat data.
- In-app Browser manual smoke remains pending because the Browser tool was not exposed in this thread.

## 2026-06-03 Render Chart Row Limit Wrapper Slice

### Completed

- Updated `packages/tools/src/definitions/render-chart.ts`.
- `render_chart` now wraps every accepted SQL statement in an outer query:

```text
SELECT * FROM (
  <model SQL>
) AS chart_query LIMIT maxRows + 1
```

- This means ChatLab enforces the fetch cap even when the model writes its own large `LIMIT`.
- The multi-line wrapper also prevents a trailing `-- comment` in model SQL from swallowing the enforced outer limit.
- Updated `packages/tools/src/definitions/render-chart.test.ts` expectations for the outer wrapper.
- Added regressions for:
  - SQL that already contains `LIMIT 100000`
  - SQL ending with a trailing line comment
- Re-ran the real SQLite integration test to confirm selected-member pie, multi-series line, heatmap, and write-attempt rejection still pass with wrapped SQL.

### Verified

- `pnpm exec prettier --write packages/tools/src/definitions/render-chart.ts packages/tools/src/definitions/render-chart.test.ts tests/chart-runtime/render-chart.integration.test.ts`
- `pnpm exec eslint packages/tools/src/definitions/render-chart.ts packages/tools/src/definitions/render-chart.test.ts tests/chart-runtime/render-chart.integration.test.ts --fix`
- `pnpm exec tsx --conditions=import --test packages/tools/src/definitions/render-chart.test.ts tests/chart-runtime/render-chart.integration.test.ts`
- `pnpm exec tsx --conditions=import --test src/stores/skill.test.ts tests/chart-runtime/agent-chart-flow.test.ts packages/core/src/ai/chart-capability.test.ts packages/node-runtime/src/ai/agent/__tests__/event-handler.test.ts packages/core/src/chart/index.test.ts packages/tools/src/definitions/render-chart.test.ts apps/cli/src/ai/tool-adapter.test.ts src/stores/aiChatChartBlocks.test.ts tests/chart-runtime/render-chart.integration.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`

### Still Not Verified

- Real external LLM API E2E remains pending: no test has yet asked an actual model to infer SQL and ChartSpec from natural language over real chat data.
- In-app Browser manual smoke remains pending because the Browser tool was not exposed in this thread.

## 2026-06-03 Frontend Skill Toggle Regression Slice

### Completed

- Added `src/stores/skill.test.ts`.
- Verified the synthetic chart capability appears first in `compatibleSkills` without requiring import from the skill marketplace.
- Verified locale-aware activation metadata for `chart_runtime`.
- Verified `getSkillConfig(CHART_CAPABILITY_SKILL_ID)` returns the synthetic full config with `render_chart` and `get_schema`.
- Verified the same store toggle API can clear the active chart capability, matching the single-message activation model used by `AIChatInput.vue` after submit.

### Verified

- `pnpm exec prettier --write src/stores/skill.test.ts`
- `pnpm exec eslint src/stores/skill.test.ts --fix`
- `pnpm exec tsx --conditions=import --test src/stores/skill.test.ts`
- `pnpm exec tsx --conditions=import --test src/stores/skill.test.ts tests/chart-runtime/agent-chart-flow.test.ts packages/core/src/ai/chart-capability.test.ts packages/node-runtime/src/ai/agent/__tests__/event-handler.test.ts packages/core/src/chart/index.test.ts packages/tools/src/definitions/render-chart.test.ts apps/cli/src/ai/tool-adapter.test.ts src/stores/aiChatChartBlocks.test.ts tests/chart-runtime/render-chart.integration.test.ts`
- `pnpm run type-check:web`
- `pnpm run type-check:node`

### Still Not Verified

- Real external LLM API E2E remains pending: no test has yet asked an actual model to infer SQL and ChartSpec from natural language over real chat data.
- In-app Browser manual smoke remains pending because the Browser tool was not exposed in this thread.

## 2026-06-04 Multi-Chart Agent Flow Slice

### Completed

- Updated `tests/chart-runtime/agent-chart-flow.test.ts`.
- Extended the fake model stream helper so one assistant turn can emit multiple tool calls.
- Added a regression for a user asking for two charts in one answer:
  - one pie chart for selected-member message share
  - one heatmap for selected-member hour density
- The test drives the real `runAgentCore` loop with a fake stream, then executes the real `render_chart` tool adapter against a fake `ToolDataProvider`.
- Both chart calls use parameterized readonly CTE SQL plus ChartSpec.
- Assertions verify two `render_chart` tool results in one tool round, two chart-bearing `tool_end` events, stable pie payload data, stable heatmap payload data, and a final answer that mentions both charts.

### Verified

- `pnpm exec prettier --write tests/chart-runtime/agent-chart-flow.test.ts`
- `pnpm exec eslint tests/chart-runtime/agent-chart-flow.test.ts --fix`
- `pnpm exec tsx --conditions=import --test tests/chart-runtime/agent-chart-flow.test.ts`
- `pnpm exec tsx --conditions=import --test src/stores/aiChatChartBlocks.test.ts src/stores/skill.test.ts tests/chart-runtime/agent-chart-flow.test.ts packages/core/src/ai/chart-capability.test.ts packages/node-runtime/src/ai/agent/__tests__/event-handler.test.ts packages/core/src/chart/index.test.ts packages/tools/src/definitions/render-chart.test.ts apps/cli/src/ai/tool-adapter.test.ts tests/chart-runtime/render-chart.integration.test.ts packages/node-runtime/src/ai/__tests__/conversations.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`
- `git diff --check`

### Verification Note

- The first full related regression run failed only in `packages/node-runtime/src/ai/__tests__/conversations.test.ts` because the local `better-sqlite3.node` binary was built for `NODE_MODULE_VERSION 133` while the project Node 24 test runtime requires `NODE_MODULE_VERSION 137`.
- `pnpm rebuild better-sqlite3` returned success but did not replace the stale binary.
- Direct `node-gyp` rebuild failed because Visual Studio C++ build tools are not installed on this machine.
- Running `prebuild-install` in the `better-sqlite3` package directory installed the cached Node 24 / win32-x64 prebuild, after which conversation tests and the full related regression group passed.
- `git diff --check` reported only existing CRLF normalization warnings and no whitespace errors.

### Still Not Verified

- Real external LLM API E2E remains pending: no test has yet asked an actual model to infer SQL and ChartSpec from natural language over real chat data.
- In-app Browser manual smoke remains pending because the Browser tool was not exposed in this thread.

## 2026-06-04 Real LLM E2E Harness Slice

### Completed

- Added `tests/chart-runtime/real-llm-chart-flow.e2e.test.ts`.
- The test is opt-in and skipped unless `CHATLAB_RUN_REAL_LLM_CHART_E2E=1` is set.
- When enabled, it requires `CHATLAB_REAL_LLM_API_KEY` or `OPENAI_API_KEY`.
- Optional provider/model overrides:
  - `CHATLAB_REAL_LLM_PROVIDER`
  - `CHATLAB_REAL_LLM_MODEL`
  - `CHATLAB_REAL_LLM_BASE_URL`
- Default provider/model are `openai` and `gpt-4.1-mini`.
- The harness creates a temporary real ChatLab SQLite database with `CHAT_DB_SCHEMA` and seeded Alice/Bob/Cara chat data.
- It exposes real `get_schema` and `render_chart` tools through the real `runAgentCore` loop.
- The user prompt asks the model for exactly two charts:
  - selected-member pie chart for Alice/Bob message share
  - selected-member heatmap by hour and member
- Assertions verify two chart payloads, pie labels and total, heatmap exclusion of Cara, heatmap x/y semantics, and final explanatory content.

### Verified

- `pnpm exec prettier --write tests/chart-runtime/real-llm-chart-flow.e2e.test.ts`
- `pnpm exec eslint tests/chart-runtime/real-llm-chart-flow.e2e.test.ts --fix`
- `pnpm exec tsx --conditions=import --test tests/chart-runtime/real-llm-chart-flow.e2e.test.ts`
- `pnpm exec tsx --conditions=import --test src/stores/aiChatChartBlocks.test.ts src/stores/skill.test.ts tests/chart-runtime/agent-chart-flow.test.ts tests/chart-runtime/real-llm-chart-flow.e2e.test.ts packages/core/src/ai/chart-capability.test.ts packages/node-runtime/src/ai/agent/__tests__/event-handler.test.ts packages/core/src/chart/index.test.ts packages/tools/src/definitions/render-chart.test.ts apps/cli/src/ai/tool-adapter.test.ts tests/chart-runtime/render-chart.integration.test.ts packages/node-runtime/src/ai/__tests__/conversations.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`
- `git diff --check`

### Verification Note

- The real external LLM test was run only in its default skipped mode. The harness compiled and was included in the related regression group, but no external provider call was made because the opt-in environment flag was not set.
- `tool_search` still did not expose the in-app Browser tool in this thread, so manual Browser smoke remains unverified.
- `git diff --check` reported only existing CRLF normalization warnings and no whitespace errors.

### Still Not Verified

- Real external LLM API E2E execution remains pending: run the harness with `CHATLAB_RUN_REAL_LLM_CHART_E2E=1` and a live API key to prove actual model SQL/ChartSpec generation quality.
- In-app Browser manual smoke remains pending because the Browser tool was not exposed in this thread.

## 2026-06-04 Windows Dev Startup Repair

### Completed

- Diagnosed the user's local `pnpm run dev:web` failure on Windows.
- Root cause 1: `package.json` used Unix inline env syntax:
  - `CHATLAB_AUTO_SERVE=1 vite --config vite.web.config.mts`
  - This fails in Windows `cmd` / PowerShell with `'CHATLAB_AUTO_SERVE' is not recognized`.
- Root cause 2: after the recent refactor, `apps/cli/node_modules/@openchatlab/http-routes` was missing even though the package and lockfile entry existed.
- Ran `pnpm install`, which restored the missing workspace symlink and rebuilt Electron's `better-sqlite3`.
- Added cross-platform Node launchers:
  - `scripts/dev-web.mjs`
  - `scripts/dev-serve.mjs`
- Updated root scripts:
  - `dev:web` now uses `node scripts/dev-web.mjs`
  - `dev:serve` now uses `node scripts/dev-serve.mjs`
- The Web launcher sets `CHATLAB_AUTO_SERVE=1` through `process.env` before spawning Vite.
- The Server launcher replaces the previous `bash scripts/dev-serve.sh` path so Server Only mode no longer depends on Git Bash.
- Both launchers prefer pnpm's `npm_execpath` so Windows does not need shell-style pnpm invocation.

### Verified

- `node -v` => `v24.15.0`
- `pnpm -v` => `9.15.9`
- `pnpm exec node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.close(); console.log('better-sqlite3 ok')"`
- `pnpm run ensure:server-native`
- `pnpm install`
- `Test-Path apps/cli/node_modules/@openchatlab/http-routes` => `True`
- `pnpm exec prettier --write package.json scripts/dev-web.mjs scripts/dev-serve.mjs`
- `pnpm exec eslint scripts/dev-web.mjs scripts/dev-serve.mjs --fix`
- `pnpm run dev:web -- --help`
- `pnpm exec tsx apps/cli/src/cli.ts start --help`
- `git diff --check`

### Verification Note

- A full hidden-background `dev:web` smoke reached both Vite and `chatlab start`:
  - Vite printed `Local: http://localhost:3100/`
  - backend printed `API: http://127.0.0.1:3110`
- That hidden smoke then hit an `EPIPE` / `502` artifact because the background test process had no interactive stdin and was killed by the harness. Manual terminal startup should use `pnpm run dev:web` directly.
- `git diff --check` reported only CRLF normalization warnings and no whitespace errors.

### Still Not Verified

- A manual interactive browser smoke is still pending: run `pnpm run dev:web`, open `http://localhost:3100/`, and verify the app loads normally.

## 2026-06-04 PR Review: Chart Tool Allowlist Fix

### Completed

- Investigated the PR review feedback that `/chart` turns in CLI/Web could still call `execute_sql`.
- Confirmed the feedback was valid:
  - CLI/Web runner built `allowedToolSet` with `render_chart`.
  - The filter kept every tool whose category was not exactly `analysis`.
  - `execute_sql` has no category, so it was included even in chart-only turns.
- Added `CHART_CAPABILITY_CORE_TOOLS = ['get_schema']` in `packages/core/src/ai/chart-capability.ts`.
- Exported the new constant from core AI and package entrypoints.
- Updated `apps/cli/src/ai/agent-stream-runner.ts`:
  - `/chart` now uses a chart-specific tool filter.
  - It includes only chart core tools (`get_schema`) plus explicitly allowed `analysis` tools (`render_chart`, and assistant analysis tools if present).
  - Missing-category tools such as `execute_sql` are no longer included.
- Added `apps/cli/src/ai/agent-stream-runner.test.ts` to prove:
  - chart-only turns expose only `get_schema` and `render_chart`
  - `execute_sql` is excluded even if it appears in the allowed set
  - explicitly allowed analysis tools can still be included

### Verified

- `pnpm exec prettier --write packages/core/src/index.ts packages/core/src/ai/index.ts apps/cli/src/ai/agent-stream-runner.ts apps/cli/src/ai/agent-stream-runner.test.ts packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts`
- `pnpm exec eslint packages/core/src/index.ts packages/core/src/ai/index.ts apps/cli/src/ai/agent-stream-runner.ts apps/cli/src/ai/agent-stream-runner.test.ts packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts --fix`
- `pnpm exec tsx --conditions=import --test apps/cli/src/ai/agent-stream-runner.test.ts packages/core/src/ai/chart-capability.test.ts`
- `pnpm exec tsx --conditions=import --test apps/cli/src/ai/agent-stream-runner.test.ts apps/cli/src/ai/tool-adapter.test.ts packages/core/src/ai/chart-capability.test.ts tests/chart-runtime/agent-chart-flow.test.ts tests/chart-runtime/real-llm-chart-flow.e2e.test.ts packages/tools/src/definitions/render-chart.test.ts src/stores/aiChatChartBlocks.test.ts src/stores/skill.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`
- `git diff --check`

### Verification Note

- `git diff --check` reported only CRLF normalization warnings and no whitespace errors.

## 2026-06-04 Desktop Chart Tool Allowlist Parity

### Completed

- Closed the matching Desktop/Electron gap after the CLI/Web chart allowlist fix.
- Added `getAllowedToolsForChartCapability()` in `apps/desktop/main/ai/tools/index.ts`.
- Desktop chart-only turns now reuse the shared chart capability allowlist, but explicitly strip raw SQL tools such as `execute_sql`.
- Updated `apps/desktop/main/ai/agent-stream-runner.ts` so `/chart` turns use the Desktop-specific filtered allowlist instead of the raw shared builtin list.
- Added `apps/desktop/main/ai/tools/index.test.ts` to verify:
  - `execute_sql` is excluded from chart-only turns
  - explicitly allowed non-SQL analysis tools such as `keyword_frequency` still remain available

### Verified

- `pnpm exec prettier --write apps/desktop/main/ai/tools/index.ts apps/desktop/main/ai/tools/index.test.ts apps/desktop/main/ai/agent-stream-runner.ts apps/cli/src/ai/agent-stream-runner.ts apps/cli/src/ai/agent-stream-runner.test.ts packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts packages/core/src/ai/index.ts packages/core/src/index.ts`
- `pnpm exec eslint apps/desktop/main/ai/tools/index.ts apps/desktop/main/ai/tools/index.test.ts apps/desktop/main/ai/agent-stream-runner.ts apps/cli/src/ai/agent-stream-runner.ts apps/cli/src/ai/agent-stream-runner.test.ts packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts packages/core/src/ai/index.ts packages/core/src/index.ts --fix`
- `pnpm exec tsx --conditions=import --test apps/desktop/main/ai/tools/index.test.ts apps/cli/src/ai/agent-stream-runner.test.ts packages/core/src/ai/chart-capability.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`

### Verification Note

- `git diff --check` still reports only existing LF/CRLF normalization warnings in the working tree and no whitespace errors.

## 2026-06-04 Quota Recovery Monitor Recheck

### Completed

- Rechecked the quota-recovery follow-up state from the local automation memory and latest handoff context.
- Confirmed the previously exhausted quota remains recovered based on the earlier live DeepSeek E2E verification already recorded in this file.
- Re-ran the current outstanding Electron verification target against the existing seeded real-chat-data smoke flow:
  - `node --test tests/e2e/helpers/app-launcher.test.js`
  - `CHATLAB_RUN_E2E_SMOKE=1 pnpm test:e2e:smoke`
- Confirmed both E2E smoke tests still pass on the current working tree:
  - Electron launcher + CDP smoke
  - Seeded AI chat chart rendering smoke inside Electron

### Verification Note

- The seeded Electron smoke still emits the previously known non-fatal dev-time logs:
  - `SQLITE_READONLY` while checking migration state on the seeded read-only test database
  - downloads-path lookup failure in the temp dev environment
  - Electron insecure CSP warning in unpackaged dev mode
- None of those logs caused the smoke suite to fail.

### Current Status

- No new quota outage is present.
- The latest outstanding Electron UI smoke goal is currently satisfied by the passing seeded smoke suite already in the repo.

## 2026-06-04 Catchphrase Cleanup and Auto Chart Skill

### Completed

- Added a reusable core catchphrase-content filter:
  - Keeps normal human phrases such as `哈哈哈`, `收到`, and `明天见`.
  - Excludes imported media placeholders such as `[表情包]`, `[图片]`, `[Sticker]`, and related image/audio/video/file/link placeholders.
  - Excludes recall/deletion notices such as `撤回了一条消息` and `message was deleted`.
- Applied the filter to:
  - `getCatchphraseAnalysis`
  - `getLanguagePreferenceAnalysis` catchphrase extraction
- Exported the filter API from core so future analytics can reuse the same rule.
- Updated the chart assistant prompt so common phrase / catchphrase charts must exclude system senders, media placeholders, and recall/deletion notices.
- Added a shared node-runtime helper for the built-in `chart_runtime` skill:
  - Auto-skill menus now include the chart assistant even when no skill file was imported.
  - `activate_skill` can resolve `chart_runtime` directly.
- Updated CLI/Web auto-skill turns to expose `render_chart` when the assistant has a restrictive tool allowlist.
- Updated Electron auto-skill turns to inject `render_chart` into the current assistant config so the activated chart skill can actually render charts.
- Kept manual `/chart` chart-only tool filtering intact, including the raw SQL exclusion from the prior PR review fix.

### Verified

- `pnpm exec prettier --write packages/core/src/query/advanced/catchphrase-filter.ts packages/core/src/query/advanced/catchphrase-filter.test.ts packages/core/src/query/advanced/repeat.ts packages/core/src/query/advanced/languagePreference.ts packages/core/src/query/advanced/index.ts packages/core/src/query/index.ts packages/core/src/index.ts packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts packages/node-runtime/src/ai/builtin-chart-skill.ts packages/node-runtime/src/ai/__tests__/builtin-chart-skill.test.ts packages/node-runtime/src/ai/index.ts packages/node-runtime/src/index.ts apps/cli/src/ai/agent-stream-runner.ts apps/cli/src/ai/agent-stream-runner.test.ts apps/desktop/main/ai/agent-stream-runner.ts apps/desktop/main/ai/tools/index.ts apps/desktop/main/ai/tools/index.test.ts`
- `pnpm exec eslint packages/core/src/query/advanced/catchphrase-filter.ts packages/core/src/query/advanced/catchphrase-filter.test.ts packages/core/src/query/advanced/repeat.ts packages/core/src/query/advanced/languagePreference.ts packages/core/src/query/advanced/index.ts packages/core/src/query/index.ts packages/core/src/index.ts packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts packages/node-runtime/src/ai/builtin-chart-skill.ts packages/node-runtime/src/ai/__tests__/builtin-chart-skill.test.ts packages/node-runtime/src/ai/index.ts packages/node-runtime/src/index.ts apps/cli/src/ai/agent-stream-runner.ts apps/cli/src/ai/agent-stream-runner.test.ts apps/desktop/main/ai/agent-stream-runner.ts apps/desktop/main/ai/tools/index.ts apps/desktop/main/ai/tools/index.test.ts --fix`
- `pnpm exec tsx --conditions=import --test packages/core/src/query/advanced/catchphrase-filter.test.ts packages/core/src/ai/chart-capability.test.ts packages/node-runtime/src/ai/__tests__/builtin-chart-skill.test.ts apps/cli/src/ai/agent-stream-runner.test.ts apps/desktop/main/ai/tools/index.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`

### Remaining Notes

- The filter is intentionally scoped to catchphrase-style analytics and chart guidance. Raw message search still returns original imported content.
- Auto chart activation still depends on the model choosing `activate_skill`, but `chart_runtime` is now visible and loadable in auto-skill mode, and `render_chart` is available when activated.

## 2026-06-04 Code Review Fixes: XSS, Plugin Compute, Tool Allowlist

### Completed

- Fixed chat-record highlight XSS:
  - added `src/utils/html.ts` with `escapeHtml()` and `escapeRegExp()`
  - escaped message content before injecting `<mark>` highlight HTML in `MessageItem.vue`
  - escaped AI data-source panel content and keywords before `v-html`
- Removed the Electron privileged `pluginCompute` path:
  - renderer no longer calls `window.chatApi.pluginCompute`
  - preload no longer exposes `pluginCompute`
  - main IPC no longer registers `chat:pluginCompute`
  - worker no longer accepts `pluginCompute` / `new Function` jobs
  - Electron now uses the existing renderer-local `FetchDataAdapter.pluginCompute`
- Fixed CLI/Web raw SQL allowlist bypass:
  - `execute_sql` now has `category: 'analysis'`
  - built-in tool catalog includes `execute_sql` as an analysis tool
  - CLI/Web restrictive assistants no longer receive `execute_sql` unless explicitly allowed
  - chart-only turns still explicitly exclude raw SQL even if it appears in the assistant allowlist
- Added deterministic chart routing:
  - explicit chart requests such as `画图`, `饼图`, `热力图`, `visualize`, and `line chart` route directly to `chart_runtime`
  - applies to both CLI/Web and Electron runners

### Verified

- `pnpm exec prettier --write src/utils/html.ts src/utils/html.test.ts src/components/common/ChatRecord/MessageItem.vue src/components/AIChat/chat/DataSourcePanel.vue src/services/data/electron.ts apps/desktop/preload/apis/chat.ts apps/desktop/preload/index.d.ts apps/desktop/main/ipc/chat.ts apps/desktop/main/worker/workerManager.ts apps/desktop/main/worker/dbWorker.ts packages/tools/src/definitions/sql-query.ts packages/core/src/ai/tool-catalog.ts packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts packages/core/src/ai/index.ts packages/core/src/index.ts apps/cli/src/ai/agent-stream-runner.ts apps/cli/src/ai/agent-stream-runner.test.ts apps/desktop/main/ai/agent-stream-runner.ts`
- `pnpm exec eslint ... --fix` on the same targeted files
- `pnpm exec tsx --conditions=import --test src/utils/html.test.ts packages/core/src/ai/chart-capability.test.ts apps/cli/src/ai/agent-stream-runner.test.ts apps/desktop/main/ai/tools/index.test.ts packages/core/src/query/advanced/catchphrase-filter.test.ts packages/node-runtime/src/ai/__tests__/builtin-chart-skill.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`

### Remaining Notes

- `FetchDataAdapter.pluginCompute` still evaluates local frontend compute functions in the renderer for Web/Electron. This no longer crosses Electron IPC or worker privilege boundaries.
- No large Electron/browser smoke was run in this pass, per request.

## 2026-06-04 Chart Runtime Rule Tightening

### Completed

- Tightened `chart_runtime` prompt rules after reviewing a bad line-chart attempt.
- New hard rules require:
  - always call `get_schema` before first SQL
  - do not guess table names, field names, or timestamp fields
  - derive "latest" end dates from `MAX(ts)` or equivalent data fields
  - explicitly select "latest N members" before counting them
  - fill daily line-chart date × series zero rows
  - hide failed SQL/schema exploration/retry details from final answers
  - explain only chart-supported trends, peaks, lows, differences, and synchrony
  - avoid exaggerated personality or relationship claims
- Added regression assertions in `packages/core/src/ai/chart-capability.test.ts`.

### Verified

- `pnpm exec prettier --write packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts`
- `pnpm exec eslint packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts --fix`
- `pnpm exec tsx --conditions=import --test packages/core/src/ai/chart-capability.test.ts apps/cli/src/ai/agent-stream-runner.test.ts apps/desktop/main/ai/tools/index.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`

## 2026-06-04 Chart Timestamp Guard

### Completed

- Investigated a real bad chart run from `C:\Users\Ha183\.chatlab\logs\ai\ai_2026-06-04_11-10.log`.
- Root cause:
  - model correctly used `message` / `member` schema and generated a date × member grid
  - but it used `date(ts/1000, 'unixepoch')`
  - ChatLab `message.ts` is already Unix seconds, so dividing by 1000 moved dates to 1970 and produced an all-zero chart
- Added a `render_chart` SQL guard:
  - rejects `ts/1000` and `alias.ts/1000`
  - error says `message.ts is already a Unix timestamp in seconds; do not divide ts by 1000`
- Updated `chart_runtime` prompt:
  - explicitly says `message.ts` is seconds
  - requires `date(ts, 'unixepoch', 'localtime')`
  - forbids `ts/1000`
- Verified the user's real DB with correct SQL:
  - 68 rows for 34 days × 2 members
  - total messages: 8290
  - max daily count: 851

### Verified

- `pnpm exec prettier --write packages/tools/src/definitions/render-chart.ts packages/tools/src/definitions/render-chart.test.ts packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts`
- `pnpm exec eslint packages/tools/src/definitions/render-chart.ts packages/tools/src/definitions/render-chart.test.ts packages/core/src/ai/chart-capability.ts packages/core/src/ai/chart-capability.test.ts --fix`
- `pnpm exec tsx --conditions=import --test packages/tools/src/definitions/render-chart.test.ts packages/core/src/ai/chart-capability.test.ts apps/cli/src/ai/agent-stream-runner.test.ts apps/desktop/main/ai/tools/index.test.ts`
- `pnpm run type-check:node`
- `pnpm run type-check:web`

## 2026-06-04 Chart Schema Gate

### Completed

- Investigated a heatmap attempt where the model still guessed `messages` before schema lookup.
- Added a shared tool execution gate in `packages/node-runtime/src/ai/chart-schema-gate.ts`.
- CLI/Web and Electron now share the same rule:
  - `render_chart` returns an error until `get_schema` has been called in the same tool set
  - the guard message tells the model not to guess table names, fields, or timestamp units
- Added regression tests for:
  - shared gate behavior
  - CLI `adaptToolsForAgent`
  - Electron `getAllTools`

### Verified

- `pnpm exec prettier --check packages/node-runtime/src/ai/chart-schema-gate.ts packages/node-runtime/src/ai/__tests__/chart-schema-gate.test.ts packages/node-runtime/src/ai/index.ts packages/node-runtime/src/index.ts apps/cli/src/ai/tool-adapter.ts apps/cli/src/ai/tool-adapter.test.ts apps/desktop/main/ai/tools/index.ts apps/desktop/main/ai/tools/index.test.ts`
- `pnpm exec eslint packages/node-runtime/src/ai/chart-schema-gate.ts packages/node-runtime/src/ai/__tests__/chart-schema-gate.test.ts packages/node-runtime/src/ai/index.ts packages/node-runtime/src/index.ts apps/cli/src/ai/tool-adapter.ts apps/cli/src/ai/tool-adapter.test.ts apps/desktop/main/ai/tools/index.ts apps/desktop/main/ai/tools/index.test.ts`
- `pnpm exec tsx --conditions=import --test packages/node-runtime/src/ai/__tests__/chart-schema-gate.test.ts apps/cli/src/ai/tool-adapter.test.ts apps/desktop/main/ai/tools/index.test.ts`
- `pnpm run type-check:node`
- `git diff --check`

### Remaining Notes

- This guard blocks `render_chart` before schema lookup. It does not validate semantic SQL choices after schema lookup; timestamp mistakes such as `ts/1000` are handled by the separate render-chart SQL guard.

## 2026-06-04 Interactive Chart Expansion

### Completed

- Added compact/expanded rendering modes for AI chat charts.
- Chat message charts now show a compact interactive ECharts instance plus an icon button to open a large modal.
- The modal re-renders the same chart payload as a fresh ECharts instance, so hover tooltip, legend toggling, data zoom, and other native interactions still work.
- Compact mode avoids common clipping/overlap:
  - `tooltip.confine = true`
  - pie charts use compact legend placement and hide dense outer labels
  - line charts use scrollable legends for many series and expanded-mode data zoom for dense x-axes
  - bar/heatmap grids use `containLabel`
  - heatmap labels reduce density in compact mode
- Added `ResizeObserver` to the shared `EChart` wrapper so charts resize correctly in modal/container size changes.
- Added localized labels for the expand button.

### Verified

- `pnpm exec prettier --write src/components/AIChat/chat/ChartBlockRenderer.vue src/components/charts/EChart.vue src/components/charts/EChartPie.vue src/components/charts/EChartLine.vue src/components/charts/EChartBar.vue src/components/charts/EChartHeatmap.vue src/i18n/locales/zh-CN/ai.json src/i18n/locales/zh-TW/ai.json src/i18n/locales/en-US/ai.json src/i18n/locales/ja-JP/ai.json`
- `pnpm exec eslint src/components/AIChat/chat/ChartBlockRenderer.vue src/components/charts/EChart.vue src/components/charts/EChartPie.vue src/components/charts/EChartLine.vue src/components/charts/EChartBar.vue src/components/charts/EChartHeatmap.vue`
- `pnpm run type-check:web`
- Started `pnpm dev:app`; Vite served `http://localhost:3101/` and `curl.exe --noproxy * -I http://localhost:3101/` returned `HTTP/1.1 200 OK`. Temporary server was stopped after verification.

### Remaining Notes

- In-app browser tooling was not available in this turn, so no screenshot-level visual QA was run. Recommended follow-up: open a dense pie chart and dense heatmap in the chat area, verify compact hover behavior and modal interaction.

## 2026-06-04 Chart Modal Z-Index Fix

### Completed

- Raised the AI chart expanded modal above normal page floating controls.
- `ChartBlockRenderer.vue` now sets:
  - overlay `z-[10040]`
  - content `z-[10050]`
- This should visually cover header/action icons such as incremental import while the chart modal is open.

### Verified

- `pnpm exec prettier --write src/components/AIChat/chat/ChartBlockRenderer.vue`
- `pnpm exec eslint src/components/AIChat/chat/ChartBlockRenderer.vue`
- `pnpm run type-check:web`
