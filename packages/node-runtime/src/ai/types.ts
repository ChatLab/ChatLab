/** AI module types that are specific to the Node runtime. */

export type { AssistantConfig, AssistantSummary } from '@openchatlab/shared-types'

export interface SkillDef {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  prompt: string
  tools: string[]
  builtinId?: string
}

export interface SkillSummary {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  tools: string[]
  builtinId?: string
}
