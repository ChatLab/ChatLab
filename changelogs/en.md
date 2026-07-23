# Changelog

## v0.34.0 (2026-07-23)

> Add private chat journey and Footprints trend insights, reorganize session insight navigation, and fix the friends-only relationship graph.

### ✨ Features

- Add a Journey view to private chat insights, with yearly chapters, monthly milestones, and key moments
- Add annual activity rhythms and monthly direct-contact trends to Footprints
- Move session overviews into Insights and align analysis navigation across Desktop, CLI Web, and Web WASM
- Redesign the interaction timeline in relationship insights around phase summaries and key moments instead of long detail lists

### 🐛 Bug Fixes

- Limit the friends-only relationship galaxy to friend nodes, relationships, and search results, with clearer connection lines

### ♻️ Refactoring

- Unify LLM configuration storage and migration to reduce cross-platform inconsistencies and concurrent write risks
- Reorganize session insight components and remove obsolete import and database code
- 【Desktop】Simplify redundant main-process and archive import implementations

## v0.33.0 (2026-07-22)

> Add Docker deployment and mobile-friendly local analysis in the browser, improve chat format conversion and validation, and strengthen local data safety.

### ✨ Features

- Add browser-based local analysis for importing, managing, and analyzing chat sessions entirely in the browser
- Add Chinese and English chat conversion Skills that generate and validate the standard ChatLab format offline
- 【CLI】Add a command to validate ChatLab format files

### 🐛 Bug Fixes

- Fix concurrent OPFS access, overview filter race conditions, word frequency totals, and relationship analysis filters in the browser app
- Bundle frontend icons locally to remove the runtime dependency on external icon services
- Align ChatLab JSONL auto-detection with format validation and reject unresolved owner metadata
- 【Desktop】Prevent migrations from deleting the active data directory and reject nested or equivalent legacy and active data paths
- 【CLI】Persist user data and system state in Docker deployments, and bind published ports to localhost by default

### 📝 Documentation

- Add a Docker deployment guide and clarify the benefits of AI analysis and local data privacy

### 👷 CI

- Publish ChatLab CLI Docker images for amd64 and arm64

## v0.32.0 (2026-07-18)

> Add a desktop app lock, make data migration safer, and fix large-file and multi-file imports.

### ✨ Features

- 【Desktop】Add an app lock with password protection, immediate locking, a startup unlock prompt, and automatic locking after inactivity

### 🐛 Bug Fixes

- Keep old data after migrating the data directory and prompt for manual cleanup, preventing source files from being deleted during migrations or retries
- Process large ChatLab JSONL files in streaming batches to prevent import freezes and preserve member avatars in merged imports
- Unify multi-file batch imports across Desktop and CLI Web with sequential progress, cancellation, and result summaries
- 【Desktop】Add failed-attempt limits, cooldowns, and startup state protection to the app lock so refreshes or restarts cannot bypass it

## v0.31.3 (2026-07-17)

> Add batch member deletion, refine the default assistant system prompt, reorganize rankings, and improve temporary directory cleanup.

### ✨ Features

- Support batch deletion of selected members with an impact confirmation before applying changes
- Separate group chat analysis into Insights and Rankings, bringing overall, repeat, catchphrase, and keyword rankings together

### ♻️ Refactoring

- Unify the HTTP server, error model, system and session routes, and JSON Push protocol across Desktop and CLI Web
- Reorganize Desktop startup, window, path, and runtime modules, and remove redundant re-export layers

## v0.31.2 (2026-07-16)

> Unify member management for group and private chats, improve automatic import guidance, and fix screenshot copying and interface stability.

### ✨ Features

- Move member management to a virtualized table with sorting by message count, group nickname, and last message time, plus row selection and Shift-click range selection
- Use the same member management experience for group and private chats, including search, aliases, chat record viewing, merging, and deletion
- Add a Home automatic import hint to the incremental import dialog

### 🐛 Bug Fixes

- [CLI Web] Fix screenshots not being copied directly as images

## v0.31.1 (2026-07-15)

> Reorganize Home import options, add Agent/CLI import previews, and fix import consistency, message ordering, and sidebar layout.

### ✨ Features

- Reorganize Home into File, API, and CLI import options
- Add official Chinese and English skills for importing and analyzing ChatLab data
- Support idempotency keys for API imports, safely replaying duplicate requests and detecting conflicts

### 🐛 Bug Fixes

- Align validation, deduplication, member inference, and dry-run results for Push imports across runtimes
- Keep backfilled chat history in chronological order using timestamps and message IDs
- Fix QCE / QQ Chat Exporter private chats being detected as groups and creating a phantom “0” member

## v0.31.0 (2026-07-13)

> Refresh the overall interface, add automatic incremental imports on Home, introduce personal insights, and improve identity management and import compatibility.

### ✨ Features

- Add automatic session matching and incremental import orchestration so repeated exports can continue into existing sessions more naturally
- Add a global Insights entry with yearly activity overviews, calendar heatmaps, and message trends
- Manage session owner identities in Settings, preserving owner and member alias metadata across export and reimport
- [CLI] Support automatic incremental imports
- [Desktop] Support automatic incremental imports

### 🐛 Bug Fixes

- Fix ChatLab JSON exports so they can be imported again while preserving member, owner, and alias metadata
- Improve automatic incremental import deduplication, mixed message identity handling, and ChatLab reimport disambiguation
- Support bracketed timestamps and dotted AM/PM markers in WhatsApp TXT parsing

### ♻️ Refactoring

- Unify navigation, card, and report component structures to reduce interaction differences between pages

### 💄 Styles

- Refine the sidebar, input area, filter controls, and Settings tab styling
- Compact the session time filters and AI conversation sidebar layout for denser information display

## v0.30.2 (2026-07-10)

> Further improve import performance and refine semantic indexing, local model downloads, and related workflows.

### ✨ Features

- Add a Rust native parser kernel for ChatLab JSON, making imports more than 10x faster
- Add more local model download sources for semantic indexing to improve model retrieval reliability
- Relax the relationship entry threshold so more sessions can open contacts and relationship analysis

### 🐛 Bug Fixes

- Fix repeated Jieba tokenizer rebuilds when no custom dictionary is configured, speeding up imports and full-text indexing
- Parse ChatLab JSON member data structurally to avoid losing avatars or roles in complex member arrays
- Clamp oversized semantic indexing content and sender names within the shared budget to reduce embedding input failures
- Clarify that storage management only applies to managed data directories to avoid treating unmanaged paths as automatically managed

## v0.30.0 (2026-07-05)

> Add an Agent-oriented entry point and improve chat record filtering, export, avatar import, and sync behavior.

### ✨ Features

- [CLI] Add commands for external Agents
- Filter chat record dialogs by member with the shared member search selector

### 🐛 Bug Fixes

- Improve display of messy chat content and reduce rendering issues in the record dialog
- Fix CSV export failures in SQL Lab
- Preserve avatars when importing JSONL and other streamed member data, including incremental avatar imports
- Open AI logs through the shared route so local CLI Web and Desktop behave consistently
- Refresh the overview identity card when the selected time range changes

### 📝 Documentation

- Add Agent query command documentation and provide the chatlab-analyze skill entry point

## v0.29.0 (2026-07-01)

> Add Contacts, introduce the relationship galaxy, and improve contact computation, avatar loading, and sidebar performance.

### ✨ Features

- Add the People module with Contacts as a subpage, plus cross-session contact aggregation, time range filters, pagination, and virtual scrolling
- Let the Contacts page manually mark group members as friends, with entry points for source conversations and chat record viewing
- Add an interaction relationship galaxy with a 3D panorama, node filters, search, a detail panel, and related contacts/group exploration
- Add High Association and Friends Only filters to the relationship galaxy, and mask names in privacy mode
- [Desktop] Download app updates silently in the background

### ⚡ Performance

- Use pagination and virtual scrolling for contact lists to reduce render pressure with many friends and group members
- Lazy-load avatars and virtualize the sidebar session list to reduce startup and page switching stutter

### 💄 Styles

- Align the dark mode main background, relationship page header, and sidebar selected state

## v0.28.1 (2026-06-26)

> Improve chat record viewing, add the import API, and fix import, sync, and local model proxy download issues.

### ✨ Features

- Add the Push Import API with per-session append, deduplication, and incremental index generation
- Automatically generate session indexes after imports across CLI, Desktop, and pull sync paths
- Improve chat record viewer controls and highlight behavior
- Hide the sidebar scrollbar by default and show it on hover

### 🐛 Bug Fixes

- Harden Push/Pull import validation, deduplication, and concurrency locks to avoid invalid writes or duplicate imports
- Include lastPlatformMessageId and importedAt in GET /api/v1/sessions/:id for incremental import boundaries
- Refresh the session list automatically after background pull sync completes
- Fix local semantic index model downloads so they use the configured proxy correctly, and initialize worker logging
- [Desktop] Align the default API port with CLI at 3110 and try following ports automatically when it is occupied
- [Desktop] Resolve HTTP, HTTPS, and SOCKS system proxy results to avoid silently bypassing the proxy for local model downloads

### ♻️ Refactoring

- [CLI] Move pull/sync import paths to the shared streaming importer and remove the legacy parser/write path
- [Desktop] Remove redundant session index generation after incremental imports

### 📝 Documentation

- Fix API port references, examples, and documentation for unavailable capabilities

## v0.28.0 (2026-06-25)

> Add Google Chat import support, introduce a unified app logger with file rotation, and improve the semantic index experience.

### ✨ Features

- Add Google Chat import support across CLI and Desktop
- Add a unified app logger with automatic file rotation and global uncaught error capture
- Replace disable with remove in semantic index management; fix legacy hash and cap list height
- Preload semantic index model on config save and move it to the AI directory
- Simplify semantic index settings by removing the search result count option in favor of a built-in default

### 🐛 Bug Fixes

- Declare stream-json/stream-chain dependencies and fix multi-chat scan fallthrough

### 📝 Documentation

- Add Google Chat to the supported platforms documentation

## v0.27.2 (2026-06-24)

> Fix multiple auth profile lifecycle issues, improve analytics service reliability, and bundle missing local embedding runtime dependencies.

### ✨ Features

- [CLI Web] Unify daily active user reporting through a shared AnalyticsService

### 🐛 Bug Fixes

- Clean up the corresponding auth profile when removing an AI service config

### ♻️ Refactoring

- Remove outdated analytics settings migration

## v0.27.1 (2026-06-23)

> Add batched API embedding for faster index builds and lazy-loaded local models; fix semantic index resume-after-crash, sync cursor regression, and AI conversation export.

### ✨ Features

- Support batched embedding via API providers, significantly speeding up index builds
- Switch local embedding models to lazy worker initialization, reducing startup overhead

### 🐛 Bug Fixes

- Fix AI conversation export to correctly export currently visible AI conversations
- Fix semantic index batched-write resume: prevent unique-constraint errors and stuck sessions after a mid-batch crash
- Fix multiple semantic worker issues: config changes not forwarded to a running worker, availability probes causing failures in normal AI chats, and inaccurate active-build tracking leading to premature worker shutdown
- Fix sync pull cursor: initial empty-page server watermark was discarded before retries, causing repeated refetches of the tail window
- Fix sync pagination cursor regression that caused unnecessary duplicate imports

### ♻️ Refactoring

- Remove dead code and over-engineered abstractions; simplify the tool catalog structure and deep-merge logic

## v0.27.0 (2026-06-22)

> Introduce vector index and evidence retrieval: locate and present chat evidence via semantic search, with a new index management UI.

### ✨ Features

- Add a semantic index management UI with conversation picker and i18n support
- Add retrieve_chat_evidence tool: AI can retrieve time-anchored chat evidence via semantic search
- Planner automatically routes evidence-type questions to the semantic retrieval tool
- Evidence blocks support expand/collapse and click-through to the source message
- Semantic retrieval supports time-range filtering
- Redesign the semantic index model selection UI
- AI process segments are now collapsible
- Streamline evidence source rows and agent tool result display

### 🐛 Bug Fixes

- Fix multi-keyword message search
- Fix UX regression in word cloud dictionary loading
- Fix ranking label formatting and emoji cleanup
- Add missing i18n text for the v8 database migration
- [CLI] Fix missing session context forwarding and preprocessing in the tool adapter

## v0.26.3 (2026-06-15)

> Improve analytics performance with on-disk caching and stale request cancellation for smoother session switching; fix several issues in word cloud, top-word stats, and the timeline panel.

### ✨ Features

- [CLI Web] Add favicon

### ⚡ Performance

- Cache analytics results to disk keyed by database file version, significantly speeding up subsequent loads
- Automatically cancel stale analytics requests when switching sessions or changing filters
- Skip re-segmentation when changing the word cloud word count to reduce unnecessary computation

### 🐛 Bug Fixes

- Fix catchphrase stats including platform reply message placeholders
- Fix word cloud text including media placeholders
- Fix language-preference and word-frequency caches not being invalidated when the Jieba custom dictionary changes
- Fix time-sensitive analytics cache entries not expiring daily
- Fix timeline panel default scroll position and session jump not working
- Fix missing context for segmented messages
- Fix AI conversation count always returning 0
- Fix the home page tutorial link not using the localized path
- Remove the screenshot button from the top of the AI chat panel
- [Desktop] Pre-bundle lazy-route dependencies to avoid 504 errors in dev mode
- [CLI] Fix false update notifications caused by mismatched package version
- [CLI] Support arrow key selection in the update prompt

### ♻️ Refactoring

- Rename the timeline panel label to 'Summary'

## v0.26.2 (2026-06-13)

> Improve the 'Who am I' session identity feature with manual owner profile selection and automatic batch-fill across same-platform sessions; fix several chart rendering and AI cache issues.

### ✨ Features

- Add 'Who am I' session identity feature: manually confirm your identity to save a platform owner profile and automatically match it across other unowned sessions on the same platform
- Automatically apply the saved owner profile after import or pull sync, reducing manual setup

### 🐛 Bug Fixes

- Fix ownerId cache inconsistency when batch-filling sessions on name-match platforms (WhatsApp / Line / Instagram)
- Fix owner profile being overwritten by stale values when multiple routes share independent PreferencesManager instances
- [CLI] Fix stale preferences cache in the sync module causing newly imported sessions to miss the owner profile during long-running server sessions
- Fix temporary files not being fully deleted after import
- Fix chart flickering during AI streaming generation
- Fix unstable render order in AI-generated charts
- Fix empty placeholder rows appearing in AI-generated charts
- Add progress indicator during AI chart generation
- Fix charts appearing incomplete in screenshots due to missing resize step before capture
- Clarify that last_message_time represents data coverage end time, not the group's last activity time
- Fix stale overview and analysis caches not being invalidated after incremental import

## v0.26.1 (2026-06-10)

> Fix several tool-call history replay issues and complete tool-call persistence and replay support; add Token cache usage stats to the status bar and support multiple export formats.

### ✨ Features

- Add Token cache hit/miss usage display to the chat status bar
- Support TXT, JSON, and Markdown export formats

### 🐛 Bug Fixes

- Persist and replay tool calls across conversation turns to maintain multi-turn AI context
- Fix tool-only assistant turns being filtered out during history replay, causing tool results to be lost
- Fix repeated exports of the same session silently overwriting the previous file due to a deterministic filename
- Desktop: Fix large session exports failing prematurely due to the 60-second IPC timeout
- Fix DeepSeek tool-call turns not replaying `reasoning_content` in history
- Fix replayed tool results not being counted correctly in history compression token accounting
- Fix raw message data leaking into the tool result text sent to the model
- Fix the tool panel not closing when clicking outside

### ♻️ Refactoring

- Extract the session page header into a shared component

## v0.26.0 (2026-06-10)

> Add an AI analysis planner with streaming structured plan generation and chart planning integration; improve chart mode tool availability and fix several AI and import issues.

### ✨ Features

- Add an AI analysis planner with streaming structured plan generation and block rendering
- Integrate chart planning support so AI analysis plans can automatically transition into chart generation
- Provide the planner with startup context and extended data snapshots for deeper, higher-quality analysis
- Prefer high-level tools over raw SQL when rendering charts to reduce permission requirements
- Improve overall AI analysis and chart behavior
- Add a chart auto-mode preference setting
- Add copy-message-ID actions
- Add LLM fallback for shadow routing and log routing decisions
- CLI: Expose full agent stream events

### 🐛 Bug Fixes

- Fix the `render_chart` tool being dropped when a chart skill is explicitly selected
- Fix tool availability gaps in explicit chart mode and plan status after errors
- Migrate ECharts 6 `containLabel` configuration and hide redundant pie chart legends
- Fix settings page navigation order, `skillSettings` key naming, and SubTabs line-wrapping
- Fix assistant messages not filling the full chat area width
- Improve the visual layout of the analysis plan generation block
- Fix thinking-level selection not persisting across restarts
- Fix JSONL timestamp normalization causing incremental import failures
- Desktop: Fix `execute_sql` tool not being registered in the desktop tool registry

### test

- Add an evaluation set for agent routing decisions

## v0.25.1 (2026-06-08)

> Introduce a data directory compatibility gate to prevent older runtimes from writing to upgraded data directories, and add a CLI `ai chat` command.

### ✨ Features

- Add a data directory compatibility gate: after writing v6 schema data, record the minimum required runtime version to prevent older runtimes from corrupting upgraded directories
- Verify data directory compatibility before each database operation and reject access when the version requirement is not met
- Desktop: Check data directory compatibility at startup and show an error dialog before quitting if the requirement is not met
- CLI: Check data directory compatibility at startup and exit immediately if the requirement is not met
- CLI: Add the `ai chat` command for multi-turn AI conversations directly in the terminal

### 🐛 Bug Fixes

- Use the packaged app version (not Electron's dev-mode 0.0.0) when writing the compatibility gate, and require a valid runtime identity
- Write the compatibility gate after database migrations and imports complete; abort startup migrations immediately on failure instead of failing silently
- MCP: Check data directory compatibility at startup and exit early to prevent writing incompatible data
- Desktop: Map compatibility gate errors to 409 responses in the HTTP API so the frontend can show an upgrade prompt
- CLI: Normalize AI tool names and fix edge cases in the `ai chat` command

### ♻️ Refactoring

- Align AI chat and segment identifier naming

### test

- Add test coverage for the parser, config migration, database migration, HTTP routes, and AI tools

### 📝 Documentation

- Add public documentation for the data directory compatibility gate, explaining version restrictions and upgrade rules when sharing a data directory

## v0.25.0 (2026-06-07)

> AI chat can now generate charts through skills, with fixes for tool rounds, the desktop title bar, and the development service lifecycle.

### ✨ Features

- Add a slash-activated AI chart runtime that can generate and render ECharts charts in conversations
- Improve the AI chart result experience with clearer rendering states and support for more chart types

### 🐛 Bug Fixes

- Increase the default AI Agent tool round limit to reduce early stops in complex tasks
- Fix preset question chips and sidebar elements stacking incorrectly
- CLI Web: Fix incomplete cleanup of the development backend lifecycle
- Desktop: Register the chart tool for automatic skills so chart skills can run correctly
- Desktop: Refresh the Windows title bar overlay cache after theme changes and smooth its display

### ♻️ Refactoring

- Centralize the AI chart runtime policy and unify chart tool enablement across CLI and desktop
- Deduplicate skill menu and Skill Manager logic

### 📝 Documentation

- Update the iMessage chat export guide

### 🔧 Chores

- Move maintainer-only skills out of the public repository into private maintenance context

## v0.24.1 (2026-06-04)

> Adds in-app update notices and default AI preprocessing rules, with fixes for update badges and desensitization settings.

### ✨ Features

- Add an in-app update notice entry so the sidebar can surface the latest release details
- Add default AI preprocessing settings for data cleaning, denoising, and desensitization
- Support grouped AI desensitization rules to make built-in and custom rules easier to manage

### 🐛 Bug Fixes

- Fix incorrect New badges caused by failed update checks, stale update caches, and CLI Web development placeholder versions
- Fix built-in desensitization rules not being applied before AI preprocessing runs
- Fix empty desensitization preference overrides not clearing previously saved built-in rule switches
- Fix legacy built-in desensitization rule overrides being lost during migration

### 📝 Documentation

- Add a public development guide covering local setup, directory responsibilities, and collaboration conventions

### 👷 CI

- Add Markdown changelog links to the release workflow

## v0.24.0 (2026-06-03)

> Adds CLI Web authentication and data directory migration, unifies cross-platform HTTP routes, and fixes data migration, AI settings, and import refresh issues.

### ✨ Features

- Add Markdown generation for multilingual release notes
- Allow legacy data migration prompts to be ignored from storage management
- [CLI Web] Add a login page, token authentication, and persistent login state
- [CLI Web] Support data directory migration from Web settings
- [CLI] Add the --require-auth flag to protect /\_web/\* API access
- [Desktop] Add an internal HTTP service so the frontend can use shared service adapters

### 🐛 Bug Fixes

- Fix multiple edge cases in data directory and database migrations to prevent missing legacy columns or failed reads after path changes
- Fix legacy data migration prompts appearing incorrectly when no legacy data exists or after directory changes
- Fix sidebar message counts not refreshing after incremental imports
- Fix sidebar collapsed state being lost after refresh because it was stored only in sessionStorage
- Fix fetch-models and validate buttons not being enabled when editing AI settings with a saved key
- Fix stability issues in shared AI SSE streaming
- Fix custom data source creation not requiring a token
- [Desktop] Move chart plugin computation to a worker to avoid blocking the main thread

### ♻️ Refactoring

- Extract the @openchatlab/http-routes shared package to unify HTTP route implementations across CLI Web and Desktop
- Move AI settings, assistants, skills, conversations, streaming responses, cache, and merge APIs to shared HTTP routes
- Trim the desktop IPC bridge by removing legacy AI, session index, LLM, Assistant, Skill, and NLP compatibility handlers
- Unify the frontend service layer to reduce Electron/Web mode branching

### ⚡ Performance

- Minify the main process bundle and lazy-load the tiktoken rank table to reduce startup and package size pressure

### 👷 CI

- Fix the Windows release workflow zstd cache issue and add CLI update notes to release notes

### 🔧 Chores

- Align Node type-check projects to cover desktop and shared Node code

## v0.23.1 (2026-06-01)

> Adds a clb command alias and port conflict detection with actionable guidance. Fixes daemon silent exit and several UI issues in dark mode.

### ✨ Features

- Improve the page header and toolbar layout
- [CLI] Detect port conflicts before startup and display clear guidance (switch port or run lsof) instead of a delayed EADDRINUSE error
- [CLI] Add clb as a short alias for the chatlab command

### 🐛 Bug Fixes

- Fix sidebar tooltip misplacement and Nuxt UI v4 API compatibility
- Fix red background and incorrect z-index layering in the title bar under dark mode
- Tighten AI message role parameter types and strengthen conversation test assertions
- [CLI] Fix daemon entry point error that caused the service to exit silently after startup
- [CLI] Improve error handling and messaging for port conflict detection
- [CLI] Fix missing chatlab.fun reverse proxy route in web mode

## v0.23.0 (2026-05-31)

> Overhauls message editing with a fork/regenerate model, adds per-model thinking level controls, unifies the CLI entry point, and fixes multiple reasoning detection and computation issues.

### ✨ Features

- Add a Fork button to AI replies to branch the conversation from any point into an independent session
- Add a per-model thinking level selector in the status bar, with the choice remembered per model slot
- Extend thinking level controls with default and auto options, covering Kimi, Doubao, Gemini, and more model families
- Split the message analysis view into Type Analysis and Time Analysis tabs, each with enriched statistical insight cards
- Add a confirmation dialog before regenerating all session indexes to prevent accidental data loss
- Expand demo data to 4 files covering group and multiple private chat scenarios
- 【CLI】Add unified chatlab start command with --headless and --no-open flags
- 【CLI】Add daemon mode via chatlab start --daemon to install as a system service, with stop and status commands

### 🐛 Bug Fixes

- Fix multiple concurrency issues in message editing that could cause data loss or stale state
- Fix thinking level and context window computation not using the active model ID
- Fix reasoning detection failure for custom models with only chat capabilities by adding a heuristic fallback
- Fix thinking being silently disabled for Kimi, Doubao, and similar models when the auto level is selected
- 【CLI】Fix the start command failing to launch the web development backend
- 【CLI】Fix daemon startup failure on Linux when the service path contains spaces

### ♻️ Refactoring

- Refactor the message branching system to an edit-and-regenerate model, supporting both current-round-only and overwrite-all modes
- Remove the manual Reasoning Model and Disable Thinking toggles in favor of automatic inference from model capabilities
- Simplify the model switcher button UI and improve session index loading performance

## v0.22.1 (2026-05-29)

> Adds session summary detail level settings, and fixes CLI Web batch summary freeze, AI config edit misidentification, and several API credential detection issues.

### ✨ Features

- Add session summary detail level setting with "Brief" and "Standard" strategies, configurable in AI settings

### 🐛 Bug Fixes

- Fix missing credential revalidation when changing Base URL in OpenAI-compatible mode
- Fix incorrect API key detection logic to prevent stale key reuse
- Fix stop button not responding immediately during batch summary generation
- [CLI Web] Fix page freeze caused by batch summary generation
- [CLI Web] Fix batch summary generation not honoring the selected session scope
- [CLI Web] Fix third-party AI service misidentified as local when editing config

### ♻️ Refactoring

- Move session index i18n keys from the storage namespace to the ai namespace

### 💄 Styles

- Improve chat record list density and message bubble styling

### 📝 Documentation

- Restructure documentation site navigation and move Quick Start under the Usage section

## v0.22.0 (2026-05-26)

> This update improves the default UI styling, adds CLI Web update and storage management features, and strengthens home import, documentation, and multi-platform stability.

### ✨ Features

- Restructure the home import area into separate entry points, with new API import and auto-sync options
- Bundle changelogs with the app to reduce runtime dependency on remote resources
- 【CLI Web】Add storage management in Web settings for viewing and managing data cache
- 【CLI】Add update checking and auto-update flow, with update checks exposed in CLI Web
- 【Docs】Add the standalone docs.chatlab.fun documentation site

### 🐛 Bug Fixes

- Restore missing quick start buttons on the home page
- Fix incorrect i18n key paths and deprecated ECharts api.style() usage
- Harden self-update and migration retry safety checks
- 【Desktop】Prevent unified migration from reverting data directory changes
- 【CLI Web】Remove the broken Update Now action when a new version is detected
- 【CLI Web】Disable the unavailable Web self-update execution path
- 【CLI Web】Fix file manager actions that relied on shell execution, improving compatibility and safety
- 【CLI Web】Keep the Web service running after data directory warnings
- 【CLI Web】Add compatibility shims for merge-related APIs
- 【CLI】Improve update checks with async caching, better keypress handling, and a development-mode bypass

### ♻️ Refactoring

- Move documentation links to docs.chatlab.fun
- 【Settings】Move session index into AI settings and reorder the settings tabs

### 💄 Styles

- Improve sidebar density and increase tab selector contrast in dark mode

### 📝 Documentation

- Restructure the public documentation site and export guide

### 🔧 Chores

- Migrate workspace packages to ESM
- Isolate documentation site workspace dependencies
- Move release changelogs out of the docs directory

## v0.21.1 (2026-05-23)

> Improve pull sync reliability and data safety, add an option to clean up imported chats when removing subscriptions, and fix UI animation and modal interaction issues.

### ✨ Features

- Auto-generate session index after pull sync
- Add option to delete imported chats when removing a subscription
- 【CLI Web】Support per-version screenshots in the changelog modal and make Markdown list fixes opt-in
- 【MCP】Add icon and i18n support for the ci change type

### 🐛 Bug Fixes

- Fix potential data loss on small pages during pull sync and validate retry import results
- Fix session index not auto-generating after pull sync completes
- Fix sidebar session list not refreshing after pull completes or data is deleted
- Fix inability to fetch all sessions when the remote server lacks pagination support
- Improve pull sync retry logic and pagination strategy for better stability
- Fix missing schema check in session existence validation that caused 'no such table' errors
- Fix forced session index modal unexpectedly closing on generation failure
- Fix session index modal blocking the page when sessions are empty
- 【Desktop】Fall back to the package.json version when app.getVersion returns 0.0.0
- 【CLI Web】Sync icon now spins in-place instead of showing a separate loader

### 📝 Documentation

- Update Pull protocol docs to the since+nextSince pagination model

## v0.21.0 (2026-05-22)

> This update adds MCP support, unifies multi-platform import and service layers, and improves Web, AI, sync, and release stability.

### ✨ Features

- Support a unified folder import flow across Electron and Web mode for multi-file chat history formats
- 【MCP】Add a standalone command entry and integrate MCP settings into the settings page
- 【MCP】Expand the server to 19 tools with compact text and JSON output formats

### 🐛 Bug Fixes

- Harden directory import path handling to reduce import failure risks
- Fix a race condition that could occur when adding new subscriptions
- Parse MiniMax streaming <think> content correctly as thinking events
- 【CLI Web】Fix incremental import support
- 【CLI Web】Keep session not-found and member history behavior aligned with the desktop app
- 【CLI Web】Fix the Node runtime configuration for the development server
- 【MCP】Fix native module ABI binding mismatches during startup

### ♻️ Refactoring

- Unify the shared service layer for CLI Web and Electron to reduce duplicated route and IPC logic
- 【MCP】Trim the externally exposed tool registry to reduce tool schema cost for external AI agents
- 【MCP】Extract core MCP capabilities into a standalone shared package and simplify CLI and desktop integration
- 【MCP】Simplify settings page integration and reduce desktop-side helper complexity

### 👷 CI

- 【CLI】Publish the npm package as part of the release workflow

### 📝 Documentation

- Document prefix and ordering rules for platform-specific changelog entries

### 🔧 Chores

- 【CLI】【MCP】Complete the configuration and release notes needed for npm publishing

## v0.20.0 (2026-05-19)

> This update unifies the core multi-platform architecture and improves AI, import, sync, and desktop build stability. It also prepares for the standalone Web, CLI, and MCP capabilities in the next release; please update before using the CLI so data can be pre-migrated.

### ✨ Features

- Add standalone CLI, HTTP API service, and MCP Server foundations for command-line use, Web, and AI agent integrations
- Add a standalone Web build and one-command startup flow, including launching the Web UI from the CLI and opening the browser automatically
- Support core Web-mode workflows, including chat import, demo import, session queries, member queries, search, and analysis
- Connect Web mode to AI chat, model configuration, custom providers and models, context compression, and streamed event display
- Upgrade imports to a shared streaming pipeline with multi-format parsing, incremental import, import analysis, and automatic session index generation
- Add server-side capabilities for merge workflows, Markdown export, and session caching
- Add the shared sync package and CLI automation support as groundwork for future multi-platform sync
- Add backend persistence for preferences and automatically detect and migrate desktop data on first CLI run

### 🐛 Bug Fixes

- Fix Web-mode issues around session indexes, CORS proxying, demo safeguards, and runtime errors
- Fix the app version showing as empty in Web mode
- Fix AI Agent evidence retrieval, Web event streaming, and error formatting issues
- Fix inconsistencies between sync display and import logic
- Fix ESM module resolution in CLI development mode
- Fix cases where the CLI could not find existing desktop data after installation
- Fix data migration path mismatches after extracting the Electron package
- Fix packaged Worker crashes caused by an indirect dependency on the electron module
- Fix Electron build, dependency installation, and better-sqlite3 native rebuild issues

### ♻️ Refactoring

- Move the project to a multi-platform workspace structure with apps/desktop, apps/cli, and shared packages
- Extract parser, configuration, database adapters, queries, migrations, NLP, session cache, import, merge, export, and sync logic into shared modules
- Extract AI Agent, tools, preprocessing, context compression, RAG, LLM configuration, assistant, and skill management into shared runtime capabilities
- Unify AI tool naming, tool registration, and data access across Electron, CLI Web, and MCP
- Unify core logic for data directories, message queries, member queries, session indexes, SQL execution, and import deduplication
- Move the CLI from packages/server to apps/cli and complete the npm publishing build pipeline
- Move frontend-only chart modules into src/features so packages only contain reusable shared libraries
- Remove several Electron-side passthrough files and obsolete code to reduce duplicate implementations

### build

- Upgrade Vite and related build tooling
- Add CLI tsup builds, Web asset bundling, and npm publishing configuration
- Adjust Electron desktop build settings and remove Linux desktop build targets

### 📝 Documentation

- Document versioning, commit scope conventions, and related development notes

## v0.19.0 (2026-05-06)

> This update adds AI context auto-compression, introduces demo data for new users, and improves model configuration and debugging.

### ✨ Features

- Add model context window presets and custom configuration.
- Add AI chat context auto-compression and related settings.
- Improve the context compression flow and status display.
- Add raw data viewing in debug mode and record full LLM context.
- Improve AI model configuration copy, forms, and settings displays.
- Remove vector model configuration to simplify related settings.
- Let new users try demo data directly from the empty state.
- Migrate the project structure to pnpm workspace.

### 🐛 Bug Fixes

- Fix the fast model follow-assistant mode using the wrong model in some cases.
- Fix the demo button not appearing in the empty data state.
- Fix a startup risk caused by undeclared axios imports in the main process.

## v0.18.4 (2026-04-29)

> This update optimizes model stability, supports fetching remote model lists, improves AI error detail presentation, and refines some styles.

### ✨ Features

- Support fetching remote model lists.
- Auto-complete `/v1` for OpenAI-compatible API addresses with real-time preview support.
- Improve the presentation of AI chat error details.
- Refine parts of the display styling.

### 🐛 Bug Fixes

- Fix some logic vulnerabilities.

### 🔧 Chores

- Optimize the logic of the sync-changelog skill.

## v0.18.3 (2026-04-28)

> This release adds configurable quick tool entry placement, improves the default time filter, and fixes modal layering and data directory safety messaging.

### ✨ Features

- Add a setting for the placement of the quick tool entry.
- Improve the default time filter experience.
- Prevent data directories from being set inside the app installation directory.

### 🐛 Bug Fixes

- Fix modal style override issues.
- Fix modal layering issues in the settings page.

## v0.18.2 (2026-04-26)

> This release adds session type filters for subscriptions, paginated remote session discovery, and configurable per-request message limits.

### ✨ Features

- Add session type filtering and selection when subscribing to sessions.
- Add paginated remote session discovery with on-demand loading.
- Allow each data source to configure how many messages are fetched per request.

## v0.18.1 (2026-04-24)

> This release adds DeepSeek V4 support and a launch-at-startup option, improves the settings and overall UI experience, and fixes how links open in AI chat.<br/>Starting with this release, the project is officially moving to the ChatLab organization.

### ✨ Features

- Move the project to the ChatLab organization.
- Refine the global visual style.
- Improve how quick prompts are presented.
- Improve how the settings modal opens.
- Add launch-at-startup support.
- Add support for the DeepSeek V4 model.

### 🐛 Bug Fixes

- Fix links in AI chat so they open in the browser.

## v0.18.0 (2026-04-23)

> This release improves AI chat interactions, consolidates several analysis entry points, and makes data source sync and Windows updates more reliable.

### ✨ Features

- Improve AI assistant interactions.
- Update the helper text in the Add Data Source form.
- Add a Mini mode to the Tool Panel.
- Move the chat history viewer into the Tool Panel.
- Unify the relationship analysis tabs.
- Move the Quotes module into Insights.
- Move keyword analysis into Labs.

### 🐛 Bug Fixes

- Fix existing type warnings.
- Add a 60-second overlap window to Pull incremental sync to prevent missed messages.
- Set Pull requests to `limit=1000` to avoid slowdowns when remote sources export too much data at once.
- Fix a Windows update issue where an NSIS popup could interrupt silent installation.

## v0.17.5 (2026-04-21)

> This release focuses on a broad set of bug fixes to improve overall stability.

### ✨ Features

- Refined the visual style of relationship cards.
- Replaced the `node-machine-id` dependency with native machine identity logic to improve API key update reliability on Linux.
- Added an option to keep original records when merging chat histories.
- Added a verification button next to API endpoints for preset and third-party services.

### 🐛 Bug Fixes

- Hardened the data source migration strategy for safer migrations.
- Fixed incorrect empty-state rendering for topics with very few messages.
- Fixed local model validation failures.
- Fixed an issue where the selected tab reset after switching conversations.
- Fixed a white-screen issue in Automation pages after upgrading legacy `dataSources` structures.

## v0.17.4 (2026-04-19)

> Implemented the full Import API v1 protocol and added hierarchical data source management, now supporting automatic chat history sync.

### ✨ Features

- Implement the full Import API v1 protocol with hierarchical data source management.

## v0.17.3 (2026-04-17)

> This release adds a language preference tab for private chats, introduces sorting and filtering in the sidebar conversation list, improves AI provider and model configuration, and fixes a time filter reset issue.

### ✨ Features

- Add sorting and filtering to the conversation list.
- Add a Language Preference tab for viewing language preferences.
- Refine UI details for better visual consistency.
- Add Anthropic as an AI provider option.
- Allow selecting API interface types for third-party model services.
- Allow custom display names for AI model configurations.

### 🐛 Bug Fixes

- Fix an issue where the time filter reset to "All" after returning from Settings or the AI Chat page.

### ♻️ Refactoring

- Extract language preference definitions into shared types to reduce duplication.

## v0.17.2 (2026-04-15)

> This update adds cross-platform data merge and member message merge, strengthens dictionary and update security checks, improves the dark theme experience and logging, and fixes several bugs.

### ✨ Features

- Support merging member messages in member management.
- Support merging chat data across platforms.
- Add sorting support to selected table columns in data management.
- Move the topic analysis entry point to Insights.
- Add original file path recording for AI log files.
- Improve dark theme colors for better visual comfort.

### 🐛 Bug Fixes

- Fix dictionary refresh and merge ID collision issues.
- Add runtime User-Agent headers for OpenAI-compatible requests.
- Fix transparent background issues when exporting dark-theme screenshots.
- Add SHA256 integrity verification for dictionary downloads.
- Tighten remote config fetching and strengthen update installation confirmation.

### 🔧 Chores

- Add deb package build support for ARM Linux.
- Optimize the changelog sync flow.

### 📝 Documentation

- Add Traditional Chinese documentation.

## v0.17.1 (2026-04-13)

> Refactored the Topics module with a new topic card view, improved word cloud keyword filtering and query caching, added remote tokenizer dictionary downloads with Traditional Chinese support, and improved WhatsApp detection.

### ✨ Features

- Refactor the Topics module and add a topic card view.
- Add keyword filtering to the word cloud.
- Support remote tokenizer dictionary downloads with Traditional Chinese dictionary included.
- Improve query cache logic for faster lookups.
- Standardize loading indicators across components.
- Improve WhatsApp chat detection reliability.

### 👷 CI

- Launch the official documentation site with automated sync and deployment.

## v0.17.0 (2026-04-12)

> This release strengthens WhatsApp import parsing and specified-format imports, while refreshing Overview cards and adding sharing, screenshots, and debugging utilities.

### ✨ Features

- Add a flexible WhatsApp V2 timestamp parser that adapts to export variants across regions.
- Improve WhatsApp chat log detection.
- Add specified-format import support.
- Add a sharing card in the Messages tab.
- Add quick debugging tools in DEBUG mode.
- Improve the Overview identity card and unify time-range query logic.
- Refactor Overview module cards and extract a theme color card with reserved palette modes.
- Unify maximum card width and elevate Home tools into a global tools sidebar.
- Add screenshot support for theme cards and disable mobile screenshot adaptation by default.
- Remove diagnostic suggestions and add new prompts.

### 🐛 Bug Fixes

- Fix inconsistency between WhatsApp time-parsing regex rules and line-matching regex rules.
- Fix compatibility issues when parsing WhatsApp 12-hour time formats and NNBSP characters.

### 🔧 Chores

- Cache electron and electron-builder binaries to speed up CI packaging.

## v0.16.0 (2026-04-10)

> This update adds a new initiative analysis view for private chats and fixes missing custom models in the model-edit dialog.

### ✨ Features

- Add a new initiative analysis view for private chats.
- Improve the footer presentation and interactions.
- Refine the logic in the lower section of the quotes module.

### 🐛 Bug Fixes

- Fix an issue where multiple custom models could disappear in the third-party/local service edit dialog.

## v0.15.0 (2026-04-08)

> This release significantly improves search and query performance with context-aware search, streamlines AI model configuration with added providers, and adds Linux platform support.

### ✨ Features

- Add query caching to speed up access.
- Enable automatic context carry-over in search tools.
- Refactor the model configuration flow.
- Show a language selection dialog on first launch for new users.
- Add basic debugging tools in the Lab.
- Remove legacy prompts.

### 🐛 Bug Fixes

- Fix inconsistent title bar button background color in Windows light mode.
- Fix CI packaging workflow alignment issues between Node 24 and pnpm.
- Fill in missing i18n translations for tool invocation display names.

### ♻️ Refactoring

- Improve the code organization of the AI configuration modal.

### 🔧 Chores

- Upgrade to Node 24.
- Add Linux packaging support.

### 📝 Documentation

- Update documentation.

## v0.14.2 (2026-04-07)

> This update improves the AI chat experience with copy support, cleaner UI, new FTS5 full-text search tools, leaner search parameters, and clearer error feedback with stronger test coverage.

### ✨ Features

- Add a 7-day memory for assistant selection.
- Add one-click message copying in AI chat.
- Improve AI chat styling and overall interaction flow.
- Add FTS5 full-text search support with a quick search tool.
- Trim search parameters in selected tools to reduce token usage.
- Add an E2E testing framework for Electron apps with port management and instance isolation.

### 🐛 Bug Fixes

- Improve AI chat error messages to make issues easier to diagnose.

### ♻️ Refactoring

- Reorganize the AI chat module code structure.
- Extract shared logic from the session analysis page and unify header copy.

### test

- Add reusable smoke-test coverage for the E2E app launcher.

### 📝 Documentation

- Update intro images in project documentation.

### 💄 Styles

- Standardize parts of the code formatting to improve readability.

## v0.14.1 (2026-04-02)

> This update refines the Home information architecture and UI, while improving SQL conversation UX, stats read performance, and AI tool quality.

### ✨ Features

- Improve the Overview page styling.
- Improve interaction flows in the SQL conversation module.
- Move member management to Home and adjust related tab layouts.
- Add new AI tools, including a tool for chat overview retrieval.
- Add a conversation data cache manager to speed up stats loading.
- Improve changelog modal type presentation.

### 🐛 Bug Fixes

- Fix silently swallowed AI errors in SQL Lab and summary generation.

### ♻️ Refactoring

- Refactor AI tool categorization to improve maintainability.

### 🔧 Chores

- Deprecate low-value AI tools to keep the toolset focused.

## v0.14.0 (2026-03-28)

> Add API import/export and preset prompts, improve Overview and settings flows, and fix message deduplication, AI conversation flow, and daily trend display.

### ✨ Features

- Add API import
- Add API export
- Let preset questions send immediately when selected
- Add a Settings option for the default tab when opening a chat session
- Improve the Overview page styling
- Refine the overall UI and the API service settings screen
- Improve identity cards and assistant selection interactions

### 🐛 Bug Fixes

- Fix false positives in message deduplication and unify empty-string deduplication behavior
- Fix AI conversation flow issues and frontend type-check errors
- Add a fallback default assistant for edge cases
- Fix daily message trends not rendering

### ♻️ Refactoring

- Clean up legacy typing issues across the parser, worker, RAG, and merger modules

### 🔧 Chores

- Add a skill for generating assistant configurations

## v0.13.0 (2026-03-16)

> Assistant Mode is here with skills in chat, quick input actions, improved chat and settings UI, Traditional Chinese and Japanese support, UI refinements, and multiple stability fixes.

### ✨ Features

- Shipped the first Assistant Mode release with improved assistant logic and analysis tools
- Launched the Assistant and Skill marketplaces; chats can now use skills
- Added @-mention member selection for collaboration
- Added Traditional Chinese and Japanese localization
- Refactored Settings and refined UI details
- Improved Overview styling and chat experience
- Moved the export chat history entry point
- Removed the legacy prompt system and custom AI filtering
- Model calls no longer stop when switching pages

### 🐛 Bug Fixes

- Fixed Gemini API configuration issues
- Fixed an error caused by stopword processing order in NLP

### ♻️ Refactoring

- Refactored AIChat organization
- Restructured directory and project layout

### 📝 Documentation

- Updated the user agreement and project docs

### 🔧 Chores

- Improved the changelog build pipeline

### 💄 Styles

- Standardized code formatting and lint output

## v0.12.1 (2026-02-27)

> Add chat-history preprocessing and AI debugging, refactor the Agent/LLM architecture, and fix i18n and Windows theme consistency issues.

### ✨ Features

- Add a chat-history preprocessing pipeline.
- Add preprocessing settings UI and configuration management.
- Add session-based context timelines and runtime status for the Agent.
- Add an AI debug mode with improved log observability.

### 🐛 Bug Fixes

- Fix partial UI text not being localized under English settings.
- Fix overlay color updates not matching the active theme on Windows.

### ♻️ Refactoring

- Split the monolithic Agent implementation into a modular architecture.
- Refactor the tool system to AgentTool + TypeBox and complete i18n support.
- Unify the LLM access layer under the pi-ai implementation.
- Refactor data-flow direction and IPC contracts, with corresponding frontend adaptation.
- Introduce shared types and improve ChatStatusBar i18n.
- Refactor parts of the chart stack into a plugin-based architecture.

### 🔧 Chores

- Remove the over-engineered sessionLog module.
- Remove @ai-sdk dependencies and legacy LLM service implementations.
- Temporarily hide the vector model configuration entry.
- Update project description copy.

### 💄 Styles

- Run ESLint auto-fix to unify code style.

## v0.11.2 (2026-02-15)

> Improve chat import workflows and management tools, while enhancing cross-platform parser compatibility.

### ✨ Features

- Improve parser compatibility for LINE and WhatsApp formats.
- Improve the chat sniffing layer with polling detection and a fallback strategy.
- Support Shift multi-select in the Manage page.
- Show chat summary count and AI conversation count in the Manage page.
- Optimize the main-page layout to provide more usable space.
- Improve top-right window controls styling on Windows.

### 📝 Documentation

- Update project documentation.

## v0.11.0 (2026-02-13)

> Add Telegram import, improve incremental import UX, strengthen i18n coverage, and fix indexing and page flicker issues.

### ✨ Features

- Expand i18n support across AI calls, logs, and main-process configuration.
- Add support for importing Telegram chat history.
- Improve the incremental import flow and related copy.
- Improve the interaction flow when opening protocol links.

### 🐛 Bug Fixes

- Fix index invalidation after incremental imports (resolve #81).
- Fix WhatsApp iPhone-exported chats not being recognized (resolve #82).
- Fix a double-flicker issue when switching to the chat page.

### 🔧 Chores

- Optimize TypeScript configuration.
- Adjust i18n build configuration.
- Improve skill-related project configuration.

## v0.10.0 (2026-02-11)

> Add interaction frequency analysis, improve the session query pipeline, and fix issues in incremental indexing and database scanning.

### ✨ Features

- Add an interaction frequency analysis view to make member interaction trends easier to understand.
- Improve session query logic and processing flow.

### 🐛 Bug Fixes

- Fix inaccurate session index generation scope after incremental updates (fix #79).
- Fix non-chat SQLite files being incorrectly processed during migration and session scanning.

### ♻️ Refactoring

- Refactor the session query module to improve maintainability.

### 🔧 Chores

- Remove transformers-related dependencies and update project configuration.

## v0.9.4 (2026-02-08)

> Improved time filtering and AI configuration UX, added local API key encryption, and fixed LINE chat log parsing.

### ✨ Features

- Add more flexible time-filtering options.
- Store API keys with local encryption.
- Hide release notes for first-time users.
- Improve the configuration status display in the AI chat footer.
- Allow the app to restart immediately after data directory migration.

### 🐛 Bug Fixes

- Fix parsing issues for LINE chat logs.

### 📝 Documentation

- Update project documentation.

## v0.9.3 (2026-02-03)

> Support custom data directories and fix many known issues.

### ✨ Features

- Add a data directory location setting
- Optimize data directory migration logic
- Add a confirmation dialog for directory switching
- Improve parser logic (WeFlow / Echotrace)

### 🐛 Bug Fixes

- Fix crashes on Windows when custom filtering processes large message volumes
- Fix conversations ending early when third-party relay APIs call tool_call
- Fix some WhatsApp chat logs not being detected correctly
- Fix manage page header stacking above settings

### ♻️ Refactoring

- Refactor session query module
- Improve migration logging

## v0.9.2 (2026-02-02)

> Rankings are now displayed as charts; word cloud generation and the local AI inference model are optimized; chat record filtering and the date picker are improved; and key routes are preloaded after launch.

### ✨ Features

- Refactor rankings to chart-based views
- Optimize word cloud output
- Optimize inference models
- Improve linked search + filter in chat records
- Enhance date picker interactions
- Preload key routes after app launch

### 🔧 Chores

- Modularize preload APIs
- Optimize analytics logic
- Upgrade ESLint and format code

## v0.9.1 (2026-01-30)

> Add LINE chat import, batch management, and chat search, plus fixes for known issues.

### ✨ Features

- Add batch management with batch delete and merge
- Support chat conversation search
- Support LINE chat import
- Compatible with WeFlow exported JSON format
- Member list uses backend pagination
- Improve some copy

### 🐛 Bug Fixes

- Fix Windows app not closing during updates due to Worker occupation

## v0.9.0 (2026-01-28)

> Add NLP capabilities with a word cloud page under the Quotes tab; add a Views tab for more charts; support following system proxy settings; and refine some pages and styles.

### ✨ Features

- Optimize user selector performance with virtualized loading
- Move rankings to the Views tab
- Introduce tokenization and add a word cloud sub-tab
- Improve group chat tab copy
- Network proxy follows system proxy settings
- Optimize release notes display logic

### 💄 Styles

- Improve Markdown rendering styles

## v0.8.0 (2026-01-26)

> This update adds session summaries and vector retrieval; shows release notes after each update; improves parts of the UI; and fixes some known issues.

### ✨ Features

- Remove Help & Feedback from the sidebar
- Add a footer on the home page with common links
- Automatically open release notes after updating to a new version
- Optimize batch session summary generation
- Add session summaries in chat
- Support vector model configuration and retrieval
- Log more detailed errors when chat import fails

### 🐛 Bug Fixes

- Fix shuakami-jsonl parsing error (fix #50)

## v0.7.0 (2026-01-23)

> Improve the AI chat experience, and refine update logic and charting.

### ✨ Features

- Improve update logic
- Improve AI chat error logs
- Quick model selection at the bottom of chat
- Improve default prompts with a touch of humor
- Replace chart.js with ECharts
- Remove registration agreement logic

## v0.6.0 (2026-01-21)

> Integrate AI SDK to improve AI chat stability; add a thinking content block; and refine some styles

### ✨ Features

- Add a log locator feature
- Integrate AI SDK
- Add a thinking content block
- Fix global modals being covered by the home page drag area
- Improve top-right close button style on Windows

## v0.5.2 (2026-01-20)

> Support merged imports; fix several issues

### ✨ Features

- Support merged imports
- Show chat log start/end time on the main panel
- Improve the drag-and-drop area

### 🐛 Bug Fixes

- Improve build config to fix macOS x64 compilation
- Fix close button style in the message viewer on Windows
- Require building on the target architecture for macOS packaging (fixes #36)

## v0.5.1 (2026-01-16)

> Fix several issues

### ✨ Features

- Improve copy

### 🐛 Bug Fixes

- Fix app process not exiting on Windows when closing (#33)
- Fix number input bug (resolve #34)

## v0.5.0 (2026-01-14)

> Support Instagram chat import; add batch and incremental import

### ✨ Features

- Support Instagram chat import
- Logic improvements
- Improve system prompt presets
- Support incremental import
- Support batch import
- Style improvements
- Support native window controls and theme sync on Windows (#31)

### 🔧 Chores

- Remove componenst.d.ts

## v0.4.1 (2026-01-13)

> This release focuses on style and interaction improvements, with no major new features

### ✨ Features

- Prompt preview support
- Improve AI chat status bar
- Improve table migration logic
- Show avatars in the sidebar
- Style improvements
- Replace native window controls bar
- Improve global background color
- Clean up Worker on app exit

### 🐛 Bug Fixes

- Fix theme-follow-system setting not working
- Fix update modal layout issues

## v0.4.0 (2026-01-12)

> Import now supports shuakami-jsonl; AI chat is optimized to save tokens; imports can generate session indexes and the viewer can jump by index; updates now support acceleration mirrors

### ✨ Features

- Compatibility with shuakami-jsonl
- Improve loading state
- Add custom filters
- Refactor preset system with shared presets
- Trim system prompts to save tokens
- Add session-related function calling
- Handle message jumps with context
- Message viewer supports session index and quick jump
- Refactor settings modal and add session index settings
- Generate session index when importing chats
- Refactor settings modal
- Improve base component interactions
- Improve home page styling
- Improve update acceleration logic
- Add acceleration mirrors

## v0.3.1 (2026-01-09)

> Add Discord import support; parsers now import reply messages; storage moves to a more standard location; role import is supported; import errors provide more detailed diagnostics; and various improvements

### ✨ Features

- Move table upgrades to the main process
- Ignore beta versions during auto-update checks
- Move data storage to userData
- Parsers re-enable reply message import
- Support platform message IDs and reply IDs with table migration
- Support Tyrrrz/DiscordChatExporter import format
- Support roles in the member table
- Enhance ChatLab format detection
- Align click import and drag import behaviors
- Provide more detailed format diagnostics

### 🐛 Bug Fixes

- Fix some users having empty platformId

## v0.3.0 (2026-01-08)

> Add English support and various improvements

### ✨ Features

- SQL Lab supports export
- AI chat supports export
- Finalize localization
- Show explicit errors for AI model failures
- SQL results can jump to the message viewer
- Improve system prompts and support a prompt marketplace

## v0.2.0 (2025-12-29)

> Support proxy configuration; show error logs on import; improve some UI interactions; and add feature updates

### ✨ Features

- Message manager shows system messages
- Improve import flow and show logs on errors
- WhatsApp supports English-format message import
- Support proxy configuration (resolve #7)
- Improve AI model UI interactions
- Add API tutorial for user configuration
- Add two free GLM models; add Doubao provider and latest models
- AI replies no longer output think content

## v0.1.3 (2025-12-25)

> Fix several issues

### 🐛 Bug Fixes

- Fix Echotrace parser errors

## v0.1.2 (2025-12-25)

> Add dark mode and allow passing user identity in system prompts during AI chats

### ✨ Features

- Allow passing user identity in system prompts during AI chats
- Show Owner on the right in the message viewer
- Support database upgrades
- Allow Owner view in the Members tab
- Support dark mode

### 🐛 Bug Fixes

- Fix private chats misidentified as group chats

## v0.1.1 (2025-12-24)

> Support WhatsApp and legacy QQ chat analysis

### ✨ Features

- Show token usage at the bottom of chat sessions
- Support native WhatsApp message format
- Support legacy QQ txt group format

### 🐛 Bug Fixes

- Fix message manager z-index being too low

## v0.1.0 (2025-12-23)

> Project launch

### ✨ Features

- Initial release
