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
- 评估异步、并发、缓存、性能、外部依赖或资源异常问题时，必须证明完整因果链和现实可达性；不能只凭 Promise 理论上可永久 pending、竞态在抽象状态中存在或极端环境可能失败，就判定为严重 Bug
- 严重度应同时考虑触发概率、用户影响和可恢复性，高影响后果不能单独替代可达性证据；如果前置异常与后续有害操作共享同一故障域，必须解释为什么前者失败或阻塞时后者仍能成功
- 多轮 AI review 应按根因和关键假设聚合；若新评论只是把同一未证实假设传播到另一个下游，且没有新的独立代码或运行时证据，默认降低优先级并停止无限追深
- 测试、多语言和边界处理规则只约束已由现实用户场景或明确产品契约确认的行为，不构成主动扩展缓存失效条件、输入上限或异常组合的理由；Review 提出极端边界问题时，必须先证明其现实可达性和用户影响，缺少证据时不得作为当前 PR 的阻塞项

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

- 价值门槛：新增测试前，必须先说明它防止哪一种用户可见回归。测试应验证行为、数据或公开契约；**如果测试失败不能说明产品行为出错，就不应该新增。**
- 必须新增：修复真实的行为 Bug，或修改用户数据、数据库迁移、导入解析、去重、权限认证、配置/API Key 迁移、公开 API、跨端共享 service 等高风险逻辑时，应优先补充能在修改前失败的回归测试。已有测试完整覆盖时不重复新增。
- 通常不新增：文案、样式、类型、日志、注释、文档、常量、简单 getter、文件列表和无行为变化的重构。只运行相关类型检查、lint、format、构建或现有测试。
- 避免机械测试：不要通过扫描源码字符串、匹配完整 SQL、断言私有函数调用顺序、锁定日志文案或枚举每个常量来证明功能正确。Mock 调用次数只用于 adapter 的参数传递或权限边界，不用于锁定内部实现。
- 提高信息密度：同一规则的多个输入优先使用表驱动测试或通用断言；下层已覆盖算法时，上层只验证调用链和返回契约。修改相关模块时，应搜索并合并或删除重复、过期和低价值测试。
- 测试分层：纯函数和参数规范化使用单元测试；SQL、迁移、导入写库、Fastify route 和跨包 service 优先使用轻量真实依赖或临时数据库；真实 Electron、浏览器、LLM 和网络只用于少量显式启用的 Smoke/E2E。
- 测试位置：模块单元测试放在被测文件附近；跨模块、集成、E2E 和测试工具放在根目录 `tests/` 或对应 app/package 的既有测试目录。
- Review 判断：缺少测试本身通常不是严重 Bug。Reviewer 必须指出具体未覆盖的用户风险；只有数据安全、迁移、权限、公开契约等高风险行为缺少必要验证时，才应阻塞当前 PR。

## 命令与验证

- 类型检查：Node/CLI/Electron 主进程相关改动运行 `pnpm run type-check:node`；前端/Vue 相关改动运行 `pnpm run type-check:web`；跨端或发布前改动运行 `pnpm run type-check:all`
- Lint：优先对修改文件运行 `pnpm exec eslint <files...>`；需要全量修复时再运行 `pnpm lint`
- Format：优先对修改文件运行 `pnpm exec prettier --write <files...>`；大范围格式化才运行 `pnpm format`
- 单元/集成测试：日常默认运行 `pnpm test` 或 `pnpm run test:unit`；优先运行相关测试文件时用 `pnpm test -- path/to/file.test.ts`
- 文档：修改公开文档或 VitePress 配置后运行 `pnpm docs:build`；只改 `.docs/` 私有任务文档时不需要构建公开文档站
- E2E/Smoke：`pnpm run test:e2e:launcher`、`pnpm run test:e2e:smoke` 和真实 LLM/真实 Electron/真实网络测试只在相关功能需要时运行，不加入默认 `pnpm test`
- 最后检查：提交前运行 `git diff --check`，确认没有空白错误

## 代码规范

- 平台术语：内部交流、开发菜单和平台级代码统一使用 `CLI Web`（Node 后端 + Web UI）与 `Web WASM`（纯浏览器运行）。只说 `Web` 且上下文无法区分时，默认指 `Web WASM`。浏览器 Worker、OPFS 和浏览器 adapter 等技术能力使用 `Browser Runtime` 命名，它不是独立平台。详细边界见 `.docs/rules/platform-naming.md`。
- 多语言：代码中的日志、注释、AI 工具描述、错误消息等非 UI 文本默认使用英文。当有运行时 locale 可用时（如工具返回结果、AI 看到的文本），应通过 `isChineseLocale(locale)` 等机制支持中英双语。数据清洗中与聊天平台格式匹配的标签（如 `[分享]`、`[图片]`）保持原始语言不变。UI 文案的国际化遵循 `.docs/rules/i18n.md`
- i18n 复用性：新增 UI 文案 key 前，先判断是否是通用动作、状态、提示或组件文案；能复用的优先放在 `common.*` 等共享命名空间，避免在具体业务模块（如 `members.*`、`records.*`）重复定义同义 key。只有明确绑定业务语境、无法自然复用的文案才放到模块命名空间。

## 日志

- 统一入口：Node 侧（Electron 主进程 / CLI / CLI Web）使用 `@openchatlab/node-runtime` 的 `appLogger`；前端使用 `src/services/log-report.ts` 上报。不要新建通用 logger 或直接写日志文件；AI 使用 `AiLogger`、导入性能使用 `perf-logger`。
- 关键路径：启动、迁移、数据库或配置变更、导入、认证、外部调用和后台任务等用户可感知流程，应记录必要的开始、完成和失败节点。日志应能帮助判断流程停在哪一步及其原始错误，但不要机械记录每个函数或分支。
- 日志级别：低频且有诊断价值的成功节点使用 `info`；操作最终失败或功能不可用使用 `error`；已有重试、降级或回退且流程仍可继续使用 `warn`；轮询、缓存和状态快照等高频诊断使用 `debug`。记录异常时应直接传入原始 `Error`，避免丢失 stack。
- 适度原则：不要在循环或高频热路径写 `info`，不得记录聊天明文、API Key、token 等敏感信息。不要为具体日志文案、级别或调用方式机械增加业务测试；日志问题也不自动构成严重 Bug，仍应根据实际用户影响判断。

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

- 分支规则：功能需求开发前必须新建或切换到功能分支；允许提交到main的例外情况：发版工作流、独立内部文档仓库 `.docs/` 的日常维护
- Commit 规范：使用 Conventional Commits。scope 规则——通用改动 scope 随意（如 `ai`、`import`、`sidebar` 等模块名）；仅当改动是**平台特有**时才使用平台 scope（`electron`、`cli`、`web`）。
