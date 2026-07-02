## 开发流程

- 文档：开始开发前，请先查看公开开发指南 `docs/cn/contributing/development.md`。如果工作区存在 `.docs/`，再查看 `./.docs/README.md` 并阅读与当前需求相关的文档；`.docs/` 是可选的个人或团队私有开发上下文，可用于维护任务、决策、AI 协作记忆和临时规划，公开文档与公开 PR 不应依赖 `.docs/` 才能理解。
- 目标：用最小改动快速交付正确、可维护、可回归的业务结果
- 每次完成任务后，对产生修改的文件进行类型检查、lint检查和format格式化，指定修改的文件路径去执行，确保代码质量
- 在执行检查时，如果有其他与本次修改无关的报错，也需要一并修复

## 审查与判断

- 处理外部 review、bug 报告或架构建议时，必须先核对代码事实，再决定接受或反驳；不要因为 reviewer 表达确定就直接改代码
- 判断问题是否成立时，至少阅读相关函数、调用方、被调用方、相邻测试和现有文档；不能只看 diff 或单行评论
- 如果涉及依赖、框架、OpenAI/LLM SDK、数据库、打包发布等外部行为，应优先查官方文档、源码或类型定义，不凭记忆判断
- 结论必须包含证据：涉及的文件/函数、当前行为、风险、建议修复方式，以及已运行或应运行的验证

## 项目地图

- `src/`：共享前端应用代码，包含页面、组件、状态、服务封装和 i18n
- `apps/desktop/`：Electron 主进程、preload、桌面端构建与平台能力适配
- `apps/cli/`：CLI、HTTP API、CLI Web 运行时、导入命令和本地服务入口
- `packages/core/`：平台无关的核心模型、查询、导入去重、图表和 AI 静态定义
- `packages/node-runtime/`：Node.js 运行时能力，包括 SQLite 适配、数据库迁移、AI 管理、导出、缓存和数据目录
- `packages/tools/`：AI 工具定义、工具 registry 和数据访问 provider
- `packages/parser/`：聊天导出格式解析器和格式识别
- `packages/parser-native/`：napi-rs Rust 原生解析内核（可选本地构建，未构建时 parser 自动回退 TS 实现）
- `packages/http-routes/`：Electron 和 CLI Web 复用的 HTTP route
- `docs/`：公开文档站源码；`.docs/`：私有开发上下文和任务记录，不作为公开 PR 理解前提
- 更细的架构说明继续以 `docs/cn/contributing/development.md` 和 `.docs/README.md` 为准，不在根 `AGENTS.md` 里重复维护

## 测试

- 测试文件位置：与单个业务模块强相关的单元测试应就近放在被测文件同目录，命名为 `*.test.ts` / `*.test.js`；跨模块、集成、E2E、测试工具或不明显归属某个业务文件的测试放在根目录 `tests/`；某个 app/package 专属测试放在对应的 `apps/*` 或 `packages/*` 内，遵循该子项目现有约定
- 测试目标：测试应优先覆盖用户数据安全、数据库迁移、导入解析、权限/认证、AI 工具权限、配置/API key 迁移、跨端共享逻辑和已发生过的回归；不要为了提高数量给低风险 getter、常量、样式或纯展示细节机械补测
- 必须加测试：修复会影响用户数据、业务逻辑、异步任务、缓存状态、跨端共享 service、公开 API 契约、导入解析、去重逻辑、权限认证、AI 工具 allowlist、配置/API key 迁移或数据库 schema/迁移的行为 bug 时，必须先加能失败的回归测试；修改上述高风险模块时也必须加或更新测试
- 可以不加测试：只改 UI 文案、i18n key/翻译、样式、类型声明、日志、注释、无行为变化的小重构，或修复低风险展示细节时，可以不新增测试，但仍需运行相关类型检查、lint 和 format；不要为了低价值页面文案或源码字符串扫描新增脆弱测试
- 低风险文档、示例、README、SKILL.md、`.docs`、package `files` 列表等说明/分发类改动，不要新增测试，也不要为了锁定文案、示例命令或文件存在性写脆弱测试；只做格式化、相关构建或必要静态检查。只有涉及用户数据、业务逻辑、导入解析、跨端 service、公开 API、权限/auth、数据库迁移、AI 工具 allowlist 或异步任务时，才新增或更新回归测试。
- 测试分层：纯函数、解析/格式化、权限判断、参数规范化、错误分支优先写单元测试；SQL 行为、数据库迁移、文件迁移、导入写库、Fastify route、跨包 service 优先写集成测试；Electron、真实浏览器、真实 LLM、真实网络仅用于少量关键 E2E/Smoke，并默认通过环境变量显式启用
- 避免重复测试：新增测试前先搜索同类断言；如果下层单测已覆盖算法，上层只测调用链是否接通，不重复枚举算法细节；如果测试只锁定实现写法、失败后不指向用户可见风险，应合并、改写或删除；优先写能覆盖全量场景的通用断言，而非针对单个条目的专项断言——若通用断言已完整覆盖，单个断言是冗余的
- 测试替身选择：涉及 SQL、数据库迁移、Fastify route 或跨包 service 时，优先使用轻量内存 SQLite / 临时文件 fixture 验证真实行为；只有在测试纯适配边界时才使用 mock/fake。避免用大量 `sql.includes(...)` 一类字符串匹配来模拟数据库行为
- 适配层测试边界：CLI/Electron/Web route、IPC adapter、tool adapter 只验证参数传递、权限过滤、错误映射和返回契约；core 已覆盖的算法矩阵不要在入口层重复展开

## 命令与验证

- 类型检查：Node/CLI/Electron 主进程相关改动运行 `pnpm run type-check:node`；前端/Vue 相关改动运行 `pnpm run type-check:web`；跨端或发布前改动运行 `pnpm run type-check:all`
- Lint：优先对修改文件运行 `pnpm exec eslint <files...>`；需要全量修复时再运行 `pnpm lint`
- Format：优先对修改文件运行 `pnpm exec prettier --write <files...>`；大范围格式化才运行 `pnpm format`
- 单元/集成测试：日常默认运行 `pnpm test` 或 `pnpm run test:unit`；优先运行相关测试文件时用 `pnpm test -- path/to/file.test.ts`
- 文档：修改公开文档或 VitePress 配置后运行 `pnpm docs:build`；只改 `.docs/` 私有任务文档时不需要构建公开文档站
- E2E/Smoke：`pnpm run test:e2e:launcher`、`pnpm run test:e2e:smoke` 和真实 LLM/真实 Electron/真实网络测试只在相关功能需要时运行，不加入默认 `pnpm test`
- 最后检查：提交前运行 `git diff --check`，确认没有空白错误

## 代码规范

- 多语言：代码中的日志、注释、AI 工具描述、错误消息等非 UI 文本默认使用英文。当有运行时 locale 可用时（如工具返回结果、AI 看到的文本），应通过 `isChineseLocale(locale)` 等机制支持中英双语。数据清洗中与聊天平台格式匹配的标签（如 `[分享]`、`[图片]`）保持原始语言不变。UI 文案的国际化遵循 `.docs/rules/i18n.md`
- i18n 复用性：新增 UI 文案 key 前，先判断是否是通用动作、状态、提示或组件文案；能复用的优先放在 `common.*` 等共享命名空间，避免在具体业务模块（如 `members.*`、`records.*`）重复定义同义 key。只有明确绑定业务语境、无法自然复用的文案才放到模块命名空间。

## 日志

- 统一入口：Node 侧（Electron 主进程 / CLI / CLI Web）通过 `@openchatlab/node-runtime` 的 `appLogger`（`appLogger.info/warn/error/debug(scope, message, data?)`）落盘到 `logs/app.log`；前端（Vue）通过 `src/services/log-report.ts` 经 `POST /_web/logs/report` 上报。不要为通用日志新写 `fs.appendFileSync` 或新的 logger 文件；AI 用 `AiLogger`、导入性能用 `perf-logger` 保持现状。
- **新增或修改功能时必须补必要日志**：关键路径要留下足够的可排查痕迹——成功节点用 `info`（如启动、迁移、数据库/配置变更、导入开始/完成、外部调用、auth 结果），失败分支用 `error` 并把 `Error` 直接作为 `data` 传入（自动提取 message/stack）。判断标准：用户带着这个功能报问题时，仅凭 `logs/app.log` 能否还原到出错的那一步；不能，就说明日志不够。
- 适度原则：不要在高频热路径或循环里打 `info`，详细诊断用 `debug`（默认 `INFO` 级不落盘，`CHATLAB_LOG_LEVEL=debug` 开启）；日志、注释等非 UI 文本用英文，且**不得写入聊天明文、API Key、token 等隐私数据**。
- 级别与轮转：`app.log` 达 10MB 自动原子 rename 为 `app.old.log`，无需手动清理。

## 架构边界

- 多端复用：维护 Electron 和 CLI Web 的共享业务逻辑时，优先在 `packages/node-runtime/src/services/` 下实现，禁止在路由/IPC handler 中绕过 core 直接写 SQL。详见 `.docs/README.md` 的"多端逻辑复用"章节。

## 兼容与迁移

- 运行时应读写当前 canonical 数据结构；旧 schema、旧字段名、旧配置形状应优先在数据库迁移、配置迁移或解析加载阶段 normalize，不在业务热路径长期保留多套分支
- 保留兼容必须能说明对应的已发布版本、用户数据或公开 API 契约；不要为了假设中的旧状态添加永久 alias、fallback 或双写逻辑
- 修改数据库 schema、AI 数据、配置文件、数据目录或导入格式时，必须考虑从上一个稳定版本和更早已发布版本升级的路径，并补充能证明数据不丢失的测试或验证
- 会让旧版 CLI/Desktop/MCP 无法安全读写同一 `userDataDir` 的变更，必须通过 `.chatlab-meta.json` 提升数据目录最低运行时版本，并接入 CLI/Desktop/MCP 启动检查；详细规则见 `docs/cn/contributing/development.md` 的“数据目录兼容门禁”
- 如果异常状态可以通过中断、报错和后续人工/AI 处理解决，不要预先加入复杂防御逻辑；优先保持迁移路径清晰、可验证

## 安全与发布

- 不得提交真实 API Key、token、用户聊天数据库、个人数据目录、日志、截图或包含隐私的导出文件
- 修改依赖、lockfile、构建产物、发布脚本、版本号、changelog、npm publish、release 流程时，必须先获得明确确认
- 涉及 API Key、auth profile、配置迁移、数据目录迁移和数据库迁移时，必须优先保护已有用户数据，并提供回滚或失败中断策略

## 提交规范

- Commit 规范：使用 Conventional Commits。scope 规则——通用改动 scope 随意（如 `ai`、`import`、`sidebar` 等模块名）；仅当改动是**平台特有**时才使用平台 scope（`electron`、`cli`、`web`）。
