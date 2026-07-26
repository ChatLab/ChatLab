import type { LanguageModel } from 'ai'

import type { WebModelConfig } from './types'

export interface CreatedWebModel {
  model: LanguageModel
}

export async function createWebAIModel(config: WebModelConfig, apiKey: string): Promise<CreatedWebModel> {
  const baseURL = (config.baseURL || (config.provider === 'deepseek' ? 'https://api.deepseek.com' : '')).replace(
    /\/+$/,
    ''
  )
  if (!baseURL) throw new Error('API URL is required for an OpenAI-compatible provider')

  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
  return {
    model: createOpenAICompatible({
      name: config.provider === 'deepseek' ? 'deepseek' : 'chatlab-web',
      apiKey,
      baseURL,
    }).chatModel(config.model),
  }
}
