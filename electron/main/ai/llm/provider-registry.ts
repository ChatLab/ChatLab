/**
 * Provider Registry — 内置 provider 目录
 */

import type { ProviderDefinition } from './model-types'

// ==================== 内置 Provider 目录 ====================

const OPENAI: ProviderDefinition = {
  id: 'openai',
  name: 'OpenAI',
  kind: 'official',
  website: 'https://openai.com',
  consoleUrl: 'https://platform.openai.com/api-keys',
  defaultBaseUrl: 'https://api.openai.com/v1',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: [
    'gpt-5.4-pro',
    'gpt-5.4',
    'gpt-5.2-pro',
    'gpt-5.2',
    'gpt-5.1',
    'gpt-5-pro',
    'gpt-5',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-4o-mini',
    'o3',
    'o4-mini',
    'text-embedding-3-small',
    'text-embedding-3-large',
  ],
}

const ANTHROPIC: ProviderDefinition = {
  id: 'anthropic',
  name: 'Anthropic',
  kind: 'official',
  website: 'https://www.anthropic.com',
  consoleUrl: 'https://console.anthropic.com/settings/keys',
  defaultBaseUrl: 'https://api.anthropic.com',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-haiku-3-5-20241022',
  ],
}

const GEMINI: ProviderDefinition = {
  id: 'gemini',
  name: 'Gemini',
  kind: 'official',
  website: 'https://ai.google.dev',
  consoleUrl: 'https://aistudio.google.com/apikey',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: [
    'gemini-3.1-pro-preview',
    'gemini-3-pro-preview',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'text-embedding-004',
  ],
}

const DEEPSEEK: ProviderDefinition = {
  id: 'deepseek',
  name: 'DeepSeek',
  kind: 'official',
  website: 'https://www.deepseek.com',
  consoleUrl: 'https://platform.deepseek.com/api_keys',
  defaultBaseUrl: 'https://api.deepseek.com/v1',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: ['deepseek-chat', 'deepseek-reasoner'],
}

const QWEN: ProviderDefinition = {
  id: 'qwen',
  name: 'Qwen',
  kind: 'official',
  website: 'https://tongyi.aliyun.com',
  consoleUrl: 'https://dashscope.console.aliyun.com/apiKey',
  defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: [
    'qwen3.5-plus',
    'qwen3.5-flash',
    'qwen3-max',
    'qwen-max',
    'qwen-plus',
    'qwen-turbo',
    'qwen-long',
    'text-embedding-v3',
  ],
}

const GLM: ProviderDefinition = {
  id: 'glm',
  name: 'GLM',
  kind: 'official',
  website: 'https://www.zhipuai.cn',
  consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: [
    'glm-5',
    'glm-4.7',
    'glm-4.6v',
    'glm-4.6v-flash',
    'glm-4.5',
    'glm-4.5-flash',
    'glm-4-plus',
    'glm-4-flash',
    'embedding-3',
  ],
}

const KIMI: ProviderDefinition = {
  id: 'kimi',
  name: 'Kimi',
  kind: 'official',
  website: 'https://www.moonshot.cn',
  consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
  defaultBaseUrl: 'https://api.moonshot.cn/v1',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: ['kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo', 'kimi-k2-0905-Preview', 'moonshot-v1-auto'],
}

const DOUBAO: ProviderDefinition = {
  id: 'doubao',
  name: 'Doubao',
  kind: 'official',
  website: 'https://www.volcengine.com/product/doubao',
  consoleUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: [
    'doubao-seed-2-0-pro-260215',
    'doubao-seed-2-0-lite-260215',
    'doubao-seed-2-0-mini-260215',
    'doubao-seed-1-8-251228',
    'doubao-seed-1-6-251015',
    'doubao-seed-1-6-lite-251015',
  ],
}

const SILICONFLOW: ProviderDefinition = {
  id: 'siliconflow',
  name: 'SiliconFlow',
  kind: 'official',
  website: 'https://siliconflow.cn',
  consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
  defaultBaseUrl: 'https://api.siliconflow.cn/v1',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: ['deepseek-ai/DeepSeek-V3.2', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen3-8B'],
}

const GROQ: ProviderDefinition = {
  id: 'groq',
  name: 'Groq',
  kind: 'official',
  website: 'https://groq.com',
  consoleUrl: 'https://console.groq.com/keys',
  defaultBaseUrl: 'https://api.groq.com/openai/v1',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: ['llama3-70b-8192', 'llama3-8b-8192', 'mistral-saba-24b', 'gemma-9b-it'],
}

const OPENROUTER: ProviderDefinition = {
  id: 'openrouter',
  name: 'OpenRouter',
  kind: 'aggregator',
  website: 'https://openrouter.ai',
  consoleUrl: 'https://openrouter.ai/keys',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: ['deepseek/deepseek-chat', 'google/gemini-2.5-flash-preview', 'mistralai/mistral-7b-instruct:free'],
}

const XAI: ProviderDefinition = {
  id: 'xai',
  name: 'xAI',
  kind: 'official',
  website: 'https://x.ai',
  consoleUrl: 'https://console.x.ai',
  defaultBaseUrl: 'https://api.x.ai/v1',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: ['grok-4', 'grok-3', 'grok-3-fast', 'grok-3-mini', 'grok-3-mini-fast'],
}

const MINIMAX: ProviderDefinition = {
  id: 'minimax',
  name: 'MiniMax',
  kind: 'official',
  website: 'https://www.minimaxi.com',
  consoleUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  defaultBaseUrl: 'https://api.minimaxi.com/v1',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed'],
}

const OPENAI_COMPATIBLE: ProviderDefinition = {
  id: 'openai-compatible',
  name: 'OpenAI Compatible',
  kind: 'openai-compatible',
  defaultBaseUrl: 'http://localhost:11434/v1',
  authMode: 'api-key',
  supportsCustomModels: true,
  builtin: true,
  enabledByDefault: true,
  modelIds: [],
}

// ==================== 内置目录导出 ====================

export const BUILTIN_PROVIDERS: ProviderDefinition[] = [
  OPENAI,
  ANTHROPIC,
  GEMINI,
  DEEPSEEK,
  QWEN,
  GLM,
  KIMI,
  DOUBAO,
  SILICONFLOW,
  GROQ,
  OPENROUTER,
  XAI,
  MINIMAX,
  OPENAI_COMPATIBLE,
]

/** 按 id 查找内置 provider */
export function getBuiltinProviderById(id: string): ProviderDefinition | null {
  return BUILTIN_PROVIDERS.find((p) => p.id === id) || null
}
