# ChatLab Web UI 设计文档

> 版本: v1.0  
> 日期: 2026-03-31  
> 状态: 设计评审阶段

---

## 一、需求概述

### 1.1 背景

ChatLab 当前是一个 Electron 桌面应用，仅支持本地用户使用。用户提出扩展需求：

| 核心诉求        | 描述                               |
| --------------- | ---------------------------------- |
| **Web UI 访问** | 允许其他用户通过浏览器访问 ChatLab |
| **远程使用**    | 支持局域网/互联网远程访问          |
| **多用户支持**  | 多个用户可同时使用同一实例         |

### 1.2 目标

```
┌─────────────────────────────────────────────────────────────────┐
│                    ChatLab 使用场景扩展                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   当前状态：仅桌面用户                                           │
│   ┌─────────┐                                                   │
│   │ 本地用户 │ ──▶ Electron App ──▶ 本地数据                    │
│   └─────────┘                                                   │
│                                                                  │
│   目标状态：多用户多终端                                         │
│   ┌─────────┐                     ┌─────────────────────────┐  │
│   │ 本地用户 │ ──▶ Electron App ──▶│                         │  │
│   └─────────┘                     │   ChatLab Server        │  │
│                                   │   (核心服务 + 数据存储)  │  │
│   ┌─────────┐                     │                         │  │
│   │ 远程用户 │ ──▶ Browser ──────▶│   ┌─────────┐          │  │
│   └─────────┘     Web UI          │   │ HTTP API │          │  │
│                                   │   └────┬────┘          │  │
│   ┌─────────┐                     │        │               │  │
│   │ 第三方  │ ──▶ HTTP API ──────▶│   ┌────▼────┐          │  │
│   └─────────┘     纯API调用        │   │ Database │          │  │
│                                   │   └─────────┘          │  │
│                                   └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 核心设计原则

| 原则           | 说明                                    |
| -------------- | --------------------------------------- |
| **双模式兼容** | 保留桌面应用完整功能，新增 Web 访问能力 |
| **渐进式改造** | 不破坏现有功能，逐步扩展 Web 支持       |
| **统一后端**   | 桌面和 Web 共享同一套后端 API           |
| **功能分级**   | Web 模式可接受部分功能受限              |

---

## 二、现状分析

### 2.1 当前架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    ChatLab 现有架构                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    ┌─────────────────┐                          │
│                    │  Electron 主进程  │                          │
│                    │  ┌─────────────┐ │                          │
│                    │  │ IPC Handlers│ │                          │
│                    │  ├─────────────┤ │                          │
│                    │  │ Fastify API │ │  ◀── 已有HTTP服务        │
│                    │  ├─────────────┤ │                          │
│                    │  │ Worker/DB   │ │                          │
│                    │  └─────────────┘ │                          │
│                    └────────┬────────┘                          │
│                             │                                    │
│          ┌──────────────────┼──────────────────┐                │
│          │                  │                  │                │
│   ┌──────▼──────┐    ┌──────▼──────┐   ┌──────▼──────┐        │
│   │  Electron   │    │  Preload    │   │  Fastify    │        │
│   │  渲染进程    │◀───│  (IPC桥接)   │   │  HTTP API   │        │
│   │  (Vue App)  │    │             │   │  (部分功能)  │        │
│   └─────────────┘    └─────────────┘   └─────────────┘        │
│                                                                  │
│   用户 ← 本地桌面应用 → Vue UI                                   │
│                                                                  │
│   其他用户 ← HTTP API → 仅数据操作（无UI）                        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Electron 依赖分析

#### 2.2.1 高耦合区域（需重点改造）

| 依赖项                  | 使用位置     | Web 替代方案          | 难度 |
| ----------------------- | ------------ | --------------------- | ---- |
| `window.chatApi`        | 所有数据操作 | HTTP API 调用         | 中   |
| `window.aiApi`          | AI对话功能   | SSE 流式接口          | 高   |
| `window.llmApi`         | LLM配置管理  | HTTP CRUD 接口        | 低   |
| `window.agentApi`       | Agent执行    | SSE 流式接口          | 高   |
| `dialog.showOpenDialog` | 文件选择     | `<input type="file">` | 低   |
| `clipboard.writeImage`  | 截图复制     | Navigator.clipboard   | 低   |
| `app.getPath`           | 数据目录     | 服务端配置            | 中   |

#### 2.2.2 低耦合区域（可直接复用）

| 模块         | 说明                |
| ------------ | ------------------- |
| Vue 组件     | 90%+ 组件无需修改   |
| Pinia Stores | 仅需替换 API 调用层 |
| 路由配置     | 完全复用            |
| UI 样式      | 完全复用            |

### 2.3 现有 HTTP API 覆盖度

| 功能模块  | IPC方法数 | 已有HTTP API | 覆盖率 | 说明                 |
| --------- | --------- | ------------ | ------ | -------------------- |
| 会话管理  | 15+       | ✅ 完整      | 100%   | CRUD 全覆盖          |
| 消息查询  | 10+       | ✅ 完整      | 100%   | 分页、筛选全支持     |
| 统计分析  | 12+       | ⚠️ 部分      | 70%    | 缺少部分图表数据     |
| 成员管理  | 8+        | ⚠️ 部分      | 50%    | 缺少别名更新         |
| 导入功能  | 6+        | ✅ 完整      | 100%   | 支持文件上传         |
| AI对话    | 20+       | ❌ 缺失      | 0%     | **核心功能，需新增** |
| LLM配置   | 10+       | ❌ 缺失      | 0%     | 需新增               |
| 助手/技能 | 15+       | ❌ 缺失      | 0%     | 需新增               |

---

## 三、架构设计

### 3.1 目标架构：双模式

```
┌─────────────────────────────────────────────────────────────────┐
│                    ChatLab 双模式架构                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   核心服务层                              │   │
│   │  ┌───────────┐ ┌───────────┐ ┌───────────┐            │   │
│   │  │ Database  │ │ AI Engine │ │  Worker   │            │   │
│   │  │ (SQLite)  │ │ (Agent)   │ │ (Parser)  │            │   │
│   │  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘            │   │
│   │        └──────────────┼──────────────┘                  │   │
│   │                       │                                  │   │
│   │              ┌────────▼────────┐                        │   │
│   │              │  统一 API 层    │                        │   │
│   │              │  (Fastify)      │                        │   │
│   │              │                 │                        │   │
│   │              │  ┌───────────┐  │                        │   │
│   │              │  │ REST API  │  │◀── HTTP 请求          │   │
│   │              │  │ SSE Stream│  │◀── 流式响应           │   │
│   │              │  └───────────┘  │                        │   │
│   │              └────────┬────────┘                        │   │
│   └───────────────────────┼─────────────────────────────────┘   │
│                           │                                      │
│         ┌─────────────────┼─────────────────┐                   │
│         │                 │                 │                   │
│   ┌─────▼─────┐     ┌─────▼─────┐    ┌─────▼─────┐            │
│   │ 桌面模式   │     │  Web模式   │    │  API模式  │            │
│   │ (Electron)│     │ (Browser)  │    │  (纯API)  │            │
│   │           │     │            │    │           │            │
│   │ IPC通信   │     │ HTTP通信   │    │ HTTP通信  │            │
│   │ 完整功能  │     │ 浏览器访问  │    │ 第三方集成 │            │
│   │ 文件系统  │     │ 远程访问    │    │ 无UI      │            │
│   └───────────┘     └────────────┘    └───────────┘            │
│                                                                  │
│   用户类型：                                                     │
│   ├─ 本地用户 ──▶ 桌面模式（完整功能）                           │
│   ├─ 远程用户 ──▶ Web模式（浏览器访问）                          │
│   └─ 第三方系统 ──▶ API模式（HTTP API）                         │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 数据库架构

```
~/.chatlab/data/
├── databases/                    # 会话数据库（现有）
│   ├── chat_*.db
│   └── ...
│
├── settings/                     # 配置文件（现有）
│   ├── api-server.json
│   ├── llm-config.json
│   └── ...
│
├── web/                          # Web 模式新增
│   ├── users.db                  # 用户表（认证）
│   └── sessions.db               # Web 会话管理
│
└── chatlab.db                    # 主数据库（合并可选）
```

### 3.3 目录结构变更

```
electron/main/
├── api/
│   ├── server.ts                 # 现有
│   ├── index.ts                  # 现有
│   ├── auth.ts                   # 现有（Token认证）
│   ├── routes/
│   │   ├── system.ts             # 现有
│   │   ├── sessions.ts           # 现有
│   │   ├── import.ts             # 现有
│   │   ├── ai.ts                 # 新增：AI对话
│   │   ├── llm.ts                # 新增：LLM配置
│   │   ├── assistant.ts          # 新增：助手管理
│   │   ├── skill.ts              # 新增：技能管理
│   │   ├── analysis.ts           # 新增：分析图表
│   │   ├── member.ts             # 新增：成员管理
│   │   └── web-auth.ts           # 新增：Web用户认证
│   └── webStatic.ts              # 新增：静态文件服务
│
├── web/
│   ├── auth/                     # 新增：认证模块
│   │   ├── jwt.ts
│   │   └── users.ts
│   └── static/                   # 新增：Web UI 构建
│       └── (Vue 构建产物)
│
└── ...

src/
├── api/                          # 新增：API 客户端层
│   ├── client.ts                 # API 客户端抽象
│   ├── electron-client.ts        # Electron IPC 实现
│   ├── http-client.ts            # HTTP API 实现
│   └── types.ts                  # 类型定义
│
└── ...
```

---

## 四、API 设计

### 4.1 新增 API 接口

#### 4.1.1 AI 对话接口

```typescript
// POST /api/v1/sessions/:id/ai/chat
// AI 对话（非流式，简单场景）
Request:
{
  "message": "用户消息内容",
  "conversationId": "对话ID（可选，新建时省略）",
  "assistantId": "助手ID",
  "context": {
    "timeFilter": { "startTs": 0, "endTs": 0 },
    "ownerInfo": { "platformId": "", "displayName": "" }
  }
}

Response:
{
  "success": true,
  "conversationId": "xxx",
  "message": {
    "id": "xxx",
    "role": "assistant",
    "content": "AI回复内容",
    "timestamp": 1234567890
  }
}

// GET /api/v1/sessions/:id/ai/stream
// AI 对话（流式响应，SSE）
Query Parameters:
  - message: 用户消息
  - conversationId: 对话ID
  - assistantId: 助手ID
  - context: JSON编码的上下文

Response (Server-Sent Events):
event: content
data: {"type":"content","text":"这是"}

event: content
data: {"type":"content","text":"AI"}

event: tool_start
data: {"type":"tool_start","toolName":"search_messages","params":{}}

event: tool_result
data: {"type":"tool_result","toolName":"search_messages","result":{}}

event: done
data: {"type":"done","usage":{"input":100,"output":50}}
```

#### 4.1.2 对话管理接口

```typescript
// GET /api/v1/sessions/:id/ai/conversations
// 获取对话列表
Response:
{
  "success": true,
  "data": [
    {
      "id": "conv_xxx",
      "title": "对话标题",
      "assistantId": "default",
      "createdAt": 1234567890,
      "updatedAt": 1234567890
    }
  ]
}

// GET /api/v1/ai/conversations/:conversationId
// 获取单个对话详情
// DELETE /api/v1/ai/conversations/:conversationId
// 删除对话
// PATCH /api/v1/ai/conversations/:conversationId/title
// 更新对话标题
```

#### 4.1.3 LLM 配置接口

```typescript
// GET /api/v1/llm/configs
// 获取 LLM 配置列表
Response:
{
  "success": true,
  "data": [
    {
      "id": "cfg_xxx",
      "name": "DeepSeek配置",
      "provider": "deepseek",
      "model": "deepseek-chat",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKeySet": true,
      "createdAt": 1234567890
    }
  ]
}

// POST /api/v1/llm/configs
// 创建 LLM 配置
Request:
{
  "name": "配置名称",
  "provider": "deepseek",
  "apiKey": "sk-xxx",
  "model": "deepseek-chat",
  "baseUrl": "https://api.deepseek.com/v1"
}

// PATCH /api/v1/llm/configs/:id
// 更新配置
// DELETE /api/v1/llm/configs/:id
// 删除配置
// POST /api/v1/llm/configs/:id/activate
// 激活配置
// POST /api/v1/llm/configs/:id/validate
// 验证配置有效性
```

#### 4.1.4 助手管理接口

```typescript
// GET /api/v1/assistants
// 获取助手列表
// GET /api/v1/assistants/:id
// 获取助手详情
// POST /api/v1/assistants
// 创建助手
// PATCH /api/v1/assistants/:id
// 更新助手
// DELETE /api/v1/assistants/:id
// 删除助手
```

#### 4.1.5 技能管理接口

```typescript
// GET /api/v1/skills
// 获取技能列表
// GET /api/v1/skills/:id
// 获取技能详情
// POST /api/v1/skills
// 创建技能
// PATCH /api/v1/skills/:id
// 更新技能
// DELETE /api/v1/skills/:id
// 删除技能
```

#### 4.1.6 分析数据接口

```typescript
// GET /api/v1/sessions/:id/analysis/wordcloud
// 词云数据
Response:
{
  "success": true,
  "data": {
    "words": [
      { "word": "好的", "count": 156, "percentage": 5.2 },
      { "word": "收到", "count": 89, "percentage": 3.0 }
    ],
    "totalWords": 3000
  }
}

// GET /api/v1/sessions/:id/analysis/heatmap
// 活跃度热力图数据
// GET /api/v1/sessions/:id/analysis/cluster
// 成员聚类数据
// GET /api/v1/sessions/:id/analysis/interaction
// 互动关系数据
```

#### 4.1.7 成员管理接口（补充）

```typescript
// PATCH /api/v1/sessions/:id/members/:memberId
// 更新成员别名
Request:
{
  "aliases": ["别名1", "别名2"]
}

// DELETE /api/v1/sessions/:id/members/:memberId
// 删除成员
```

#### 4.1.8 Web 用户认证接口

```typescript
// POST /api/v1/auth/login
// 用户登录
Request:
{
  "password": "访问密码"
}
Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresAt": 1234567890
}

// POST /api/v1/auth/logout
// 用户登出
// GET /api/v1/auth/verify
// 验证 Token 有效性
// POST /api/v1/auth/refresh
// 刷新 Token
```

### 4.2 完整 API 列表

| 接口                                    | 方法     | 说明             | 优先级 |
| --------------------------------------- | -------- | ---------------- | ------ |
| `/api/v1/status`                        | GET      | 服务状态         | P0     |
| `/api/v1/sessions`                      | GET      | 会话列表         | P0     |
| `/api/v1/sessions/:id`                  | GET      | 会话详情         | P0     |
| `/api/v1/sessions/:id/messages`         | GET      | 消息查询         | P0     |
| `/api/v1/sessions/:id/members`          | GET      | 成员列表         | P0     |
| `/api/v1/sessions/:id/stats/overview`   | GET      | 概览统计         | P0     |
| `/api/v1/import`                        | POST     | 导入新会话       | P1     |
| `/api/v1/sessions/:id/import`           | POST     | 增量导入         | P1     |
| `/api/v1/sessions/:id/sql`              | POST     | SQL查询          | P1     |
| `/api/v1/sessions/:id/export`           | GET      | 导出数据         | P1     |
| `/api/v1/sessions/:id/ai/chat`          | POST     | AI对话（非流式） | P2     |
| `/api/v1/sessions/:id/ai/stream`        | GET      | AI对话（流式）   | P2     |
| `/api/v1/sessions/:id/ai/conversations` | GET      | 对话列表         | P2     |
| `/api/v1/llm/configs`                   | GET/POST | LLM配置          | P2     |
| `/api/v1/assistants`                    | GET/POST | 助手管理         | P2     |
| `/api/v1/skills`                        | GET/POST | 技能管理         | P2     |
| `/api/v1/auth/login`                    | POST     | 用户登录         | P2     |
| `/api/v1/sessions/:id/analysis/*`       | GET      | 分析数据         | P3     |

---

## 五、前端改造

### 5.1 API 客户端抽象层

```typescript
// src/api/types.ts
export interface ChatApi {
  getSessions(): Promise<AnalysisSession[]>
  getSession(sessionId: string): Promise<AnalysisSession | null>
  deleteSession(sessionId: string): Promise<boolean>
  renameSession(sessionId: string, newName: string): Promise<boolean>
  getMembers(sessionId: string): Promise<MemberWithStats[]>
  getMemberActivity(sessionId: string, filter?: TimeFilter): Promise<MemberActivity[]>
  // ... 其他方法
}

export interface AiApi {
  searchMessages(
    sessionId: string,
    keywords: string[],
    filter?: TimeFilter,
    limit?: number,
    offset?: number,
    senderId?: number
  ): Promise<{ messages: SearchMessageResult[]; total: number }>
  createConversation(sessionId: string, title: string | undefined, assistantId: string): Promise<AIConversation>
  getConversations(sessionId: string): Promise<AIConversation[]>
  // ... 其他方法
}

export interface LlmApi {
  getAllConfigs(): Promise<AIServiceConfigDisplay[]>
  getActiveConfigId(): Promise<string | null>
  addConfig(config: any): Promise<{ success: boolean; config?: AIServiceConfigDisplay; error?: string }>
  // ... 其他方法
}

// src/api/client.ts
import type { ChatApi, AiApi, LlmApi } from './types'

/**
 * 统一 API 客户端接口
 */
export interface ApiClient {
  chat: ChatApi
  ai: AiApi
  llm: LlmApi
  // ... 其他 API
}

/**
 * 检测运行环境
 */
export const isElectron = typeof window !== 'undefined' && typeof (window as any).electron !== 'undefined'

/**
 * 获取 API 客户端实例
 */
export function getApiClient(): ApiClient {
  if (isElectron) {
    return createElectronClient()
  }
  return createHttpClient()
}
```

### 5.2 Electron IPC 客户端

```typescript
// src/api/electron-client.ts
import type { ApiClient, ChatApi, AiApi, LlmApi } from './types'

declare global {
  interface Window {
    chatApi: ChatApi
    aiApi: AiApi
    llmApi: LlmApi
    // ... 其他 API
  }
}

export function createElectronClient(): ApiClient {
  return {
    chat: window.chatApi,
    ai: window.aiApi,
    llm: window.llmApi,
    // ... 直接使用 window.xxxApi
  }
}
```

### 5.3 HTTP API 客户端

```typescript
// src/api/http-client.ts
import type { ApiClient, ChatApi, AiApi, LlmApi } from './types'

class HttpClient {
  private baseUrl: string
  private token: string | null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
    this.token = localStorage.getItem('auth_token')
  }

  setToken(token: string | null) {
    this.token = token
    if (token) {
      localStorage.setItem('auth_token', token)
    } else {
      localStorage.removeItem('auth_token')
    }
  }

  private async request<T>(method: string, path: string, body?: any, options?: { stream?: boolean }): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      if (response.status === 401) {
        // Token 过期，跳转登录
        this.setToken(null)
        window.location.href = '/login'
        throw new Error('Unauthorized')
      }
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(error.message || `HTTP ${response.status}`)
    }

    return response.json()
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  async post<T>(path: string, body?: any): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  async patch<T>(path: string, body?: any): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  /**
   * SSE 流式请求
   */
  async stream(
    path: string,
    params: Record<string, any>,
    onChunk: (chunk: any) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const url = new URL(`${this.baseUrl}${path}`)
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
      }
    })

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: this.token ? `Bearer ${this.token}` : '',
      },
      signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            onChunk(data)
          } catch {
            // 忽略解析错误
          }
        }
      }
    }
  }
}

export function createHttpClient(): ApiClient {
  const baseUrl = localStorage.getItem('api_url') || window.location.origin
  const http = new HttpClient(baseUrl)

  return {
    chat: createChatApi(http),
    ai: createAiApi(http),
    llm: createLlmApi(http),
  }
}

function createChatApi(http: HttpClient): ChatApi {
  return {
    async getSessions() {
      const res = await http.get<{ success: boolean; data: AnalysisSession[] }>('/api/v1/sessions')
      return res.data
    },

    async getSession(sessionId) {
      const res = await http.get<{ success: boolean; data: AnalysisSession | null }>(`/api/v1/sessions/${sessionId}`)
      return res.data
    },

    async deleteSession(sessionId) {
      const res = await http.delete<{ success: boolean }>(`/api/v1/sessions/${sessionId}`)
      return res.success
    },

    async renameSession(sessionId, newName) {
      const res = await http.patch<{ success: boolean }>(`/api/v1/sessions/${sessionId}`, { name: newName })
      return res.success
    },

    async getMembers(sessionId) {
      const res = await http.get<{ success: boolean; data: MemberWithStats[] }>(`/api/v1/sessions/${sessionId}/members`)
      return res.data
    },

    async getMemberActivity(sessionId, filter) {
      const params = new URLSearchParams()
      if (filter?.startTs) params.set('startTime', String(filter.startTs))
      if (filter?.endTs) params.set('endTime', String(filter.endTs))
      const query = params.toString() ? `?${params}` : ''
      const res = await http.get<{ success: boolean; data: MemberActivity[] }>(
        `/api/v1/sessions/${sessionId}/stats/activity${query}`
      )
      return res.data
    },

    // ... 其他方法实现
  }
}

function createAiApi(http: HttpClient): AiApi {
  return {
    async searchMessages(sessionId, keywords, filter, limit, offset, senderId) {
      const params = new URLSearchParams()
      keywords.forEach((k) => params.append('keyword', k))
      if (filter?.startTs) params.set('startTime', String(filter.startTs))
      if (filter?.endTs) params.set('endTime', String(filter.endTs))
      if (limit) params.set('limit', String(limit))
      if (offset) params.set('page', String(Math.floor(offset / (limit || 100)) + 1))
      if (senderId) params.set('senderId', String(senderId))

      const res = await http.get<{ success: boolean; data: { messages: SearchMessageResult[]; total: number } }>(
        `/api/v1/sessions/${sessionId}/messages?${params}`
      )
      return res.data
    },

    async createConversation(sessionId, title, assistantId) {
      const res = await http.post<{ success: boolean; data: AIConversation }>(
        `/api/v1/sessions/${sessionId}/ai/conversations`,
        { title, assistantId }
      )
      return res.data
    },

    async getConversations(sessionId) {
      const res = await http.get<{ success: boolean; data: AIConversation[] }>(
        `/api/v1/sessions/${sessionId}/ai/conversations`
      )
      return res.data
    },

    // ... 其他方法实现
  }
}

function createLlmApi(http: HttpClient): LlmApi {
  return {
    async getAllConfigs() {
      const res = await http.get<{ success: boolean; data: AIServiceConfigDisplay[] }>('/api/v1/llm/configs')
      return res.data
    },

    async getActiveConfigId() {
      const res = await http.get<{ success: boolean; data: string | null }>('/api/v1/llm/configs/active')
      return res.data
    },

    async addConfig(config) {
      return http.post<{ success: boolean; config?: AIServiceConfigDisplay; error?: string }>(
        '/api/v1/llm/configs',
        config
      )
    },

    // ... 其他方法实现
  }
}
```

### 5.4 Store 层适配

```typescript
// src/stores/session.ts（改造后）
import { getApiClient } from '@/api/client'

export const useSessionStore = defineStore('session', () => {
  const sessions = ref<AnalysisSession[]>([])
  const currentSessionId = ref<string | null>(null)

  // 使用统一 API 客户端
  const api = getApiClient()

  async function loadSessions() {
    try {
      sessions.value = await api.chat.getSessions()
    } catch (error) {
      console.error('加载会话失败:', error)
    }
  }

  async function selectSession(id: string) {
    currentSessionId.value = id
  }

  async function deleteSession(id: string) {
    const success = await api.chat.deleteSession(id)
    if (success) {
      sessions.value = sessions.value.filter((s) => s.id !== id)
      if (currentSessionId.value === id) {
        currentSessionId.value = null
      }
    }
    return success
  }

  return {
    sessions,
    currentSessionId,
    loadSessions,
    selectSession,
    deleteSession,
  }
})
```

### 5.5 AI 对话流式处理

```typescript
// src/composables/useAiChat.ts
import { getApiClient } from '@/api/client'
import type { AgentStreamChunk } from '@/api/types'

export function useAiChat(sessionId: string) {
  const api = getApiClient()
  const isStreaming = ref(false)
  const abortController = ref<AbortController | null>(null)
  const chunks = ref<AgentStreamChunk[]>([])

  async function sendMessage(
    message: string,
    conversationId: string | undefined,
    assistantId: string,
    onChunk?: (chunk: AgentStreamChunk) => void
  ) {
    isStreaming.value = true
    chunks.value = []
    abortController.value = new AbortController()

    try {
      // 检测是否为 Electron 环境
      if ('chat' in api && 'runStream' in (api as any)) {
        // Electron 模式：使用 IPC 流式
        const { requestId, promise } = (api as any).agent.runStream(
          message,
          { sessionId, conversationId, assistantId },
          (chunk: AgentStreamChunk) => {
            chunks.value.push(chunk)
            onChunk?.(chunk)
          }
        )
        await promise
      } else {
        // Web 模式：使用 SSE
        await (api as any).stream(
          `/api/v1/sessions/${sessionId}/ai/stream`,
          { message, conversationId, assistantId },
          (chunk: AgentStreamChunk) => {
            chunks.value.push(chunk)
            onChunk?.(chunk)
          },
          abortController.value.signal
        )
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('AI 对话错误:', error)
        throw error
      }
    } finally {
      isStreaming.value = false
      abortController.value = null
    }
  }

  function abort() {
    abortController.value?.abort()
  }

  return {
    isStreaming,
    chunks,
    sendMessage,
    abort,
  }
}
```

---

## 六、认证与安全

### 6.1 认证方案

```
┌─────────────────────────────────────────────────────────────────┐
│                    认证方案设计                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Phase 1：单用户模式（简单，推荐首选）                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  配置文件设置单一访问密码                                │   │
│  │  ├─ settings/web-auth.json                              │   │
│  │  │   { "enabled": true, "passwordHash": "xxx" }         │   │
│  │  ├─ 登录后返回 JWT Token                                 │   │
│  │  └─ 所有 API 请求携带 Token                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Phase 2：多用户模式（可选扩展）                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  用户表、权限管理                                        │   │
│  │  ├─ users.db                                            │   │
│  │  │   - id, username, passwordHash, role, createdAt      │   │
│  │  ├─ 数据隔离（每个用户只能看自己的会话）                 │   │
│  │  └─ 适合企业级部署                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 用户数据模型

```sql
-- web/users.db

-- 用户表
CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',           -- admin/user
  created_ts INTEGER NOT NULL,
  last_login_ts INTEGER
);

-- 会话表（Web会话）
CREATE TABLE IF NOT EXISTS web_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,    -- JWT Token 哈希
  expires_at INTEGER NOT NULL,
  created_ts INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES user(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_user_username ON user(username);
CREATE INDEX IF NOT EXISTS idx_session_token ON web_session(token_hash);
CREATE INDEX IF NOT EXISTS idx_session_expires ON web_session(expires_at);
```

### 6.3 JWT 配置

```typescript
// electron/main/web/auth/jwt.ts
import * as crypto from 'crypto'

const JWT_SECRET = crypto.randomBytes(64).toString('hex')
const JWT_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000 // 7天

export interface JwtPayload {
  userId: number
  username: string
  role: string
  iat: number
  exp: number
}

export function generateToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const now = Date.now()
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + JWT_EXPIRES_IN,
  }

  // 使用 HMAC-SHA256 签名
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url')

  return `${header}.${body}.${signature}`
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const [header, body, signature] = token.split('.')

    // 验证签名
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url')

    if (signature !== expectedSignature) {
      return null
    }

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as JwtPayload

    // 验证过期时间
    if (payload.exp < Date.now()) {
      return null
    }

    return payload
  } catch {
    return null
  }
}
```

### 6.4 认证中间件

```typescript
// electron/main/api/webAuth.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyToken } from '../web/auth/jwt'

// 公开路由（无需认证）
const PUBLIC_ROUTES = ['/api/v1/status', '/api/v1/auth/login', '/api/v1/schema']

export async function webAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // 公开路由跳过认证
  if (PUBLIC_ROUTES.some((route) => request.url.startsWith(route))) {
    return
  }

  // 检查 Authorization 头
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ success: false, error: 'Unauthorized' })
    return
  }

  const token = authHeader.slice(7)
  const payload = verifyToken(token)

  if (!payload) {
    reply.code(401).send({ success: false, error: 'Invalid or expired token' })
    return
  }

  // 将用户信息附加到请求对象
  ;(request as any).user = payload
}
```

---

## 七、功能差异处理

### 7.1 功能对比矩阵

| 功能         | 桌面模式    | Web模式                 | 处理方案   |
| ------------ | ----------- | ----------------------- | ---------- |
| **会话浏览** | ✅ 完整     | ✅ 完整                 | 无差异     |
| **消息查询** | ✅ 完整     | ✅ 完整                 | 无差异     |
| **统计分析** | ✅ 完整     | ✅ 完整                 | 无差异     |
| **AI对话**   | ✅ 完整     | ✅ 完整                 | SSE 流式   |
| **数据导入** | ✅ 本地文件 | ✅ 文件上传             | UI 适配    |
| **数据导出** | ✅ 本地保存 | ✅ 浏览器下载           | 无差异     |
| **LLM配置**  | ✅ 完整     | ✅ 完整                 | 无差异     |
| **截图分享** | ✅ 原生截图 | ⚠️ 浏览器API            | 功能降级   |
| **系统通知** | ✅ 原生通知 | ⚠️ Web通知              | 功能降级   |
| **自动更新** | ✅ Electron | ❌ 手动刷新             | Web 不支持 |
| **文件拖放** | ✅ 完整     | ✅ HTML5 API            | 无差异     |
| **深色模式** | ✅ 系统跟随 | ✅ prefers-color-scheme | 无差异     |

### 7.2 条件渲染

```vue
<!-- 组件中的条件渲染示例 -->
<template>
  <div>
    <!-- 桌面端特有功能 -->
    <template v-if="isElectron">
      <button @click="openNativeDialog">选择文件夹</button>
      <button @click="takeScreenshot">截图</button>
    </template>

    <!-- Web 端替代方案 -->
    <template v-else>
      <input type="file" @change="handleFileUpload" />
      <span class="text-gray-400">截图功能仅在桌面端可用</span>
    </template>

    <!-- 通用功能 -->
    <button @click="exportData">导出数据</button>
  </div>
</template>

<script setup lang="ts">
import { isElectron } from '@/api/client'

function openNativeDialog() {
  window.chatApi.selectFile()
}

function handleFileUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) {
    uploadFile(file)
  }
}
</script>
```

---

## 八、部署方案

### 8.1 单机部署

```yaml
# docker-compose.yml
version: '3.8'

services:
  chatlab:
    image: chatlab/server:latest
    container_name: chatlab
    ports:
      - '5200:5200'
    volumes:
      - ./data:/app/data
      - ./config:/app/config
    environment:
      - NODE_ENV=production
      - WEB_MODE=true
      - WEB_PORT=5200
    restart: unless-stopped
```

### 8.2 Nginx 反向代理

```nginx
# /etc/nginx/sites-available/chatlab
server {
    listen 443 ssl http2;
    server_name chatlab.example.com;

    ssl_certificate /etc/letsencrypt/live/chatlab.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chatlab.example.com/privkey.pem;

    # 客户端最大上传 100MB
    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:5200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 流式响应超时设置
        proxy_read_timeout 300s;
        proxy_buffering off;
    }

    # SSE 流式接口特殊配置
    location /api/v1/sessions/ {
        proxy_pass http://127.0.0.1:5200;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }
}

# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name chatlab.example.com;
    return 301 https://$server_name$request_uri;
}
```

### 8.3 环境变量配置

```bash
# .env.production

# 服务配置
WEB_MODE=true
WEB_PORT=5200
WEB_HOST=0.0.0.0

# 认证配置
AUTH_ENABLED=true
AUTH_JWT_SECRET=your-secret-key-here
AUTH_TOKEN_EXPIRES=604800000  # 7天（毫秒）

# 数据目录
DATA_DIR=/app/data

# 日志配置
LOG_LEVEL=info
LOG_FILE=/app/logs/chatlab.log
```

---

## 九、实现计划

### 9.1 分阶段迭代

| 阶段        | 功能         | 任务                          | 工作量  |
| ----------- | ------------ | ----------------------------- | ------- |
| **Phase 1** | API 扩展     | 新增 AI、LLM、助手、技能 API  | 4-5人日 |
| **Phase 2** | API 客户端层 | 创建 Electron/HTTP 客户端抽象 | 2-3人日 |
| **Phase 3** | Store 适配   | 改造所有 Store 使用新 API 层  | 2-3人日 |
| **Phase 4** | 流式响应     | SSE 流式 AI 对话实现          | 2人日   |
| **Phase 5** | 认证系统     | Web 用户认证、JWT             | 2人日   |
| **Phase 6** | 静态文件服务 | Vue 构建产物托管              | 1人日   |
| **Phase 7** | 测试与文档   | 功能测试、部署文档            | 2人日   |

**总计：约 15-18 人日（3 周）**

### 9.2 技术风险

| 风险           | 影响                      | 缓解措施                      |
| -------------- | ------------------------- | ----------------------------- |
| 流式响应兼容性 | 部分浏览器 SSE 支持不完整 | 提供轮询降级方案              |
| 大文件上传     | 内存占用过高              | 使用流式上传、限制大小        |
| Token 安全     | JWT 被窃取                | HTTPS + 短过期时间 + 刷新机制 |
| 并发性能       | 多用户同时访问            | 增加连接池、优化数据库查询    |

---

## 十、附录

### A. 文件路径规划

```
electron/main/
├── api/
│   ├── server.ts                 # 现有
│   ├── index.ts                  # 现有
│   ├── auth.ts                   # 现有
│   ├── webAuth.ts                # 新增：Web认证中间件
│   ├── routes/
│   │   ├── system.ts             # 现有
│   │   ├── sessions.ts           # 现有（扩展）
│   │   ├── import.ts             # 现有
│   │   ├── ai.ts                 # 新增
│   │   ├── llm.ts                # 新增
│   │   ├── assistant.ts          # 新增
│   │   ├── skill.ts              # 新增
│   │   ├── analysis.ts           # 新增
│   │   ├── member.ts             # 新增
│   │   └── auth.ts               # 新增
│   └── static.ts                 # 新增：静态文件服务
│
├── web/
│   ├── auth/
│   │   ├── jwt.ts                # 新增
│   │   └── users.ts              # 新增
│   └── static/                   # 新增：Vue构建产物
│
└── ...

src/
├── api/                          # 新增
│   ├── client.ts
│   ├── types.ts
│   ├── electron-client.ts
│   └── http-client.ts
│
└── ...

electron.vite.config.ts           # 修改：添加Web构建配置
```

### B. 国际化Key设计

```json
{
  "web.login.title": "登录",
  "web.login.password": "访问密码",
  "web.login.submit": "登录",
  "web.login.error": "密码错误",

  "web.error.unauthorized": "未授权，请重新登录",
  "web.error.tokenExpired": "登录已过期，请重新登录",

  "web.feature.screenshot": "截图功能仅在桌面端可用",
  "web.feature.notification": "通知功能受限",

  "settings.web.title": "Web 服务",
  "settings.web.enabled": "启用 Web 访问",
  "settings.web.port": "端口",
  "settings.web.password": "访问密码",
  "settings.web.url": "访问地址"
}
```

### C. 配置文件设计

```typescript
// settings/web-config.json
interface WebConfig {
  enabled: boolean
  port: number
  host: string
  auth: {
    enabled: boolean
    passwordHash: string
    tokenExpiresIn: number
  }
  cors: {
    enabled: boolean
    origins: string[]
  }
  upload: {
    maxSize: number // 字节
    allowedTypes: string[]
  }
}

const DEFAULT_WEB_CONFIG: WebConfig = {
  enabled: false,
  port: 5200,
  host: '0.0.0.0',
  auth: {
    enabled: true,
    passwordHash: '',
    tokenExpiresIn: 7 * 24 * 60 * 60 * 1000,
  },
  cors: {
    enabled: false,
    origins: [],
  },
  upload: {
    maxSize: 100 * 1024 * 1024, // 100MB
    allowedTypes: ['.json', '.txt', '.csv', '.xlsx'],
  },
}
```

---

**文档结束** | v1.0 | 待评审
