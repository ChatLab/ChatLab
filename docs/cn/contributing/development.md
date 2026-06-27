---
layout: doc
title: 开发指南
---

# 开发指南

这份指南面向想参与 ChatLab 开发的协作者，覆盖本地运行、仓库结构、常见改动入口和提交规范。更细的产品使用说明见使用指南；内部任务、草稿和个人维护上下文不作为公开贡献的前置条件。

## 开发前先读

- 先读本页，了解公开的协作基线。
- 使用 AI 协作时，让 AI 先读根目录的 `AGENTS.md` 和本页。
- 如果你的工作区存在 `.docs/`，可以继续阅读 `.docs/README.md` 和相关文档。`.docs/` 是可选的个人或团队私有开发上下文，可用于沉淀任务、决策、AI 协作记忆和临时规划；公开文档和公开 PR 不应依赖 `.docs/` 才能理解。

## 环境要求

- Node.js `>=24 <25`
- pnpm `>=9 <10`

安装依赖：

```bash
pnpm install
```

## 本地运行

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 交互式选择开发目标 |
| `pnpm dev:desktop` | 启动 Electron 桌面端开发模式 |
| `pnpm dev:web` | 启动 CLI Web UI 开发模式 |
| `pnpm docs:dev` | 启动公开文档站开发模式 |
| `pnpm build:desktop` | 构建桌面端 |
| `pnpm build:web` | 构建 Web UI |
| `pnpm docs:build` | 构建公开文档站 |
| `pnpm run type-check:all` | 运行前端和 Node 侧类型检查 |
| `pnpm lint` | 运行 ESLint 并自动修复 |
| `pnpm format` | 运行 Prettier 格式化 |

小范围改动优先对修改文件或相关子项目做定向检查；跨模块、发布或架构类改动再跑全量检查。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `src/` | 共享前端应用代码，包含页面、组件、服务封装、状态和 i18n |
| `src/services/` | 前端访问 Electron、CLI Web API 和平台能力的服务层 |
| `apps/desktop/` | Electron 主进程、preload 和桌面端构建配置 |
| `apps/cli/` | CLI、HTTP API、CLI Web 运行时和导入命令 |
| `packages/core/` | 平台无关的核心数据模型、查询、导入和成员操作 |
| `packages/node-runtime/` | Node.js 运行时服务、数据库、AI、导出、缓存和迁移 |
| `packages/tools/` | 统一 AI 工具定义和数据访问适配 |
| `docs/` | 公开文档站源码 |
| `changelogs/` | 应用内和发布使用的多语言更新日志 |
| `.docs/` | 可选的个人或团队私有开发上下文，不是公开贡献的必需依赖 |

## 架构边界

ChatLab 同时维护 Electron 桌面端和 CLI Web 端。涉及共享业务逻辑时，优先把逻辑放到 `packages/node-runtime/src/services/` 或 `packages/core/`，入口层只做薄适配。

- 不要在 Electron IPC handler 或 CLI HTTP route 中重复实现复杂业务流程。
- 不要在入口层绕过 `packages/core/` 直接写成员合并、删除、别名更新等核心 SQL 写操作。
- 平台差异通过 adapter 或 service 参数隔离，保持前端获得的数据结构一致。
- 新增会话、成员、索引、摘要、导出、导入相关能力时，先确认是否能复用或扩展共享 service。

## 数据目录兼容门禁

Electron 桌面端、CLI Web 和 MCP 会共享同一个 `userDataDir`。如果某个新版 runtime 修改了数据库 schema、AI 数据、认证配置或数据目录布局，旧 runtime 继续读写同一目录可能会读错数据或破坏用户数据。因此，凡是会让旧版本无法安全访问同一数据目录的变更，都必须使用数据目录兼容门禁。

兼容标记文件位于：

```text
<userDataDir>/.chatlab-meta.json
```

现有 `<userDataDir>/.chatlab` 仍只作为目录 marker，不承载 JSON 配置。

### 什么时候需要提升门禁

以下改动通常需要提升 `minRuntimeVersion`：

- 数据库 schema 迁移会删除、重命名或改变旧版本会访问的表/字段语义
- AI 对话、助手、技能、工具 allowlist、认证 profile、配置文件格式发生旧版本无法安全解析的变化
- `userDataDir` 内目录布局变化会导致旧版本读写错误位置
- 跨端共享数据的 canonical 命名或结构发生不向后兼容变化

如果只是新增旧版本会忽略的可选字段，或修复不影响旧版本读写的数据派生逻辑，通常不需要提升门禁。

### 实现要求

- 使用 `packages/node-runtime/src/data-dir-compat.ts` 里的统一 helper，不要在入口层手写 JSON 读写和版本比较。
- CLI、MCP、Desktop 启动时必须调用兼容检查；`DatabaseManager` 打开数据库前也会检查，用于捕获长驻旧服务运行期间目录被其他新版 runtime 提升的情况。
- 执行会提升门禁的迁移时，必须只在迁移实际成功后写入 `.chatlab-meta.json`；如果写入失败，启动或打开数据库必须中断，不能继续对外服务。
- `minRuntimeVersion` 只使用稳定 semver，例如 `0.25.1`；预发布版本不作为正式兼容判断。
- 提升只能升高，不能降低；已有更高 `minRuntimeVersion` 时必须保留。
- `reasons` 要合并去重，便于排查是哪类迁移提升了门禁。
- HTTP route 遇到数据目录兼容错误时应返回 `DATA_DIR_INCOMPATIBLE` 和 409，而不是普通 500。

隐藏救援开关：

```bash
CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR=1
```

这个开关只允许绕过“当前版本低于最低版本”的阻断，不能绕过损坏 JSON、非法字段或非法版本。使用时必须打印明确警告，并说明可能有数据损坏风险。

### 测试要求

修改会影响数据目录兼容性的代码时，至少覆盖：

- 从上一个稳定版本和更早已发布版本升级时数据不丢失
- `.chatlab-meta.json` 缺失时允许旧数据目录启动
- 当前 runtime 低于 `minRuntimeVersion` 时 CLI/Desktop/MCP 或 `DatabaseManager` 会阻断
- 迁移成功后会写入或合并 `minRuntimeVersion`、`dataCompatibilityVersion` 和 `reasons`
- 已有更高 `minRuntimeVersion` 不会被降低
- HTTP route 将兼容错误映射为 `DATA_DIR_INCOMPATIBLE`

## 常见改动入口

| 想改什么 | 先看哪里 |
| --- | --- |
| 前端页面和组件 | `src/pages/`、`src/components/` |
| 图表分析 | `src/components/analysis/`、`src/components/charts/` |
| 数据、消息、会话 API 调用 | `src/services/` |
| Electron 主进程 | `apps/desktop/main/`、`apps/desktop/preload/` |
| CLI 和 Web API | `apps/cli/` |
| 共享业务逻辑 | `packages/node-runtime/src/services/`、`packages/core/` |
| AI 工具和 Agent | `packages/tools/`、`packages/node-runtime/src/ai/`、`src/services/ai*` |
| 导入解析 | `packages/core/`、`apps/cli/src/import/`、`src/services/import/` |
| 文档站 | `docs/`、`docs/.vitepress/config.mts` |
| 更新日志 | `changelogs/` |

## 测试与检查

- 修改 TypeScript 或 Vue 代码后，至少运行相关类型检查。
- 修改公开文档后，运行 `pnpm docs:build` 或对修改的 Markdown/配置文件运行格式化检查。
- 修改跨平台共享逻辑后，确认 Electron 和 CLI Web 两端入口没有产生行为分歧。
- 修复会影响用户数据、业务逻辑、异步任务、缓存状态、跨端共享 service、公开 API 契约、导入解析、去重逻辑、权限认证、AI 工具 allowlist、配置/API key 迁移或数据库 schema/迁移的行为 bug 时，必须优先补能失败的回归测试。
- 只改 UI 文案、i18n key/翻译、样式、类型声明、日志、注释、无行为变化的小重构，或修复低风险展示细节时，可以不新增测试，但仍需运行相关类型检查、lint 和 format；不要为了低价值页面文案或源码字符串扫描新增脆弱测试。
- 日常默认运行 `pnpm test`；需要优先验证相关文件时运行 `pnpm test -- path/to/file.test.ts`。
- `pnpm test` 默认只包含单元/集成测试，不应依赖真实 LLM、真实 Electron、真实浏览器、真实网络或长时间 E2E。
- 与单个业务模块强相关的单元测试就近放在被测文件同目录，命名为 `*.test.ts` 或 `*.test.js`。
- 跨模块、集成、E2E、测试工具或归属不明显的测试放在根目录 `tests/`。
- SQL 行为、数据库迁移、Fastify route 和跨包 service 优先使用轻量内存 SQLite 或临时文件 fixture 验证真实行为；适配层测试只验证参数传递、权限过滤、错误映射和返回契约，避免重复下层算法矩阵。

## i18n 与文案

涉及 UI 文案时，同步维护简体中文、英文、日语和繁体中文翻译。代码中的日志、注释、AI 工具描述、错误消息等非 UI 文本默认使用英文；如果运行时 locale 可用，应支持中英双语返回。

## 使用 AI 协作

AI 可以帮助阅读代码、生成补丁和补测试，但公开 PR 必须让 reviewer 能在公开上下文中理解。建议让 AI 先读 `AGENTS.md` 和本页；如果你维护了自己的 `.docs/`，可以把它作为额外上下文，但不要让变更说明、测试理由或设计依据只存在于私有 `.docs/` 中。

## PR 与提交规范

- 明显的 Bug 修复可以直接提交 PR。
- **新功能请先提交 Issue 讨论；未经讨论直接提交的新功能 PR 可能会被关闭。**
- 提交信息使用 Conventional Commits，例如 `fix(import): handle empty source` 或 `docs: add contributor guide`。
- 仅当改动是平台特有时使用平台 scope，例如 `electron`、`cli`、`web`；通用改动使用模块名作为 scope。
