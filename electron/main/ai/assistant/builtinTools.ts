/**
 * 内置工具目录查询
 *
 * 提供前端展示所需的工具名称列表。
 * TS 工具名称列表位于 tools/definitions/index.ts，
 * SQL 工具名称列表位于 tools/definitions/sql-analysis.ts。
 */

import { SQL_TOOL_NAMES, getSqlToolCatalog } from '../tools/definitions/sql-analysis'
import { TS_TOOL_NAMES } from '../tools/definitions'

/**
 * 获取所有内置工具的名称列表（TS + SQL，供前端展示勾选列表）
 */
export function getAllBuiltinToolNames(): string[] {
  return [...TS_TOOL_NAMES, ...SQL_TOOL_NAMES]
}

/**
 * 获取所有内置工具的目录信息（名称 + 描述，供前端展示）
 */
export function getAllBuiltinToolCatalog(): Array<{ name: string; description: string }> {
  return getSqlToolCatalog()
}

/**
 * 获取内置 TS 工具的名称列表
 */
export function getBuiltinTsToolNames(): string[] {
  return TS_TOOL_NAMES
}
