# Project Document

This folder is the handoff space for the ChatLab AI chart runtime work.

Use it when the current AI context is exhausted and another AI or engineer needs to continue without re-reading the whole conversation.

## Documents

- `ai-chart-runtime.md` records the final product goal, MVP architecture, and implementation plan.
- `handoff-log.md` records what each conversation has completed and what remains.

## Current Status

As of 2026-06-04, the first implementation slice and targeted hardening tests have been added but are not yet committed.

The active development branch is:

```text
codex/new-feature
```

The feature is implemented as a slash-activated chart capability inside the AI chat experience.

Current code covers:

- shared `ChartSpec` validation and chart data normalization
- stricter `render_chart` SQL entry validation before data-provider execution
- enforced outer SQL row limit wrapping for every `render_chart` query
- real SQLite chat-data integration coverage for flexible `render_chart` SQL + ChartSpec payloads
- real SQLite safety regression coverage for CTE-prefixed write attempts through `render_chart`
- `render_chart` tool registration for Electron and CLI Web paths
- chart payload transport through tool results
- frontend `chart` content blocks and inline chart rendering
- frontend chart payload extraction helpers and smoke-build harness coverage
- headless Edge screenshot smoke coverage for the chart renderer harness
- slash menu activation through a synthetic chart capability
- shared chart-capability tool allowlist wiring for Electron and CLI Web
- Agent event-handler preservation of chart-bearing tool results
- offline Agent-level chart flow coverage from natural-language prompt to `render_chart` tool result and final answer
- offline Agent-level multi-chart flow coverage when the user asks for two charts in one answer
- opt-in real external LLM E2E harness for model-generated SQL + ChartSpec over real temporary chat data
- frontend skill-store coverage for the slash menu chart capability and single-message toggle API
- visible error-block handling for render-only chart tool failures
- normalized chart payload persistence through existing `content_blocks` JSON storage

Known remaining work is tracked in `handoff-log.md`.
