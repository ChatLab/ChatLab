/**
 * 内置工具目录查询
 *
 * 基于 TOOL_REGISTRY 提供前端展示所需的工具目录（含分类信息）。
 */

import { TOOL_REGISTRY } from '../tools/definitions'
import type { ToolCategory } from '../tools/types'

export interface BuiltinToolCatalogEntry {
  name: string
  category: ToolCategory
}

/**
 * 获取所有内置工具的目录（含分类），供前端展示
 */
export function getBuiltinToolCatalog(): BuiltinToolCatalogEntry[] {
  return TOOL_REGISTRY.map((e) => ({ name: e.name, category: e.category }))
}
