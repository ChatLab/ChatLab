# Handoff Log

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
