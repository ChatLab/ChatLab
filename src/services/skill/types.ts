export interface SkillSummary {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  tools: string[]
  builtinId?: string
}

export interface SkillConfig {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  prompt: string
  tools: string[]
  builtinId?: string
}

export interface BuiltinSkillInfo extends SkillSummary {
  imported: boolean
  hasUpdate: boolean
}

export interface SkillServiceAdapter {
  getAll(): Promise<SkillSummary[]>
  getConfig(id: string): Promise<SkillConfig | null>
  create(rawMd: string): Promise<{ success: boolean; id?: string; error?: string }>
  update(id: string, rawMd: string): Promise<{ success: boolean; error?: string }>
  delete(id: string): Promise<{ success: boolean; error?: string }>
  importFromMd(rawMd: string): Promise<{ success: boolean; error?: string }>
  importBuiltin(builtinId: string): Promise<{ success: boolean; id?: string; error?: string }>
  reimport(id: string): Promise<{ success: boolean; error?: string }>
  getBuiltinCatalog(): Promise<BuiltinSkillInfo[]>
}
