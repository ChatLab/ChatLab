/**
 * 助手系统类型定义
 * 定义助手配置（Markdown 格式）和声明式 SQL 工具等核心类型
 */

// ==================== 助手配置 ====================

/**
 * 助手配置（Markdown 文件解析后的完整结构）
 *
 * 每个助手对应一个 .md 文件（YAML frontmatter + Markdown body）。
 * - 内置助手模板打包在 electron/main/ai/assistant/builtins/*.md
 * - 用户助手存储在 {userData}/data/ai/assistants/*.md
 * - YAML frontmatter → 结构化元数据字段
 * - Markdown body → systemPrompt
 */
export interface AssistantConfig {
  /** 助手唯一标识 */
  id: string
  /** 助手显示名称 */
  name: string

  /** 系统提示词（角色定义 + 回答要求，来自 Markdown body） */
  systemPrompt: string

  /** 预设问题列表（前端展示，用户可点击直接发送） */
  presetQuestions: string[]

  /**
   * 允许使用的内置工具名称白名单
   * - undefined / 空数组 = 全部内置工具可用
   * - 非空数组 = 仅列出的工具可用
   */
  allowedBuiltinTools?: string[]

  /**
   * 内置助手来源标识
   * 非空 = 该配置由某个内置助手导入而来（值为内置助手的 id）
   */
  builtinId?: string

  /**
   * 适用的聊天类型
   * - undefined / [] = 通用（群聊+私聊均适用）
   * - ['group'] = 仅群聊
   * - ['private'] = 仅私聊
   */
  applicableChatTypes?: ('group' | 'private')[]

  /**
   * 适用的语言/地区（前缀匹配，如 'zh' 匹配 'zh-CN'、'zh-TW'）
   * - undefined / [] = 全语言通用
   * - ['zh'] = 仅中文用户
   * - ['en'] = 仅英文用户
   */
  supportedLocales?: string[]
}

/**
 * 传递给前端的助手摘要信息
 */
export interface AssistantSummary {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  builtinId?: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

/**
 * 助手市场中的内置助手信息（模板目录项）
 */
export interface BuiltinAssistantInfo {
  id: string
  name: string
  systemPrompt: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
  /** 用户是否已导入该助手 */
  imported: boolean
}

// ==================== 声明式 SQL 工具 ====================

/**
 * 声明式 SQL 工具定义
 *
 * 每个定义在 LLM 眼中是一个 Function Calling 工具，
 * 执行时通过参数化 SQL 查询数据库，将结果格式化为文本返回给 LLM。
 */
export interface CustomSqlToolDef {
  /** 工具名称（作为 Function Calling 的 tool name） */
  name: string
  /** 工具描述（作为 Function Calling 的 tool description） */
  description: string
  /**
   * 参数定义（标准 JSON Schema 格式）
   *
   * 示例：
   * ```json
   * {
   *   "type": "object",
   *   "properties": {
   *     "days": { "type": "number", "description": "查询天数" }
   *   },
   *   "required": ["days"]
   * }
   * ```
   *
   * 运行时会通过 jsonSchemaToTypeBox() 转换为 TypeBox 格式，
   * 以满足 pi-agent-core AgentTool 的类型约束。
   */
  parameters: JsonSchemaObject

  /** 执行配置 */
  execution: SqlToolExecution
}

/**
 * JSON Schema 对象类型（简化版，覆盖技能参数定义的常见场景）
 */
export interface JsonSchemaObject {
  type: 'object'
  properties: Record<string, JsonSchemaProperty>
  required?: string[]
}

/**
 * JSON Schema 属性定义
 */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean'
  description?: string
  default?: unknown
  enum?: unknown[]
}

/**
 * SQL 工具执行配置
 */
export interface SqlToolExecution {
  /** 执行类型（目前仅支持 sqlite） */
  type: 'sqlite'
  /**
   * 参数化 SQL 查询语句
   * - 使用命名参数 @paramName（对应 parameters 中的属性名）
   * - 必须是只读查询（better-sqlite3 的 stmt.readonly 会强制检查）
   *
   * 示例：
   * ```sql
   * SELECT sender_name, COUNT(*) as msg_count
   * FROM message
   * WHERE ts > unixepoch('now', '-' || @days || ' days')
   * GROUP BY sender_name
   * ORDER BY msg_count DESC
   * LIMIT 10
   * ```
   */
  query: string
  /**
   * 行格式化模板，使用 {columnName} 占位符
   * 示例：'用户【{sender_name}】共发言 {msg_count} 次'
   */
  rowTemplate: string
  /** 可选的汇总模板，在所有行之前输出（支持 {rowCount} 占位符） */
  summaryTemplate?: string
  /** 查询结果为空时返回的文本 */
  fallback: string
}

// ==================== 助手管理器相关 ====================

/**
 * AssistantManager 初始化结果
 */
export interface AssistantInitResult {
  /** 加载的助手总数 */
  total: number
  /** general 助手是否为首次自动导入 */
  generalCreated: boolean
}

/**
 * 助手配置的保存/更新结果
 */
export interface AssistantSaveResult {
  success: boolean
  error?: string
}

