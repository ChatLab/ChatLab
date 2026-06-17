/**
 * Embedding provider 模块
 */

export type { EmbeddingProvider, EmbeddingPooling } from './types'
export {
  BGE_PROFILE,
  QWEN3_PROFILE,
  getLocalProfilesForLocale,
  getLocalProfileByModelId,
  type LocalEmbeddingProfile,
} from './profiles'
export { applyQueryInstruction, clampTextChars } from './text'
export { LocalEmbeddingProvider } from './local'
export type { LocalPipelineFactory, FeatureExtractFn, LocalEmbeddingProviderOptions } from './local'
export { OpenAICompatibleEmbeddingProvider } from './api'
export type { OpenAICompatibleConfig, FetchFn } from './api'
