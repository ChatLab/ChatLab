# AGENTS.md - ChatLab 开发指南

> 目标：用最小改动快速交付正确、可维护、可回归的业务结果边界：只解决当前需求，不做与需求无关的重构和"顺手优化"

## 项目概述

ChatLab 是一个基于 Electron + Vue 3 的本地化聊天记录分析工具，支持多平台聊天记录导入、SQL 查询和 AI 分析。

- **渲染进程**: Vue 3 + Nuxt UI + Tailwind CSS + Pinia
- **主进程**: TypeScript + better-sqlite3 + Worker 线程
- **IPC 通信**: 域划分的 `ipcMain.handle` / `ipcRenderer.invoke` 模式

---

## 构建与测试命令

### 开发与构建

```bash
pnpm dev              # 启动开发模式 (electron-vite dev)
pnpm build            # 构建生产版本
pnpm build:mac        # Mac 平台构建
pnpm build:win        # Windows 平台构建
pnpm preview          # 预览构建结果
```

### 代码质量

```bash
pnpm lint             # ESLint 检查并自动修复
pnpm format           # Prettier 格式化所有文件
pnpm type-check       # TypeScript 类型检查 (仅 web)
pnpm type-check:web   # 检查渲染进程 TypeScript
pnpm type-check:node  # 检查主进程 TypeScript
pnpm type-check:all   # 全部类型检查
```

### 测试

```bash
# 运行单个测试文件
node --experimental-strip-types --test electron/main/worker/import/tempDb.test.ts

# 当前测试示例
pnpm test:agent-context  # 运行 sessionLog.test.mjs
```

**注意**: 项目使用 Node.js 原生测试框架 (`node:test`)，非 Jest/Vitest。

---

## 代码风格指南

### 格式化规则 (Prettier)

```yaml
singleQuote: true # 使用单引号
semi: false # 无分号
printWidth: 120 # 行宽 120
trailingComma: 'es5' # ES5 尾逗号
tabWidth: 2 # 2 空格缩进
useTabs: false # 使用空格
endOfLine: 'lf' # LF 行尾
arrowParens: 'always' # 箭头函数始终带括号
```

### TypeScript 规则

- `strict: true` - 严格模式
- `noUnusedLocals: true` - 禁用未使用的局部变量 (编译时)
- `strictNullChecks: true` - 严格的 null 检查
- 允许 `@ts-ignore` (需带描述): `'@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }]`
- 允许 `@typescript-eslint/no-explicit-any` 和 `@typescript-eslint/no-unused-vars` (lint 时)

### Vue 规则

- `'vue/require-default-prop': 'off'` - Props 不强制默认值
- `'vue/multi-word-component-names': 'off'` - 允许单词组件名
- `'vue/no-v-html': 'off'` - 允受控的 v-html (Markdown 渲染)

---

## 目录结构

```
ChatLab/
├── electron/
│   ├── main/           # 主进程代码
│   │   ├── ai/         # AI 相关逻辑 (工具、对话、摘要)
│   │   ├── api/        # Fastify API 服务
│   │   ├── database/   # SQLite 数据库操作
│   │   ├── ipc/        # IPC 处理器 (域划分)
│   │   ├── parser/     # 聊天记录解析器 (多格式支持)
│   │   ├── worker/     # Worker 线程 (导入、查询、索引)
│   │   └── i18n/       # 国际化
│   └── preload/        # 预加载脚本 (暴露 API 到渲染进程)
├── src/                # 渲染进程 (Vue)
│   ├── components/     # Vue 组件
│   │   ├── UI/         # 通用 UI 组件
│   │   ├── common/     # 常用业务组件
│   │   ├── charts/     # 图表组件
│   │   └── analysis/   # 分析页面组件
│   ├── pages/          # 页面级组件
│   ├── stores/         # Pinia 状态管理
│   ├── composables/    # Vue Composables
│   ├── types/          # TypeScript 类型定义
│   ├── i18n/           # 国际化
│   └── utils/          # 工具函数
├── packages/           # 共享包 (图表组件)
└── docs/               # 文档与 changelog
```

---

## 导入规范

### 渲染进程 (Vue)

```typescript
// 1. Vue 核心
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

// 2. 外部库
import dayjs from 'dayjs'

// 3. 内部类型
import type { AnalysisSession } from '@/types/base'

// 4. 内部组件
import SidebarButton from './sidebar/SidebarButton.vue'

// 5. Stores
import { useSessionStore } from '@/stores/session'
```

### 主进程 (Node.js)

```typescript
// 1. Electron API
import { ipcMain, app, dialog } from 'electron'

// 2. 外部库
import * as databaseCore from '../database/core'

// 3. 内部模块 (相对路径)
import { detectFormat } from '../parser'
import type { IpcContext } from './types'
```

---

## IPC 命名规范

IPC 使用域划分命名，格式为 `{domain}:{action}`:

| 域          | 示例                                                    |
| ----------- | ------------------------------------------------------- |
| `chat:*`    | `chat:getSessions`, `chat:import`, `chat:deleteSession` |
| `session:*` | `session:generate`, `session:getStats`                  |
| `ai:*`      | `ai:chat`, `ai:generateSummary`                         |
| `llm:*`     | `llm:getModels`, `llm:testConnection`                   |
| `nlp:*`     | `nlp:segment`, `nlp:extractKeywords`                    |

**Handler 模式**:

```typescript
ipcMain.handle('chat:getSessions', async () => {
  try {
    return await worker.getAllSessions()
  } catch (error) {
    console.error('[IpcMain] Error:', error)
    return [] // 失败时返回安全默认值
  }
})
```

---

## Vue 组件规范

### 文件命名

- 组件文件: PascalCase (如 `SidebarButton.vue`)
- 页面文件: 小写或 index.vue (如 `pages/home/index.vue`)

### 组件结构

```vue
<script setup lang="ts">
// 1. 导入
import { ref, computed, onMounted } from 'vue'
import type { SomeType } from '@/types'

// 2. Store/Composable
const sessionStore = useSessionStore()

// 3. 状态
const isLoading = ref(false)

// 4. 计算属性
const filteredList = computed(() => ...)

// 5. 方法
function handleClick() { ... }

// 6. 生命周期
onMounted(() => { ... })
</script>

<template>
  <!-- 使用 Nuxt UI 组件 -->
  <UButton color="primary" @click="handleClick">
    {{ t('common.confirm') }}
  </UButton>
</template>
```

---

## Pinia Store 规范

使用 Composition API 风格:

```typescript
export const useSessionStore = defineStore(
  'session',
  () => {
    const sessions = ref<AnalysisSession[]>([])
    const currentSession = computed(() => ...)

    async function loadSessions() { ... }
    function selectSession(id: string) { ... }

    return {
      sessions,
      currentSession,
      loadSessions,
      selectSession,
    }
  },
  {
    persist: [{ pick: ['currentSessionId'], storage: sessionStorage }],
  }
)
```

---

## 错误处理规范

### IPC Handler

```typescript
ipcMain.handle('chat:someAction', async (_, ...args) => {
  try {
    const result = await worker.someAction(...args)
    return result
  } catch (error) {
    console.error('[IpcMain] Action failed:', error)
    return { success: false, error: String(error) }
  }
})
```

### Store 方法

```typescript
async function someAction(): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await window.chatApi.someAction()
    return result
  } catch (error) {
    console.error('操作失败:', error)
    return { success: false, error: String(error) }
  }
}
```

---

## 类型定义规范

类型文件按域划分:

- `types/base.ts` - 核心类型 (枚举、数据库模型、解析结果)
- `types/ai.ts` - AI 相关类型
- `types/analysis.ts` - 分析相关类型
- `types/format.ts` - 格式解析类型

**命名约定**:

- 数据库格式: `DbMeta`, `DbMember`, `DbMessage`
- 解析结果: `ParsedMember`, `ParsedMessage`
- IPC 返回: `ImportResult`, `MigrationCheckResult`

---

## 测试规范

### 🎯 核心原则（首要规则）

> **所有新功能开发必须包含完整的测试用例，测试覆盖率是代码交付的硬性要求。**

每个功能模块必须包含以下四层测试：

| 测试类型   | 简称 | 范围            | 文件位置                |
| ---------- | ---- | --------------- | ----------------------- |
| 单元测试   | UT   | 单个函数/类方法 | `*.test.ts` 同目录      |
| 集成测试   | IT   | 模块间交互      | `*.integration.test.ts` |
| 系统测试   | ST   | 完整功能流程    | `tests/system/`         |
| 端到端测试 | e2e  | 用户场景模拟    | `tests/e2e/`            |

**测试命名规范**：

- UT: `{module}.test.ts`
- IT: `{module}.integration.test.ts`
- ST: `tests/system/{feature}.test.ts`
- e2e: `tests/e2e/{scenario}.test.ts`

**必须测试的场景**：

1. 正常路径（Happy Path）
2. 边界条件（Boundary Conditions）
3. 异常处理（Error Handling）
4. 空值/空数据处理（Null/Empty Cases）

### 测试框架

使用 Node.js 原生测试框架:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { someFunction } from './module'

describe('模块名称', () => {
  beforeEach(() => {
    // 测试前置 setup
  })

  afterEach(() => {
    // 测试后置 cleanup
  })

  it('应该正确处理正常输入', () => {
    const result = someFunction('input')
    assert.equal(result, 'expected')
  })

  it('应该正确处理边界条件', () => {
    assert.throws(() => someFunction(null))
  })

  it('应该正确处理空数据', () => {
    const result = someFunction('')
    assert.equal(result, '')
  })
})
```

### 运行测试

```bash
# 运行单个测试文件
node --experimental-strip-types --test electron/main/parser/formats/custom-txt.test.ts

# 运行所有测试
node --experimental-strip-types --test **/*.test.ts

# 运行特定类型的测试
node --experimental-strip-types --test **/*.integration.test.ts  # 集成测试
node --experimental-strip-types --test tests/system/*.test.ts    # 系统测试
node --experimental-strip-types --test tests/e2e/*.test.ts       # e2e测试
```

### 日志规范

测试中必须包含足够的定位日志：

```typescript
console.log('[Test] 开始测试 xxx 功能')
console.log('[Test] 输入数据:', JSON.stringify(input))
console.log('[Test] 期望结果:', expected)
console.log('[Test] 实际结果:', JSON.stringify(actual))
console.log('[Test] 测试通过/失败: xxx')
```

---

## 注释规范

- 主进程代码使用中文注释
- 文件顶部 JSDoc 描述模块用途
- 函数使用 JSDoc 或中文注释说明

```typescript
/**
 * 聊天记录导入与分析 IPC 处理器
 */

/**
 * 检查是否需要数据库迁移
 */
ipcMain.handle('chat:checkMigration', async () => { ... })

// ==================== 数据库迁移 ====================
```

---

## 注意事项

1. **不要做无关重构**: 修改只针对当前需求
2. **Worker 线程**: CPU 密集操作在 Worker 中执行，避免阻塞 UI
3. **数据库操作**: 使用 better-sqlite3，注意 WAL 模式和多进程访问
4. **国际化**: 使用 i18next，键名遵循 `domain.action` 格式
5. **环境变量**: `.env` 文件配置，主进程通过 `process.env` 访问

---

## 🔄 持续改进原则（核心原则）

### 完成即反思

> **每次实现代码并完成测试修复后，必须进行举一反三的自我提升。**

**检查清单**：

1. **定位日志检查**：
   - 关键路径是否有足够的 `console.log`？
   - 错误处理是否有 `[模块名]` 前缀的日志？
   - 测试中是否有数据输入输出的日志？

2. **测试用例检查**：
   - 是否覆盖了四层测试（UT/IT/ST/e2e）？
   - 是否测试了正常路径、边界条件、异常处理、空数据处理？
   - 测试用例是否可以用于后续功能的回归测试？

3. **知识沉淀**：
   - 是否有新的模式值得记录？
   - 是否遇到了之前不知道的问题？
   - 是否有可以复用的解决方案？

### 自我提升触发时机

- ✅ 新功能开发完成后
- ✅ Bug 修复并验证后
- ✅ 测试失败并修复后
- ✅ 用户反馈问题解决后

### 执行方式

```bash
# 使用 self-improvement skill 记录改进
skill(name="self-improvement")
```

或调用任务：

```typescript
task(
  (subagent_type = 'explore'),
  (load_skills = ['self-improvement']),
  (prompt = '检查 [模块名] 是否有足够的定位日志和测试用例...')
)
```
