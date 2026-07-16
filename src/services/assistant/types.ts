import type { AssistantConfig, AssistantSummary, BuiltinAssistantInfo } from '@openchatlab/shared-types'

export type { AssistantConfig, AssistantSummary, BuiltinAssistantInfo } from '@openchatlab/shared-types'

export interface AssistantServiceAdapter {
  getAll(): Promise<AssistantSummary[]>
  getConfig(id: string): Promise<AssistantConfig | null>
  create(config: Omit<AssistantConfig, 'id'>): Promise<{ success: boolean; id?: string; error?: string }>
  update(id: string, updates: Partial<AssistantConfig>): Promise<{ success: boolean; error?: string }>
  delete(id: string): Promise<{ success: boolean; error?: string }>
  reset(id: string): Promise<{ success: boolean; error?: string }>
  importFromMd(rawMd: string): Promise<{ success: boolean; error?: string }>
  importBuiltin(builtinId: string): Promise<{ success: boolean; error?: string }>
  reimport(id: string): Promise<{ success: boolean; error?: string }>
  getBuiltinCatalog(): Promise<BuiltinAssistantInfo[]>
  getBuiltinToolCatalog(): Promise<Array<{ name: string; category: 'core' | 'analysis' }>>
}
