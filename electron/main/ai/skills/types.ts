/**
 * 技能系统类型定义
 * 技能 = 可复用的分析工作流（Markdown + YAML Frontmatter 格式）
 */

/**
 * 技能完整配置（运行时）
 * 由 Markdown 文件解析而来：YAML frontmatter → 元数据字段，Markdown body → prompt 字段
 */
export interface SkillDef {
  /** 技能唯一标识（来自 frontmatter.id 或文件名） */
  id: string
  /** 技能显示名称 */
  name: string
  /** 简短描述 + 快捷用语，同时用于 AI 自选时的菜单展示 */
  description: string
  /** 关键词标签（来自 frontmatter.tags，逗号分隔解析为数组） */
  tags: string[]
  /** 适用的聊天类型 */
  chatScope: 'all' | 'group' | 'private'

  /**
   * 技能提示词（来自 Markdown body）
   * 包含目标描述、步骤编排、输出格式等完整指导。
   * 手动选择时注入 System Prompt；AI 自选时通过 activate_skill 工具按需加载。
   */
  prompt: string

  /**
   * 该技能依赖的工具名称列表
   * - 运行时校验：tools ⊆ assistant.allowedBuiltinTools
   * - 不满足时前端灰显该技能
   * - 空数组 = 无工具依赖
   */
  tools: string[]

  /** 内置技能来源标识（用户导入后由 SkillManager 自动设置） */
  builtinId?: string
}

/**
 * 传递给前端的技能摘要（不含完整 prompt）
 */
export interface SkillSummary {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  tools: string[]
  builtinId?: string
}

/**
 * 技能市场中的内置技能信息（模板目录项）
 */
export interface BuiltinSkillInfo extends SkillSummary {
  /** 用户是否已导入该技能 */
  imported: boolean
  /** 内置版本有更新（基于内容 hash 比对） */
  hasUpdate: boolean
}

/**
 * SkillManager 初始化结果
 */
export interface SkillInitResult {
  /** 加载的技能总数 */
  total: number
}

/**
 * 技能操作结果
 */
export interface SkillSaveResult {
  success: boolean
  error?: string
}
