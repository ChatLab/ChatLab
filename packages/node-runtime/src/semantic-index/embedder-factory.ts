/**
 * Embedder 工厂
 *
 * 从语义索引配置构造 EmbeddingProvider：
 * - local：按 modelId 取静态 profile，注入本地模型缓存目录。
 * - api：OpenAI-compatible，API Key 从 auth-profiles.json 按 authProfile 引用解析。
 *
 * resolveApiKey / pipelineFactory / fetchFn 均可注入，便于单测不联网、不下载模型。
 */

import { resolveApiKey as defaultResolveApiKey } from '@openchatlab/config'
import { OpenAICompatibleEmbeddingProvider, type FetchFn } from './embedding/api'
import { LocalEmbeddingProvider, type LocalPipelineFactory } from './embedding/local'
import { getLocalProfileByModelId } from './embedding/profiles'
import type { EmbeddingProvider } from './embedding/types'
import type { SemanticIndexConfig } from './config'

export interface EmbedderFactoryDeps {
  /** 本地模型目录，例如 ~/.chatlab/ai/models/semantic-index */
  modelsCacheDir?: string
  /** Optional HTTP(S) proxy URL used only for downloading local embedding model files. */
  modelDownloadProxyUrl?: string
  /** auth-profiles 解析，默认走 @openchatlab/config */
  resolveApiKey?: (provider: string, authProfile?: string) => string
  /** 本地 pipeline 工厂注入（测试用，不下载模型） */
  localPipelineFactory?: LocalPipelineFactory
  /** API fetch 注入（测试用，不联网） */
  fetchFn?: FetchFn
}

export function createEmbedder(config: SemanticIndexConfig, deps: EmbedderFactoryDeps = {}): EmbeddingProvider {
  if (config.mode === 'api') {
    if (!config.api || !config.api.baseUrl || !config.api.model) {
      throw new Error('semantic index API config incomplete: baseUrl and model are required')
    }
    const resolve = deps.resolveApiKey ?? defaultResolveApiKey
    const apiKey = resolve('', config.api.authProfile)
    return new OpenAICompatibleEmbeddingProvider(
      { baseUrl: config.api.baseUrl, apiKey, model: config.api.model },
      { fetchFn: deps.fetchFn }
    )
  }

  const profile = getLocalProfileByModelId(config.local.modelId)
  if (!profile) {
    throw new Error(`unknown local embedding model: ${config.local.modelId}`)
  }
  return new LocalEmbeddingProvider(profile, {
    cacheDir: deps.modelsCacheDir,
    modelDownloadProxyUrl: deps.modelDownloadProxyUrl,
    modelDownloadSource: config.local.downloadSource,
    pipelineFactory: deps.localPipelineFactory,
  })
}
