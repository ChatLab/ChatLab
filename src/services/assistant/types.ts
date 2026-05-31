export interface AssistantSummary {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  builtinId?: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

export interface AssistantConfig {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  allowedBuiltinTools?: string[]
  builtinId?: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

export interface BuiltinAssistantInfo {
  id: string
  name: string
  systemPrompt: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
  imported: boolean
}

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
