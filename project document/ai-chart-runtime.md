# AI Chart Runtime Goal

## Final Goal

Build a slash-activated, AI-driven chart capability for ChatLab.

The feature is not a fixed report system. Users should be able to ask for flexible visual analysis in natural language, including:

- who to analyze: all members, selected members, or excluded members
- what to measure: message count, word count, image count, reply count, ratio, average length, or other SQL-computable metrics
- time range: recent N days, a month, custom range, or the current chat context
- grouping dimensions: member, date, hour, message type, keyword, or custom SQL-derived fields
- chart type: bar, line, pie, or heatmap for the first version
- chart encoding: the meaning of x, y, value, color, and series must follow the user's request

The intended flow is:

```text
User selects chart assistant with /
-> User asks a chart question
-> AI generates read-only SQL + ChartSpec
-> ChatLab validates SQL, fields, and chart schema
-> ChatLab executes the query and normalizes data
-> AI response embeds one or more chart content blocks naturally among text
```

## Product Behavior

- The chart capability is activated per message from the chat input slash menu.
- The selection is single-use: after sending, it clears automatically.
- When activated, the AI may call chart tools and return charts in the answer.
- Chart count follows the user's request. If the user asks for two charts, return two charts. If the user asks for one chart, return one chart.
- If the user did not explicitly request charts, AI may be conservative and add at most one chart only when it clearly improves ranking, trend, distribution, ratio, or density analysis.
- Charts should feel native inside the AI answer, like Markdown content blocks, not like a separate report page.
- The `render_chart` tool call should not show a normal tool capsule by default; the visible output should be the chart block. Errors may still appear as error blocks.

## Engineering Shape

First version should add:

- `ChartSpec` and chart dataset types.
- A `render_chart` analysis tool.
- A `chart` content block type in frontend and node-runtime conversation types.
- Stream support for chart payloads from tool results.
- A `ChartBlockRenderer` that uses existing chart components.
- Persistence of normalized chart rendering data so historical conversations do not need to re-run SQL.

First version chart types:

```text
bar
line
pie
heatmap
```

The AI must not output or execute:

```text
HTML
JavaScript
SVG
Canvas code
ECharts option
arbitrary frontend component code
```

ChatLab owns rendering through built-in chart components.

## Key Implementation Notes

- Existing slash skill selection already works as a single-message activation model. Reuse that interaction pattern for the chart capability.
- Existing analysis tools are opt-in through assistant/tool filtering. The chart capability should temporarily expose the required chart tools for the current request.
- Existing readonly SQL safety exists in `packages/core/src/query`. `render_chart` should reuse that safety boundary.
- Current `ToolResult` does not include chart payloads. The implementation must add a structured way to pass chart payloads through Electron and CLI Web.
- Current `ContentBlock` does not include `chart`. Add it consistently to both frontend store types and node-runtime conversation types.
- Current `ChatMessage.vue` only renders text, think, skill, tool, and error blocks. Add chart rendering through a dedicated renderer component.

## MVP Plan

1. Define chart schema and normalized data model.
2. Implement chart validation and row-to-component-data normalization.
3. Add `render_chart` as an opt-in analysis tool.
4. Add chart payload transport through tool results and stream chunks.
5. Add frontend chart content block rendering.
6. Add slash menu entry for the chart assistant/capability.
7. Add tests for schema validation, SQL safety, normalization, adapters, and frontend type coverage.

## Implemented First Slice

As of 2026-06-03, the first vertical slice is implemented:

- `ChartSpec` and `ChartPayload` live in shared core code.
- Bar, line, pie, and heatmap payload normalization is covered by core tests.
- `render_chart` is registered as an analysis tool in shared, Electron, and CLI Web paths.
- `get_schema` is available as a shared core tool so chart prompts can inspect database shape.
- Tool adapters preserve structured chart payloads in tool result details.
- AI chat messages can append chart content blocks from `render_chart` results.
- The chat UI renders chart blocks inline using existing chart components.
- Slash menu exposes a synthetic chart capability with per-message activation.

## Implemented Hardening

As of 2026-06-03, targeted hardening has also been added:

- `render_chart` now rejects non-`SELECT` / non-`WITH` SQL before calling the data provider.
- `render_chart` wraps every accepted query as a subquery with an outer `LIMIT maxRows + 1`, so model-provided large `LIMIT` clauses or trailing line comments cannot bypass ChatLab's fetch cap.
- `render_chart` tests cover parameterized SQL, enforced outer row limits, row truncation, normalized chart payload output, direct write-statement rejection, existing inner `LIMIT`, and trailing line comments.
- `tests/chart-runtime/render-chart.integration.test.ts` uses a real temporary ChatLab SQLite chat database, `CoreDataProvider`, real readonly SQL, and dynamic ChartSpec payloads to verify selected-member pie, multi-series line, and heatmap generation from chat tables.
- The same real SQLite integration test now verifies that a `WITH`-prefixed `DELETE` attempt is rejected and does not mutate chat data.
- CLI Web adapter tests cover preservation of `chart` payloads in agent tool result details.
- Conversation manager tests cover `chart` content block persistence and reload from the existing `content_blocks` JSON field.
- Current evidence indicates no explicit database migration is needed for chart history replay because `content_blocks` already stores arbitrary JSON blocks and now includes the `chart` union type.
- Frontend chart helper tests cover extraction of `chart` / `charts` payloads from agent tool result details and conversion into chart content blocks.
- `ChartBlockRenderer` imports only the four chart components it renders, avoiding accidental dependency on the full chart barrel.
- `tests/chart-smoke` provides a repeatable Vite build harness for `ChartBlockRenderer` with bar, line, pie, and heatmap payloads.
- A headless Microsoft Edge screenshot smoke test verified that `tests/chart-smoke` renders visible bar, line, pie, and heatmap chart output. Pixel analysis result: `size=1024x1600`, `non_bg=73423`, `colored=39133`, `bands=[5382, 33748, 4354, 29939]`.
- Chart capability analysis-tool allowlist logic is shared in core and used by both Electron and CLI Web runners. Activating the chart capability adds `render_chart` without duplicating it, while `get_schema` remains available through the core tool path.
- Agent event-handler regression coverage proves chart-bearing `render_chart` tool results are streamed through unchanged for frontend extraction.
- `tests/chart-runtime/agent-chart-flow.test.ts` now provides an offline Agent-level flow: a natural-language prompt enters `runAgentCore`, a fake model stream emits a `render_chart` tool call, the real chart tool normalizes rows into a line chart payload, and a final answer is streamed after the tool result.
- The same offline Agent-level test file now covers a user asking for two charts in one answer: the fake model emits pie and heatmap `render_chart` calls in one tool round, both calls use parameterized readonly CTE SQL plus ChartSpec, and both chart payloads are preserved in `tool_end` details.
- `tests/chart-runtime/real-llm-chart-flow.e2e.test.ts` now provides an opt-in real external LLM E2E harness. It creates a temporary real ChatLab SQLite database, exposes `get_schema` and `render_chart`, asks the configured model for exactly two charts, and verifies pie plus heatmap payloads when `CHATLAB_RUN_REAL_LLM_CHART_E2E=1` is set.
- `src/stores/skill.test.ts` now covers the slash-menu-facing chart capability: it appears as a compatible skill without import, activates with localized metadata, exposes `render_chart` / `get_schema`, and can be cleared through the same single-message toggle API.
- Render-only chart tool failures now become visible error content blocks instead of disappearing silently when no chart payload is returned.

## Still Pending

- Run the opt-in real external LLM E2E harness with a live API key to verify model SQL generation quality, chart count, x/y/series semantics, and inline placement without a fake stream. The harness exists, but the external API call has not been executed in this thread.
- Add stricter SQL/schema validation if future QA finds gaps around CTE shape, field references, or max row limits.
- Full in-app Electron UI smoke test with real chat data.

## Completed After Initial Implementation

- Fixed EChart.vue initialization timing bug (2026-06-04): ECharts was reading container width before layout completed, resulting in narrow canvases. Deferred `initChart()` to `nextTick` in `onMounted`.
- Browser smoke test verified: all 4 chart types render at full width without manual resize.

## Out Of Scope For MVP

- Full plugin marketplace support.
- Long-lived global chart module toggle.
- User-editable chart builder UI.
- Dataset references between tool calls.
- Graph, calendar, wordcloud, or custom ECharts option support.
