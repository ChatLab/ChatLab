# ChatLab 智能协作特性设计文档

> 版本: v1.1  
> 日期: 2026-03-31  
> 状态: 需求确认完成，进入详细设计阶段

---

## 〇、设计决策确认

> 以下决策已在需求评审阶段与用户确认：

| 决策项             | 确认方案                                               |
| ------------------ | ------------------------------------------------------ |
| **用户身份关联**   | 自动匹配相似昵称（无需手动配置）                       |
| **任务提取时机**   | 导入时自动提取（当前不支持实时同步）                   |
| **知识图谱Schema** | 固定基础Schema + LLM动态扩展Schema（不允许用户自定义） |
| **知识审核机制**   | 自动生成，支持人工修改                                 |
| **数据范围**       | **所有功能均为跨会话（跨聊天群）设计**                 |

---

## 一、需求概述

### 1.1 背景与目标

ChatLab 当前主要聚焦于聊天记录的**统计分析**和**AI问答**能力。用户提出扩展需求，希望将聊天记录转化为**可执行的工作资产**：

| 核心诉求     | 描述                                   |
| ------------ | -------------------------------------- |
| **任务管理** | 跨会话提取任务、跟踪状态、分配责任人   |
| **待办清单** | 跨会话的个人任务聚合视图               |
| **关注管理** | 跨会话识别并追踪个人关注的事项         |
| **知识沉淀** | 跨会话FAQ自动生成、知识库问答          |
| **知识图谱** | 跨会话可视化关系网络，支持时间维度过滤 |

### 1.2 核心设计原则

1. **跨会话优先**：所有数据模型和查询设计均以跨会话聚合为首要目标
2. **自动身份识别**：基于昵称相似度自动关联同一用户在不同会话中的身份
3. **导入时提取**：聊天记录导入时自动触发AI提取，无需手动触发
4. **人工可干预**：所有AI生成结果均支持人工修改和校正
5. **Schema混合模式**：固定核心实体 + LLM动态扩展实体的双层架构

### 1.3 功能矩阵

```
┌─────────────────────────────────────────────────────────────────┐
│                      ChatLab 智能协作层                          │
│                    （所有功能均跨会话聚合）                        │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤
│   Task Tab  │   Todo Tab  │  Focus Tab  │Knowledge Tab│Graph Tab│
│   任务管理   │   待办清单   │   关注点    │   知识库    │ 知识图谱 │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       全局数据聚合层                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              用户身份识别服务 (昵称相似度匹配)             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       AI 提取引擎                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ 任务提取  │  │ 实体识别  │  │ 关系抽取  │  │ FAQ/知识生成     │ │
│  │ (导入时)  │  │ (双层Schema)│ │ (动态+固定)│ │ (自动+人工校正)  │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       数据持久层                                 │
│  ┌──────────────────┐  ┌──────────────────────────────────┐    │
│  │  会话数据库       │  │        全局数据库                 │    │
│  │  (各聊天群独立)   │  │  (跨会话聚合: task/todo/graph等) │    │
│  │  - message       │  │  - task (全局任务)               │    │
│  │  - member        │  │  - personal_todo                │    │
│  │  - chat_session  │  │  - knowledge_item               │    │
│  └──────────────────┘  │  - graph_node/edge               │    │
│                         │  - user_identity                 │    │
│                         └──────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、跨会话数据架构设计

### 2.1 双层数据库架构

为支持跨会话聚合，采用**会话数据库 + 全局数据库**的双层架构：

```
数据目录结构:
~/.chatlab/data/
├── databases/                    # 会话级数据库（现有）
│   ├── chat_1704067200_abc123.db    # 群A的聊天记录
│   ├── chat_1704153600_def456.db    # 群B的聊天记录
│   └── ...
│
└── global/                       # 全局数据库（新增）
    ├── collaboration.db             # 任务/待办/关注/知识
    ├── knowledge_graph.db           # 知识图谱
    └── user_identity.db             # 用户身份映射
```

### 2.2 数据分层策略

| 数据类型  | 存储位置   | 说明                         |
| --------- | ---------- | ---------------------------- |
| 原始消息  | 会话数据库 | 消息、成员、会话段等原始数据 |
| 任务/待办 | 全局数据库 | 跨会话聚合，关联到源会话     |
| 知识库    | 全局数据库 | 跨会话知识沉淀               |
| 知识图谱  | 全局数据库 | 跨会话实体关系网络           |
| 用户身份  | 全局数据库 | 跨会话身份映射               |

### 2.3 用户身份自动识别机制

#### 2.3.1 识别策略

```typescript
interface UserIdentityMatch {
  globalUserId: string // 全局用户ID
  displayName: string // 显示名称
  identities: {
    // 各会话中的身份
    sessionId: string
    memberId: number
    platformId: string
    accountName: string
    groupNickname: string
    similarity: number // 匹配置信度
  }[]
}

// 身份匹配算法
async function matchUserIdentity(sessionId: string, member: Member): Promise<string> {
  // 1. 精确匹配：同一平台ID
  const exactMatch = await findExactMatch(member.platformId)
  if (exactMatch) return exactMatch.globalUserId

  // 2. 模糊匹配：昵称相似度
  const candidates = await findSimilarNames(member.accountName, member.groupNickname)
  if (candidates.length > 0) {
    const best = candidates[0]
    if (best.similarity >= 0.85) {
      // 高置信度：自动关联
      await linkIdentity(best.globalUserId, sessionId, member)
      return best.globalUserId
    } else if (best.similarity >= 0.6) {
      // 中等置信度：等待用户确认
      await pendingMatch(best.globalUserId, sessionId, member)
      return null // 暂不关联
    }
  }

  // 3. 创建新身份
  return await createNewIdentity(sessionId, member)
}
```

#### 2.3.2 昵称相似度算法

```typescript
function calculateNameSimilarity(name1: string, name2: string): number {
  // 1. 完全相同
  if (name1 === name2) return 1.0

  // 2. 归一化处理
  const n1 = normalizeName(name1)
  const n2 = normalizeName(name2)

  // 3. 编辑距离
  const editDistance = levenshteinDistance(n1, n2)
  const maxLen = Math.max(n1.length, n2.length)
  const editSimilarity = 1 - editDistance / maxLen

  // 4. Jaccard 相似度（基于字符）
  const jaccardSimilarity = jaccardSimilarityChars(n1, n2)

  // 5. 拼音相似度（中文特有）
  const pinyinSimilarity = calculatePinyinSimilarity(n1, n2)

  // 加权综合
  return 0.4 * editSimilarity + 0.3 * jaccardSimilarity + 0.3 * pinyinSimilarity
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '') // 移除空格
    .replace(/[^\w\u4e00-\u9fa5]/g, '') // 只保留字母数字中文
}
```

#### 2.3.3 数据模型

```sql
-- 全局用户身份表
CREATE TABLE IF NOT EXISTS global_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_user_id TEXT NOT NULL UNIQUE,  -- UUID格式的全局ID
  display_name TEXT NOT NULL,           -- 主要显示名称
  avatar TEXT,
  created_ts INTEGER NOT NULL,
  last_active_ts INTEGER
);

-- 会话身份映射表
CREATE TABLE IF NOT EXISTS user_identity_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,             -- 会话ID
  member_id INTEGER NOT NULL,           -- 会话内的成员ID
  platform_id TEXT,                     -- 平台用户ID
  account_name TEXT,
  group_nickname TEXT,
  match_type TEXT NOT NULL,             -- exact/fuzzy/manual
  confidence REAL DEFAULT 1.0,
  confirmed INTEGER DEFAULT 0,          -- 是否用户确认
  created_ts INTEGER NOT NULL,
  FOREIGN KEY(global_user_id) REFERENCES global_user(global_user_id),
  UNIQUE(session_id, member_id)
);

-- 待确认的身份匹配
CREATE TABLE IF NOT EXISTS pending_identity_match (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  member_id INTEGER NOT NULL,
  suggested_name TEXT,
  confidence REAL,
  created_ts INTEGER NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_identity_user ON user_identity_mapping(global_user_id);
CREATE INDEX IF NOT EXISTS idx_identity_session ON user_identity_mapping(session_id);
CREATE INDEX IF NOT EXISTS idx_identity_member ON user_identity_mapping(session_id, member_id);
CREATE INDEX IF NOT EXISTS idx_identity_name ON user_identity_mapping(account_name);
```

---

## 三、功能模块设计

### 3.1 Task Tab（任务管理）

#### 3.1.1 功能描述

跨会话任务识别与管理：

- **跨会话提取**：从所有聊天群中自动识别并提取任务
- **导入时自动提取**：聊天记录导入时自动触发AI任务识别
- **属性提取**：责任人、截止时间、优先级、相关人
- **状态跟踪**：待处理 → 进行中 → 已完成 / 已取消
- **关联溯源**：点击任务可跳转到原始消息上下文（跨会话）
- **人工修正**：支持手动修改AI提取的任务属性

#### 3.1.2 数据模型（全局数据库）

```sql
-- 全局任务表
CREATE TABLE IF NOT EXISTS global_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,                         -- 任务标题
  description TEXT,                            -- 任务描述
  status TEXT DEFAULT 'pending',               -- 状态: pending/in_progress/completed/cancelled
  priority TEXT DEFAULT 'normal',              -- 优先级: low/normal/high/urgent

  -- 责任人（跨会话身份）
  owner_global_user_id TEXT,                   -- 责任人全局用户ID
  owner_display_name TEXT,                     -- 责任人显示名称（冗余，便于查询）

  -- 时间信息
  due_ts INTEGER,                              -- 截止时间戳
  created_ts INTEGER NOT NULL,                 -- 创建时间
  updated_ts INTEGER NOT NULL,                 -- 更新时间
  completed_ts INTEGER,                        -- 完成时间

  -- AI提取信息
  confidence REAL DEFAULT 1.0,                 -- AI提取置信度 (0-1)
  is_manual INTEGER DEFAULT 0,                 -- 是否手动创建 (0=AI提取, 1=手动)

  -- 扩展属性
  tags TEXT DEFAULT '[]',                      -- 标签列表
  metadata TEXT DEFAULT '{}',                  -- 扩展元数据 (JSON)

  FOREIGN KEY(owner_global_user_id) REFERENCES global_user(global_user_id)
);

-- 任务来源关联表（多对多：一个任务可能在多个会话中被讨论）
CREATE TABLE IF NOT EXISTS task_source (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,                    -- 来源会话ID
  message_id INTEGER NOT NULL,                 -- 来源消息ID（在会话数据库中的ID）
  message_ts INTEGER NOT NULL,                 -- 消息时间戳
  extracted_ts INTEGER NOT NULL,               -- 提取时间
  confidence REAL DEFAULT 1.0,                 -- 该来源的提取置信度
  FOREIGN KEY(task_id) REFERENCES global_task(id) ON DELETE CASCADE,
  UNIQUE(task_id, session_id, message_id)
);

-- 任务参与者表（跨会话）
CREATE TABLE IF NOT EXISTS task_participant (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  global_user_id TEXT NOT NULL,                -- 参与者全局用户ID
  role TEXT DEFAULT 'collaborator',            -- 角色: owner/collaborator/reviewer/follower
  session_id TEXT,                             -- 在哪个会话中被识别为参与者
  FOREIGN KEY(task_id) REFERENCES global_task(id) ON DELETE CASCADE,
  FOREIGN KEY(global_user_id) REFERENCES global_user(global_user_id),
  UNIQUE(task_id, global_user_id)
);

-- 任务编辑历史（支持人工修改追踪）
CREATE TABLE IF NOT EXISTS task_edit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  field TEXT NOT NULL,                         -- 修改的字段
  old_value TEXT,
  new_value TEXT,
  edited_by TEXT,                              -- 编辑者（system/user）
  edited_ts INTEGER NOT NULL,
  FOREIGN KEY(task_id) REFERENCES global_task(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_task_status ON global_task(status);
CREATE INDEX IF NOT EXISTS idx_task_owner ON global_task(owner_global_user_id);
CREATE INDEX IF NOT EXISTS idx_task_due ON global_task(due_ts);
CREATE INDEX IF NOT EXISTS idx_task_created ON global_task(created_ts);
CREATE INDEX IF NOT EXISTS idx_task_source_session ON task_source(session_id);
CREATE INDEX IF NOT EXISTS idx_task_participant ON task_participant(global_user_id);
```

#### 3.1.3 导入时自动提取流程

```typescript
// 导入流程中的任务提取钩子
async function onImportComplete(sessionId: string, importResult: ImportResult) {
  // 1. 获取导入的消息
  const messages = await getImportedMessages(sessionId, importResult.messageRange)

  // 2. 批量提取任务（分批处理，避免token溢出）
  const batchSize = 50
  const allTasks: ExtractedTask[] = []

  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize)
    const tasks = await extractTasksWithLLM(batch)
    allTasks.push(...tasks)
  }

  // 3. 去重与合并（同一任务可能在不同消息中被提及）
  const mergedTasks = await mergeAndDeduplicateTasks(allTasks)

  // 4. 关联用户身份
  for (const task of mergedTasks) {
    if (task.ownerName) {
      const ownerIdentity = await matchUserIdentityByName(sessionId, task.ownerName)
      if (ownerIdentity) {
        task.ownerGlobalUserId = ownerIdentity.globalUserId
      }
    }
  }

  // 5. 存入全局数据库
  await saveTasksToGlobalDB(sessionId, mergedTasks)

  // 6. 更新统计
  await updateTaskStats(sessionId, mergedTasks.length)
}
```

#### 3.1.4 AI任务提取Prompt

```
你是一个任务提取专家。请分析以下聊天消息，识别其中的任务信息。

消息列表（包含时间、发送者、内容）:
{messages}

请提取所有明确的任务，返回JSON格式:
{
  "tasks": [
    {
      "title": "任务标题（简洁明确，不超过50字）",
      "description": "任务详细描述（可选）",
      "owner_name": "责任人姓名（明确提到时填写）",
      "due_date": "截止日期，格式YYYY-MM-DD（明确提到时填写）",
      "due_time": "截止时间，格式HH:MM（明确提到时填写）",
      "priority": "low/normal/high/urgent",
      "participants": ["参与者姓名列表"],
      "task_type": "feature/bug/meeting/document/review/other",
      "status_hint": "pending/in_progress/completed（从上下文推断）",
      "confidence": 0.95,
      "source_message_indices": [0, 2]
    }
  ]
}

提取规则：
1. 只提取明确的任务，不要推测或创造任务
2. 任务标题应简洁，去掉"请"、"帮忙"等修饰词
3. 如果责任人不明确，owner_name留空
4. 截止日期/时间只在明确提到时填写
5. priority根据语气和关键词判断（紧急/尽快/ASAP → urgent）
6. confidence表示提取的可靠程度(0-1)
7. source_message_indices指向任务来源的消息索引
```

#### 3.1.5 UI设计

```
┌─────────────────────────────────────────────────────────────────┐
│ 任务管理（跨会话）                    [+ 新建] [🔄 重新扫描]       │
├─────────────────────────────────────────────────────────────────┤
│ 来源: [全部会话 ▼] │ 筛选: [全部状态 ▼] │ 排序: [截止时间 ▼]     │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 🔴 完成用户模块开发                              [进行中]   │ │
│ │    责任人: 小明  │  截止: 2024-01-20                        │ │
│ │    来源: #产品讨论组 (3条消息)  │  参与者: 老王, 李经理      │ │
│ │    AI置信度: 95%  [✏️ 编辑] [↗️ 查看消息] [✓ 完成]         │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 🟡 准备周会材料                                  [待处理]   │ │
│ │    责任人: 设计师小张  │  截止: 2024-01-22                  │ │
│ │    来源: #工作群 (1条消息)                                   │ │
│ │    AI置信度: 88%  [✏️ 编辑] [↗️ 查看消息]                   │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ✅ 修复登录Bug                                   [已完成]   │ │
│ │    责任人: 老王  │  完成于: 2024-01-18                      │ │
│ │    来源: #技术群 (2条消息)                                   │ │
│ └─────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ 统计: 共 15 个任务  │  待处理 5  │  进行中 3  │  已完成 7        │
└─────────────────────────────────────────────────────────────────┘
```

---

### 3.2 Todo Tab（待办清单）

#### 3.2.1 功能描述

跨会话个人待办聚合视图：

- **跨会话聚合**：自动收集用户在所有会话中分配到的任务
- **身份自动识别**：基于昵称相似度自动匹配"我的任务"
- **个人备注**：支持添加个人备注、标签
- **待办创建**：支持手动创建个人待办（不关联聊天）

#### 3.2.2 数据模型（全局数据库）

```sql
-- 个人待办表（聚合视图）
CREATE TABLE IF NOT EXISTS personal_todo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_user_id TEXT NOT NULL,              -- 所属用户（"我"）

  -- 关联任务（可为空，表示手动创建）
  task_id INTEGER,                           -- 关联的全局任务ID
  task_title TEXT,                           -- 冗余任务标题

  -- 待办属性
  title TEXT NOT NULL,                       -- 待办标题
  description TEXT,                          -- 描述
  status TEXT DEFAULT 'pending',             -- 状态
  priority TEXT DEFAULT 'normal',            -- 优先级
  due_ts INTEGER,                            -- 截止时间
  reminder_ts INTEGER,                       -- 提醒时间

  -- 个人扩展
  notes TEXT,                                -- 个人备注
  tags TEXT DEFAULT '[]',                    -- 个人标签
  is_starred INTEGER DEFAULT 0,              -- 是否星标

  -- 时间戳
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL,
  completed_ts INTEGER,

  -- 来源
  source_type TEXT DEFAULT 'task',           -- task/manual
  source_session_id TEXT,                    -- 来源会话（如果是task类型）

  FOREIGN KEY(task_id) REFERENCES global_task(id) ON DELETE SET NULL,
  FOREIGN KEY(global_user_id) REFERENCES global_user(global_user_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_todo_user ON personal_todo(global_user_id);
CREATE INDEX IF NOT EXISTS idx_todo_status ON personal_todo(status, global_user_id);
CREATE INDEX IF NOT EXISTS idx_todo_due ON personal_todo(due_ts);
CREATE INDEX IF NOT EXISTS idx_todo_task ON personal_todo(task_id);
```

#### 3.2.3 待办同步机制

```typescript
// 任务提取后自动同步到个人待办
async function syncTaskToTodo(task: GlobalTask, sessionId: string) {
  // 1. 获取任务责任人和参与者的全局用户ID
  const ownerUserId = task.ownerGlobalUserId
  const participantUserIds = await getTaskParticipantUserIds(task.id)

  // 2. 为责任人创建待办
  if (ownerUserId && ownerUserId === getCurrentUserGlobalId()) {
    await createOrUpdateTodo({
      globalUserId: ownerUserId,
      taskId: task.id,
      taskTitle: task.title,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueTs: task.dueTs,
      sourceType: 'task',
      sourceSessionId: sessionId,
    })
  }

  // 3. 为参与者创建待办（标记为参与者角色）
  for (const userId of participantUserIds) {
    if (userId === getCurrentUserGlobalId() && userId !== ownerUserId) {
      await createOrUpdateTodo({
        globalUserId: userId,
        taskId: task.id,
        // ... 参与者待办属性
      })
    }
  }
}
```

---

### 3.3 Focus Tab（关注点管理）

#### 3.3.1 功能描述

跨会话关注事项管理：

- **自动识别**：AI分析用户频繁提及或参与讨论的话题
- **手动关注**：用户可主动标记关注的消息/话题
- **跨会话追踪**：聚合所有会话中的相关动态
- **进展汇总**：显示关注点的最新进展

#### 3.3.2 数据模型（全局数据库）

```sql
-- 关注点表
CREATE TABLE IF NOT EXISTS focus_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_user_id TEXT NOT NULL,              -- 关注者
  type TEXT NOT NULL,                        -- 类型: topic/person/task/project/keyword
  title TEXT NOT NULL,                       -- 关注点标题
  description TEXT,
  keywords TEXT DEFAULT '[]',                -- 关键词列表
  color TEXT,                                -- 标记颜色

  -- 统计
  mention_count INTEGER DEFAULT 0,           -- 提及次数
  related_session_count INTEGER DEFAULT 0,   -- 涉及会话数

  -- 状态
  status TEXT DEFAULT 'active',              -- active/archived
  last_activity_ts INTEGER,                  -- 最后活动时间
  last_summary TEXT,                         -- 最近摘要

  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL,

  FOREIGN KEY(global_user_id) REFERENCES global_user(global_user_id)
);

-- 关注点-消息关联（跨会话）
CREATE TABLE IF NOT EXISTS focus_message_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  focus_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  message_ts INTEGER NOT NULL,
  relevance REAL DEFAULT 1.0,                -- 相关度分数
  summary TEXT,                              -- 该消息与关注点的关系摘要
  FOREIGN KEY(focus_id) REFERENCES focus_item(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_focus_user ON focus_item(global_user_id);
CREATE INDEX IF NOT EXISTS idx_focus_type ON focus_item(type);
CREATE INDEX IF NOT EXISTS idx_focus_status ON focus_item(status);
CREATE INDEX IF NOT EXISTS idx_focus_link ON focus_message_link(focus_id);
CREATE INDEX IF NOT EXISTS idx_focus_link_session ON focus_message_link(session_id);
```

---

### 3.4 Knowledge Tab（知识库）

#### 3.4.1 功能描述

跨会话知识沉淀与问答：

- **FAQ自动生成**：从所有会话中提取问答对
- **知识分类**：自动分类 + 支持手动调整
- **知识问答**：通过LLM进行知识库问答
- **人工修正**：支持编辑、合并、删除知识条目

#### 3.4.2 数据模型（全局数据库）

```sql
-- 知识条目表
CREATE TABLE IF NOT EXISTS knowledge_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                        -- 类型: faq/document/concept/procedure/tip

  -- 内容
  title TEXT NOT NULL,                       -- 标题/问题
  content TEXT NOT NULL,                     -- 内容/答案
  summary TEXT,                              -- 摘要

  -- 分类
  category TEXT,                             -- 主分类
  tags TEXT DEFAULT '[]',                    -- 标签

  -- 来源（跨会话）
  source_session_ids TEXT DEFAULT '[]',      -- 来源会话ID列表
  source_message_refs TEXT DEFAULT '[]',     -- 来源消息引用 [{sessionId, messageId}]

  -- AI提取信息
  confidence REAL DEFAULT 1.0,               -- 提取置信度
  is_edited INTEGER DEFAULT 0,               -- 是否被人工修改
  edit_history TEXT DEFAULT '[]',            -- 编辑历史

  -- 统计
  view_count INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,

  -- 状态
  status TEXT DEFAULT 'active',              -- active/archived/deleted

  -- 时间
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL,

  -- 版本控制
  version INTEGER DEFAULT 1,
  parent_id INTEGER,                         -- 父版本（用于版本追溯）

  FOREIGN KEY(parent_id) REFERENCES knowledge_item(id)
);

-- 知识向量索引（用于语义检索）
CREATE TABLE IF NOT EXISTS knowledge_vector (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_id INTEGER NOT NULL,
  embedding BLOB,                            -- 向量数据
  model TEXT,                                -- embedding模型
  chunk_index INTEGER DEFAULT 0,             -- 分块索引（长内容分块）
  FOREIGN KEY(knowledge_id) REFERENCES knowledge_item(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_item(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_item(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_item(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_vector ON knowledge_vector(knowledge_id);
```

#### 3.4.3 FAQ自动生成流程

```typescript
async function generateFAQFromSessions(sessionIds: string[]) {
  const allFAQs: FAQItem[] = []

  for (const sessionId of sessionIds) {
    // 1. 检测问答模式消息对
    const qaPatterns = await detectQAPatterns(sessionId)

    // 2. LLM提炼FAQ
    const faqs = await llmExtractFAQ(qaPatterns)

    // 3. 去重与合并
    for (const faq of faqs) {
      const existing = await findSimilarFAQ(faq.question)
      if (existing && existing.similarity > 0.85) {
        // 合并到已有FAQ
        await mergeFAQ(existing.id, faq, sessionId)
      } else {
        // 创建新FAQ
        allFAQs.push({
          ...faq,
          sourceSessionIds: [sessionId],
        })
      }
    }
  }

  // 4. 向量化存储
  for (const faq of allFAQs) {
    const embedding = await embedText(faq.question + ' ' + faq.answer)
    await saveKnowledgeItem({
      type: 'faq',
      title: faq.question,
      content: faq.answer,
      sourceSessionIds: faq.sourceSessionIds,
      embedding,
    })
  }
}

// QA模式检测：识别问答对话
async function detectQAPatterns(sessionId: string): Promise<QAPair[]> {
  // 检测模式：
  // 1. A提问 → B回答（时间间隔<5分钟）
  // 2. 包含"？"的消息后跟回复
  // 3. "@某人"后跟回复
}
```

#### 3.4.4 知识人工修正

```typescript
interface KnowledgeEdit {
  knowledgeId: number
  field: 'title' | 'content' | 'category' | 'tags'
  oldValue: string
  newValue: string
  reason?: string
}

async function applyKnowledgeEdit(edit: KnowledgeEdit) {
  // 1. 记录编辑历史
  await recordEditHistory(edit)

  // 2. 更新知识条目
  await updateKnowledgeItem(edit.knowledgeId, {
    [edit.field]: edit.newValue,
    is_edited: 1,
    updated_ts: Date.now(),
  })

  // 3. 如果内容变更，更新向量
  if (edit.field === 'title' || edit.field === 'content') {
    const item = await getKnowledgeItem(edit.knowledgeId)
    const newEmbedding = await embedText(item.title + ' ' + item.content)
    await updateKnowledgeVector(edit.knowledgeId, newEmbedding)
  }
}
```

---

### 3.5 Knowledge Graph Tab（知识图谱）

#### 3.5.1 功能描述

跨会话知识图谱可视化与探索：

- **跨会话构建**：聚合所有聊天群中的实体和关系
- **双层Schema**：固定核心实体 + LLM动态扩展实体
- **时间过滤**：拖动时间轴过滤关联实体
- **交互探索**：点击节点展开关联、路径查询
- **可视化导出**：支持导出图谱数据

#### 3.5.2 双层Schema架构

**设计原则**：固定核心Schema保证结构化和可查询性，LLM动态Schema允许灵活扩展。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Schema 分层架构                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              固定核心层 (Fixed Core Schema)                 │ │
│  │  - 强约束，保证结构化查询                                   │ │
│  │  - Person, Task, Event, Time, Location, Artifact           │ │
│  │  - DEPENDS_ON, BLOCKS, PART_OF, MENTIONS, ASSIGNED_TO...   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              动态扩展层 (Dynamic Schema)                    │ │
│  │  - LLM自动提取，无需预定义                                  │ │
│  │  - Concept, System, Module, API, Bug, Feature...           │ │
│  │  - 任意关系类型（由LLM命名）                                │ │
│  │  - 填充固定Schema无法覆盖的信息                             │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**固定核心实体类型**:

| 实体类型   | 描述                         | 必填属性             |
| ---------- | ---------------------------- | -------------------- |
| `Person`   | 人员（发言者、被提及者）     | name, role?          |
| `Task`     | 任务/待办                    | title, status?       |
| `Event`    | 事件（会议、上线、故障）     | name, event_type?    |
| `Time`     | 时间节点（截止日期、里程碑） | label, timestamp?    |
| `Location` | 地点/环境（服务器、模块）    | name, type?          |
| `Artifact` | 制品（文档、代码、配置）     | name, artifact_type? |

**固定核心关系类型**:

| 关系类型       | 源→目标                | 描述     |
| -------------- | ---------------------- | -------- |
| `ASSIGNED_TO`  | Task → Person          | 任务分配 |
| `PARTICIPATES` | Person → Task/Event    | 参与     |
| `DEPENDS_ON`   | Task → Task            | 依赖     |
| `BLOCKS`       | Task/Event → Task      | 阻塞     |
| `PART_OF`      | _ → _                  | 从属关系 |
| `MENTIONS`     | Person/Task → \*       | 提及     |
| `CREATED_BY`   | Task/Artifact → Person | 创建者   |
| `LOCATED_AT`   | \* → Location          | 位于     |
| `SCHEDULED_AT` | Task/Event → Time      | 计划时间 |
| `RELATED_TO`   | _ → _                  | 通用关联 |

**动态扩展实体示例**（由LLM根据上下文自动生成）:

```json
{
  "dynamic_entities": [
    { "type": "Concept", "name": "微服务架构", "properties": { "domain": "tech" } },
    { "type": "System", "name": "支付系统", "properties": { "env": "production" } },
    { "type": "Module", "name": "用户模块", "properties": { "language": "TypeScript" } },
    { "type": "API", "name": "/api/users", "properties": { "method": "GET" } },
    { "type": "Bug", "name": "登录超时问题", "properties": { "severity": "high" } },
    { "type": "Feature", "name": "暗黑模式", "properties": { "status": "planning" } }
  ],
  "dynamic_relations": [
    { "type": "CALLS", "source": "用户模块", "target": "支付系统" },
    { "type": "FIXES", "source": "修复登录Bug", "target": "登录超时问题" },
    { "type": "IMPLEMENTS", "source": "小明", "target": "暗黑模式" }
  ]
}
```

#### 3.5.3 数据模型（全局数据库）

```sql
-- 图节点表
CREATE TABLE IF NOT EXISTS graph_node (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 实体类型（固定或动态）
  type TEXT NOT NULL,                       -- 实体类型
  is_core_type INTEGER DEFAULT 1,           -- 是否核心类型 (1=固定, 0=动态扩展)

  -- 实体信息
  name TEXT NOT NULL,                       -- 实体名称
  display_name TEXT,                        -- 显示名称（可选）
  properties TEXT DEFAULT '{}',             -- 属性JSON

  -- 时间范围
  first_seen_ts INTEGER NOT NULL,           -- 首次出现时间
  last_seen_ts INTEGER NOT NULL,            -- 最后出现时间

  -- 统计
  occurrence_count INTEGER DEFAULT 1,       -- 出现次数

  -- 来源（跨会话）
  source_sessions TEXT DEFAULT '[]',        -- 来源会话ID列表
  source_message_refs TEXT DEFAULT '[]',    -- 来源消息引用

  -- AI信息
  confidence REAL DEFAULT 1.0,

  -- 可视化属性
  color TEXT,                               -- 节点颜色
  icon TEXT,                                -- 节点图标

  UNIQUE(type, name)                        -- 实体唯一约束
);

-- 图边表（关系）
CREATE TABLE IF NOT EXISTS graph_edge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 关系类型
  type TEXT NOT NULL,                       -- 关系类型
  is_core_type INTEGER DEFAULT 1,           -- 是否核心类型

  -- 节点
  source_node_id INTEGER NOT NULL,
  target_node_id INTEGER NOT NULL,

  -- 关系属性
  properties TEXT DEFAULT '{}',

  -- 时间范围
  first_seen_ts INTEGER NOT NULL,
  last_seen_ts INTEGER NOT NULL,

  -- 统计
  occurrence_count INTEGER DEFAULT 1,

  -- 来源
  source_sessions TEXT DEFAULT '[]',
  source_message_refs TEXT DEFAULT '[]',

  confidence REAL DEFAULT 1.0,

  FOREIGN KEY(source_node_id) REFERENCES graph_node(id) ON DELETE CASCADE,
  FOREIGN KEY(target_node_id) REFERENCES graph_node(id) ON DELETE CASCADE,
  UNIQUE(source_node_id, target_node_id, type)
);

-- 节点类型统计视图
CREATE VIEW IF NOT EXISTS v_node_type_stats AS
SELECT
  type,
  is_core_type,
  COUNT(*) as count,
  MIN(first_seen_ts) as earliest_ts,
  MAX(last_seen_ts) as latest_ts
FROM graph_node
GROUP BY type, is_core_type
ORDER BY count DESC;

-- 索引
CREATE INDEX IF NOT EXISTS idx_node_type ON graph_node(type);
CREATE INDEX IF NOT EXISTS idx_node_time ON graph_node(first_seen_ts, last_seen_ts);
CREATE INDEX IF NOT EXISTS idx_node_core ON graph_node(is_core_type);
CREATE INDEX IF NOT EXISTS idx_edge_source ON graph_edge(source_node_id);
CREATE INDEX IF NOT EXISTS idx_edge_target ON graph_edge(target_node_id);
CREATE INDEX IF NOT EXISTS idx_edge_type ON graph_edge(type);
CREATE INDEX IF NOT EXISTS idx_edge_time ON graph_edge(first_seen_ts, last_seen_ts);
```

#### 3.5.4 LLM提取Prompt（双层Schema）

```
你是一个知识图谱构建专家。请分析以下聊天消息，提取实体和关系。

消息列表:
{messages}

时间范围: {time_range}

## 固定核心Schema（必须优先使用）

### 实体类型:
- Person: 人员，包括发言者和被提及的人
- Task: 明确的任务或待办事项
- Event: 事件，如会议、上线、故障、里程碑
- Time: 时间节点，如截止日期、计划时间
- Location: 地点或环境，如服务器、模块名、云环境
- Artifact: 制品，如文档、代码文件、配置文件

### 关系类型:
- ASSIGNED_TO: 任务分配给人员
- PARTICIPATES: 人员参与任务/事件
- DEPENDS_ON: 依赖关系
- BLOCKS: 阻塞关系
- PART_OF: 从属关系
- MENTIONS: 提及关系
- CREATED_BY: 创建者
- LOCATED_AT: 位于某地点/环境
- SCHEDULED_AT: 计划在某时间
- RELATED_TO: 通用关联

## 动态扩展Schema（当固定Schema无法表达时使用）

当遇到无法用核心Schema表达的实体/关系时，可以创建新类型：
- 新实体类型示例: Concept（概念）, System（系统）, Module（模块）, API, Bug, Feature
- 新关系类型示例: CALLS, FIXES, IMPLEMENTS, USES, CONTAINS

## 输出格式

返回JSON:
{
  "entities": [
    {
      "type": "Person",           // 优先使用核心类型
      "name": "小明",
      "display_name": "小明",
      "properties": { "role": "developer" },
      "message_indices": [0, 2, 5],
      "confidence": 0.95
    },
    {
      "type": "System",           // 动态扩展类型
      "name": "支付系统",
      "properties": { "env": "production" },
      "message_indices": [3],
      "confidence": 0.85,
      "is_dynamic": true
    }
  ],
  "relations": [
    {
      "source": "完成用户模块开发",   // 实体name
      "target": "小明",
      "type": "ASSIGNED_TO",       // 核心关系
      "message_indices": [2],
      "confidence": 0.9
    },
    {
      "source": "用户模块",
      "target": "支付系统",
      "type": "CALLS",             // 动态扩展关系
      "message_indices": [3],
      "confidence": 0.8,
      "is_dynamic": true
    }
  ]
}

## 提取规则:
1. 优先使用核心Schema，只有无法表达时才创建动态类型
2. 实体name应简洁明确，避免歧义
3. Task实体应与任务提取模块的结果一致
4. Person实体应使用一致的名称（便于跨会话聚合）
5. 动态类型应有明确的语义，避免过于泛化
```

#### 3.5.5 时间过滤查询

```sql
-- 查询指定时间范围内的活跃节点
SELECT n.*
FROM graph_node n
WHERE n.first_seen_ts <= :end_ts
  AND n.last_seen_ts >= :start_ts
ORDER BY n.occurrence_count DESC;

-- 查询指定时间范围内的活跃关系
SELECT e.*,
       sn.name as source_name,
       tn.name as target_name
FROM graph_edge e
JOIN graph_node sn ON e.source_node_id = sn.id
JOIN graph_node tn ON e.target_node_id = tn.id
WHERE e.first_seen_ts <= :end_ts
  AND e.last_seen_ts >= :start_ts
ORDER BY e.occurrence_count DESC;

-- 时间范围内的子图查询（用于可视化）
WITH active_nodes AS (
  SELECT id, type, name, properties, color, icon
  FROM graph_node
  WHERE first_seen_ts <= :end_ts AND last_seen_ts >= :start_ts
)
SELECT
  n.id, n.type, n.name, n.properties, n.color, n.icon,
  GROUP_CONCAT(e.target_node_id) as connected_to
FROM active_nodes n
LEFT JOIN graph_edge e ON n.id = e.source_node_id
  AND e.first_seen_ts <= :end_ts AND e.last_seen_ts >= :start_ts
GROUP BY n.id;
```

#### 3.5.6 UI设计

```
┌─────────────────────────────────────────────────────────────────┐
│ 知识图谱（跨会话）                   [全屏] [导出] [重新构建]     │
├─────────────────────────────────────────────────────────────────┤
│ 时间范围: [2024-01-01] ═══════●══════════════●════ [2024-01-31] │
│           └────────── 拖动调整时间窗口 ──────────┘               │
├─────────────────────────────────────────────────────────────────┤
│ 类型过滤: [☑ Person] [☑ Task] [☑ Event] [☐ Concept] [更多...]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                        ┌─────────┐                              │
│                        │ 小明    │  👤 Person                   │
│                        │(核心成员)│                              │
│                        └────┬────┘                              │
│              ┌──────────────┼──────────────┐                    │
│              │              │              │                    │
│         ┌────▼────┐   ┌────▼────┐   ┌────▼────┐                │
│         │ 用户模块 │   │微服务架构│   │ API文档 │                │
│         │ (Module)│   │(Concept)│   │(Artifact)│               │
│         │  动态   │   │  动态   │   │  核心   │                │
│         └────┬────┘   └─────────┘   └─────────┘                │
│              │ CALLS                                         │
│         ┌────▼────┐                                          │
│         │支付系统  │                                          │
│         │(System) │ ──MENTIONS──▶ [更多...]                   │
│         │  动态   │                                          │
│         └─────────┘                                          │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ 图例: 👤 Person  📋 Task  📅 Event  📍 Location  📄 Artifact    │
│      ⬡ 动态实体（LLM扩展）                                      │
│      ── ASSIGNED_TO  ── DEPENDS_ON  ── CALLS（动态）            │
├─────────────────────────────────────────────────────────────────┤
│ 统计: 节点 156  │ 边 234  │ 会话覆盖 5  │ 时间跨度 30天          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、架构设计

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         渲染进程 (Vue 3)                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │Task Tab │ │Todo Tab │ │Focus Tab│ │Know Tab │ │Graph Tab│   │
│  │(跨会话) │ │(跨会话) │ │(跨会话) │ │(跨会话) │ │(跨会话) │   │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘   │
│       │           │           │           │           │         │
│       └───────────┴───────────┴───────────┴───────────┘         │
│                               │                                  │
│                    ┌──────────▼──────────┐                      │
│                    │   Pinia Store       │                      │
│                    │   - taskStore       │                      │
│                    │   - todoStore       │                      │
│                    │   - knowledgeStore  │                      │
│                    │   - graphStore      │                      │
│                    │   - identityStore   │                      │
│                    └──────────┬──────────┘                      │
└───────────────────────────────┼─────────────────────────────────┘
                                │ IPC
┌───────────────────────────────┼─────────────────────────────────┐
│                         主进程 (Electron)                        │
│                       ┌────────▼──────────┐                      │
│                       │   IPC Handlers    │                      │
│                       │   - task:*        │                      │
│                       │   - todo:*        │                      │
│                       │   - knowledge:*   │                      │
│                       │   - graph:*       │                      │
│                       │   - identity:*    │                      │
│                       └────────┬──────────┘                      │
├────────────────────────────────┼─────────────────────────────────┤
│  ┌──────────────┐ ┌────────────▼──────────┐ ┌──────────────┐    │
│  │   Worker     │ │    AI Agent Engine    │ │   RAG        │    │
│  │   (会话查询) │ │    (LLM + Tools)      │ │   (向量检索)  │    │
│  └──────┬───────┘ └────────────┬──────────┘ └──────┬───────┘    │
│         │                      │                    │            │
│         └──────────────────────┼────────────────────┘            │
│                       ┌────────▼──────────┐                      │
│                       │   数据持久层       │                      │
│                       ├───────────────────┤                      │
│                       │ 会话数据库(多个)   │                      │
│                       │ - message          │                      │
│                       │ - member           │                      │
│                       │ - chat_session     │                      │
│                       ├───────────────────┤                      │
│                       │ 全局数据库(1个)    │                      │
│                       │ - global_task      │                      │
│                       │ - personal_todo    │                      │
│                       │ - knowledge_item   │                      │
│                       │ - graph_node/edge  │                      │
│                       │ - global_user      │                      │
│                       └───────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 数据库架构

```
~/.chatlab/data/
├── databases/                    # 会话级数据库（现有）
│   ├── chat_*.db                    # 各聊天群的原始数据
│   │   ├── message
│   │   ├── member
│   │   ├── chat_session
│   │   └── message_context
│   └── ...
│
└── global/                       # 全局数据库（新增）
    ├── collaboration.db             # 任务/待办/关注/知识
    │   ├── global_task
    │   ├── task_source
    │   ├── task_participant
    │   ├── personal_todo
    │   ├── focus_item
    │   ├── focus_message_link
    │   └── knowledge_item
    │
    ├── knowledge_graph.db           # 知识图谱
    │   ├── graph_node
    │   └── graph_edge
    │
    └── identity.db                  # 用户身份
        ├── global_user
        └── user_identity_mapping
```

### 4.3 新增IPC接口

```typescript
// ==================== 用户身份 ====================
'identity:getCurrentUser' // 获取当前用户全局身份
'identity:matchUser' // 匹配用户身份（昵称相似度）
'identity:confirmMatch' // 确认身份匹配
'identity:getPendingMatches' // 获取待确认的身份匹配

// ==================== Task ====================
'task:getAll' // 获取所有任务（跨会话）
'task:getBySession' // 获取指定会话的任务
'task:getById' // 获取单个任务
'task:create' // 创建任务
'task:update' // 更新任务
'task:delete' // 删除任务
'task:extractFromSession' // 从会话提取任务（导入时调用）
'task:extractFromAll' // 从所有会话提取任务
'task:mergeTasks' // 合并重复任务

// ==================== Todo ====================
'todo:getMyTodos' // 获取"我"的待办
'todo:create' // 创建待办
'todo:update' // 更新待办
'todo:delete' // 删除待办
'todo:syncFromTasks' // 从任务同步待办

// ==================== Knowledge ====================
'knowledge:getAll' // 获取知识列表
'knowledge:getByType' // 按类型获取
'knowledge:search' // 搜索知识
'knowledge:semanticSearch' // 语义搜索
'knowledge:generateFAQ' // 生成FAQ
'knowledge:query' // 知识问答
'knowledge:update' // 更新知识
'knowledge:merge' // 合并知识

// ==================== Graph ====================
'graph:getNodes' // 获取节点
'graph:getEdges' // 获取边
'graph:getSubgraph' // 获取子图（时间范围）
'graph:extractFromSession' // 从会话提取图谱
'graph:extractFromAll' // 从所有会话提取图谱
'graph:queryPath' // 查询路径
'graph:getStats' // 获取图谱统计
'graph:export' // 导出图谱
```

### 4.4 新增AI工具

```typescript
// tools/definitions/extract-tasks.ts
export function createExtractTasksTool(context: ToolContext): AgentTool

// tools/definitions/extract-entities.ts
export function createExtractEntitiesTool(context: ToolContext): AgentTool

// tools/definitions/extract-relations.ts
export function createExtractRelationsTool(context: ToolContext): AgentTool

// tools/definitions/generate-faq.ts
export function createGenerateFAQTool(context: ToolContext): AgentTool

// tools/definitions/query-knowledge.ts
export function createQueryKnowledgeTool(context: ToolContext): AgentTool

// tools/definitions/match-identity.ts
export function createMatchIdentityTool(context: ToolContext): AgentTool
```

### 4.5 导入流程改造

```typescript
// 在现有导入流程中添加AI提取钩子
async function streamImportWithExtraction(filePath: string, requestId: string): Promise<StreamImportResult> {
  // 1. 执行原有导入逻辑
  const result = await streamImport(filePath, requestId)

  if (!result.success) {
    return result
  }

  // 2. 获取会话信息
  const session = await getSession(result.sessionId)

  // 3. 异步执行AI提取（不阻塞导入完成）
  setImmediate(async () => {
    try {
      // 3.1 提取任务
      const tasks = await extractTasksFromSession(result.sessionId)
      await saveTasksToGlobalDB(result.sessionId, tasks)

      // 3.2 提取知识图谱
      const graphData = await extractGraphFromSession(result.sessionId)
      await saveGraphToGlobalDB(result.sessionId, graphData)

      // 3.3 生成FAQ（可选，批量时执行）
      // faqs = await generateFAQFromSession(result.sessionId)

      // 3.4 更新用户身份映射
      await updateIdentityMappings(result.sessionId)

      console.log(`[Extraction] Completed for session ${result.sessionId}`)
    } catch (error) {
      console.error('[Extraction] Error:', error)
    }
  })

  return result
}
```

---

## 五、实现计划

### 5.1 分阶段迭代

| 阶段        | 功能          | 关键任务                         | 预估工作量 |
| ----------- | ------------- | -------------------------------- | ---------- |
| **Phase 0** | 基础设施      | 全局数据库架构、用户身份识别服务 | 2-3人日    |
| **Phase 1** | Task Tab      | 数据模型、导入提取、UI           | 4-5人日    |
| **Phase 2** | Todo Tab      | 待办聚合、身份匹配               | 2-3人日    |
| **Phase 3** | Knowledge Tab | FAQ生成、知识问答                | 3-4人日    |
| **Phase 4** | Focus Tab     | 关注点管理                       | 2人日      |
| **Phase 5** | Graph Tab     | 双层Schema、可视化、时间过滤     | 5-7人日    |
| **Phase 6** | 集成优化      | 性能优化、测试、文档             | 3人日      |

### 5.2 技术风险与缓解

| 风险                    | 影响               | 缓解措施                                       |
| ----------------------- | ------------------ | ---------------------------------------------- |
| 用户身份匹配准确率不足  | 任务/待办归属错误  | 1. 提供手动修正入口<br>2. 低置信度时提示确认   |
| LLM提取任务准确率不稳定 | 任务遗漏或错误提取 | 1. 提供手动增删改功能<br>2. 支持重新扫描       |
| 跨会话查询性能          | 大量会话时查询慢   | 1. 建立全局索引<br>2. 实现分页加载             |
| 知识图谱节点过多        | 可视化性能问题     | 1. 实现聚合显示<br>2. WebGL渲染<br>3. 增量加载 |
| 向量检索延迟            | 知识问答响应慢     | 1. 预计算索引<br>2. 缓存常用embedding          |

### 5.3 依赖条件

| 依赖项   | 说明                 | 状态         |
| -------- | -------------------- | ------------ |
| LLM配置  | 需要配置大模型API    | 用户自行配置 |
| RAG模块  | 复用现有向量检索能力 | 已实现       |
| 导入功能 | 基于现有导入流程扩展 | 已实现       |

---

## 六、附录

### A. 文件路径规划

```
src/
├── pages/
│   ├── group-chat/
│   │   ├── index.vue                 # 添加新Tab定义
│   │   └── components/
│   │       ├── TaskTab.vue           # 新增：任务管理
│   │       ├── TodoTab.vue           # 新增：待办清单
│   │       ├── FocusTab.vue          # 新增：关注点
│   │       ├── KnowledgeTab.vue      # 新增：知识库
│   │       └── GraphTab.vue          # 新增：知识图谱
│   └── private-chat/
│       └── ...                       # 同步添加
│
├── stores/
│   ├── task.ts                       # 新增：任务状态
│   ├── todo.ts                       # 新增：待办状态
│   ├── knowledge.ts                  # 新增：知识状态
│   ├── graph.ts                      # 新增：图谱状态
│   └── identity.ts                   # 新增：身份状态
│
└── components/
    └── analysis/
        ├── TaskCard.vue              # 新增：任务卡片
        ├── KnowledgeEditor.vue       # 新增：知识编辑器
        └── GraphCanvas.vue           # 新增：图谱画布

electron/main/
├── database/
│   ├── migrations.ts                 # 修改：添加全局表迁移
│   ├── global/                       # 新增：全局数据库模块
│   │   ├── task.ts
│   │   ├── todo.ts
│   │   ├── knowledge.ts
│   │   ├── graph.ts
│   │   └── identity.ts
│   └── global.ts                     # 新增：全局数据库管理
│
├── ipc/
│   ├── task.ts                       # 新增
│   ├── todo.ts                       # 新增
│   ├── knowledge.ts                  # 新增
│   ├── graph.ts                      # 新增
│   └── identity.ts                   # 新增
│
├── worker/
│   ├── extraction/                   # 新增：AI提取Worker
│   │   ├── taskExtractor.ts
│   │   ├── graphExtractor.ts
│   │   └── faqGenerator.ts
│   └── query/
│       ├── task.ts                   # 新增
│       ├── knowledge.ts              # 新增
│       └── graph.ts                  # 新增
│
├── ai/
│   └── tools/
│       └── definitions/
│           ├── extract-tasks.ts      # 新增
│           ├── extract-entities.ts   # 新增
│           ├── extract-relations.ts  # 新增
│           ├── generate-faq.ts       # 新增
│           └── match-identity.ts     # 新增
│
└── paths.ts                          # 修改：添加全局数据库路径
```

### B. 国际化Key设计

```json
{
  "analysis.tabs.task": "任务",
  "analysis.tabs.todo": "待办",
  "analysis.tabs.focus": "关注",
  "analysis.tabs.knowledge": "知识库",
  "analysis.tabs.graph": "图谱",

  "task.status.pending": "待处理",
  "task.status.in_progress": "进行中",
  "task.status.completed": "已完成",
  "task.status.cancelled": "已取消",

  "task.priority.low": "低",
  "task.priority.normal": "普通",
  "task.priority.high": "高",
  "task.priority.urgent": "紧急",

  "task.source.multiSession": "来自 {count} 个会话",
  "task.confidence.high": "高置信度",
  "task.confidence.medium": "中等置信度",
  "task.confidence.low": "低置信度",

  "identity.match.exact": "精确匹配",
  "identity.match.fuzzy": "相似匹配",
  "identity.match.pending": "待确认",

  "graph.filter.timeRange": "时间范围",
  "graph.filter.entityType": "实体类型",
  "graph.stats.nodes": "节点",
  "graph.stats.edges": "边",
  "graph.stats.sessions": "会话覆盖",

  "knowledge.type.faq": "FAQ",
  "knowledge.type.document": "文档",
  "knowledge.type.concept": "概念",
  "knowledge.type.procedure": "流程",

  "extraction.running": "正在提取...",
  "extraction.completed": "提取完成",
  "extraction.failed": "提取失败"
}
```

### C. 配置项设计

```typescript
// 用户配置（存储在 settings/ai-config.json）
interface ExtractionConfig {
  // 是否在导入时自动提取
  autoExtractOnImport: boolean

  // 任务提取配置
  taskExtraction: {
    enabled: boolean
    minConfidence: number // 最低置信度阈值 (0-1)
    batchSize: number // 批量处理消息数
  }

  // 知识图谱配置
  graphExtraction: {
    enabled: boolean
    includeDynamicTypes: boolean // 是否包含动态扩展类型
    minConfidence: number
  }

  // FAQ生成配置
  faqGeneration: {
    enabled: boolean
    minQAConfidence: number
    mergeSimilarThreshold: number // 合并相似FAQ的阈值
  }

  // 身份识别配置
  identityMatching: {
    autoMatchThreshold: number // 自动匹配阈值 (>=此值自动关联)
    promptMatchThreshold: number // 提示确认阈值 (>=此值提示用户)
  }
}
```

---

## 七、后续扩展方向

### 7.1 实时同步支持

当未来支持聊天实时同步时：

```typescript
// 实时同步时的增量提取
async function onRealtimeSync(sessionId: string, newMessages: Message[]) {
  // 1. 增量提取任务
  const newTasks = await extractTasksFromMessages(newMessages)
  await mergeNewTasks(sessionId, newTasks)

  // 2. 更新知识图谱
  const newGraphData = await extractGraphFromMessages(newMessages)
  await mergeGraphData(sessionId, newGraphData)

  // 3. 检测任务状态变化
  await detectTaskStatusChanges(sessionId, newMessages)
}
```

### 7.2 多人协作

- 支持在群内共享任务看板
- 任务分配通知
- 关注点动态推送

### 7.3 外部集成

- 导出任务到Todo应用
- 日历同步（截止日期）
- 导出知识图谱为标准格式（GraphML、RDF）

---

**文档结束** | v1.1 | 已确认设计决策
