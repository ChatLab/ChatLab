/** Desktop-only LLM presentation types. */

export * from './model-types'

export type LLMProvider = string

export interface ProviderInfo {
  id: string
  name: string
  defaultBaseUrl: string
  models: Array<{
    id: string
    name: string
    description?: string
  }>
}
