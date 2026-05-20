/**
 * 配置 Zod Schema 定义
 *
 * 同时服务于 TOML 文件校验和环境变量解析。
 */

import { z } from 'zod'

export const DEFAULT_API_PORT = 3110

export const llmConfigSchema = z.object({
  provider: z.string().default(''),
  model: z.string().default(''),
  base_url: z.string().default(''),
})

export const dataConfigSchema = z.object({
  user_data_dir: z.string().default(''),
})

export const apiConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(DEFAULT_API_PORT),
  host: z.string().default('127.0.0.1'),
  token: z.string().default(''),
})

export const localeConfigSchema = z.object({
  lang: z.string().default(''),
})

export const uiConfigSchema = z.object({
  default_session_tab: z.enum(['overview', 'ai-chat']).default('overview'),
  session_gap_threshold: z.number().int().min(60).max(86400).default(1800),
})

export const configSchema = z.object({
  llm: llmConfigSchema.default({}),
  data: dataConfigSchema.default({}),
  api: apiConfigSchema.default({}),
  locale: localeConfigSchema.default({}),
  ui: uiConfigSchema.default({}),
})

export type ChatLabConfig = z.infer<typeof configSchema>
export type LlmConfig = z.infer<typeof llmConfigSchema>
export type DataConfig = z.infer<typeof dataConfigSchema>
export type ApiConfig = z.infer<typeof apiConfigSchema>
export type LocaleConfig = z.infer<typeof localeConfigSchema>
export type UiConfig = z.infer<typeof uiConfigSchema>
