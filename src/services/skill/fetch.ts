import type { SkillServiceAdapter, SkillSummary, SkillConfig, BuiltinSkillInfo } from './types'
import { get, post, put, del } from '../utils/http'

export class FetchSkillAdapter implements SkillServiceAdapter {
  async getAll(): Promise<SkillSummary[]> {
    return get<SkillSummary[]>('/ai/skills')
  }

  async getConfig(id: string): Promise<SkillConfig | null> {
    try {
      return await get<SkillConfig>(`/ai/skills/${id}`)
    } catch {
      return null
    }
  }

  async create(rawMd: string) {
    return post<{ success: boolean; id?: string; error?: string }>('/ai/skills', { rawMd })
  }

  async update(id: string, rawMd: string) {
    return put<{ success: boolean; error?: string }>(`/ai/skills/${id}`, { rawMd })
  }

  async delete(id: string) {
    return del<{ success: boolean; error?: string }>(`/ai/skills/${id}`)
  }

  async importFromMd(rawMd: string) {
    return post<{ success: boolean; error?: string }>('/ai/skills/import', { rawMd })
  }

  async importBuiltin(builtinId: string) {
    return post<{ success: boolean; id?: string; error?: string }>('/ai/skills/import-builtin', { builtinId })
  }

  async reimport(id: string) {
    return post<{ success: boolean; error?: string }>(`/ai/skills/${id}/reimport`, {})
  }

  async getBuiltinCatalog(): Promise<BuiltinSkillInfo[]> {
    try {
      return await get<BuiltinSkillInfo[]>('/ai/skills/builtin-catalog')
    } catch {
      return []
    }
  }
}
