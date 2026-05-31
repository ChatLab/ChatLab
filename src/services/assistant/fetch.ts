import type { AssistantServiceAdapter, AssistantSummary, AssistantConfig, BuiltinAssistantInfo } from './types'
import { get, post, put, del } from '../utils/http'

export class FetchAssistantAdapter implements AssistantServiceAdapter {
  async getAll(): Promise<AssistantSummary[]> {
    return get<AssistantSummary[]>('/ai/assistants')
  }

  async getConfig(id: string): Promise<AssistantConfig | null> {
    try {
      return await get<AssistantConfig>(`/ai/assistants/${id}`)
    } catch {
      return null
    }
  }

  async create(config: Omit<AssistantConfig, 'id'>) {
    return post<{ success: boolean; id?: string; error?: string }>('/ai/assistants', config)
  }

  async update(id: string, updates: Partial<AssistantConfig>) {
    return put<{ success: boolean; error?: string }>(`/ai/assistants/${id}`, updates)
  }

  async delete(id: string) {
    return del<{ success: boolean; error?: string }>(`/ai/assistants/${id}`)
  }

  async reset(id: string) {
    return post<{ success: boolean; error?: string }>(`/ai/assistants/${id}/reset`, {})
  }

  async importFromMd(rawMd: string) {
    return post<{ success: boolean; error?: string }>('/ai/assistants/import', { rawMd })
  }

  /** @deprecated Local builtin catalog is empty; kept for backward compatibility */
  async getBuiltinCatalog(): Promise<BuiltinAssistantInfo[]> {
    return []
  }

  async importBuiltin(builtinId: string) {
    return post<{ success: boolean; error?: string }>('/ai/assistants/import-builtin', { builtinId })
  }

  async reimport(id: string) {
    return post<{ success: boolean; error?: string }>(`/ai/assistants/${id}/reimport`, {})
  }

  async getBuiltinToolCatalog(): Promise<Array<{ name: string; category: 'core' | 'analysis' }>> {
    return get<Array<{ name: string; category: 'core' | 'analysis' }>>('/ai/tools/catalog')
  }
}
