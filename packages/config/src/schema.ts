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
  electron_migration_done: z.boolean().default(false),
})

export const apiConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(DEFAULT_API_PORT),
  host: z.string().default('127.0.0.1'),
  token: z.string().default(''),
  require_auth: z.boolean().default(false),
})

export const localeConfigSchema = z.object({
  lang: z.string().default(''),
})

const defaultSessionTabSchema = z.preprocess(
  (value) => (value === 'overview' ? 'insights' : value),
  z.enum(['insights', 'ai-chat', 'memory']).default('insights')
)

export const uiConfigSchema = z
  .object({
    default_session_tab: z.unknown().optional(),
    default_session_tab_override: z.literal('memory').optional(),
    session_gap_threshold: z.number().int().min(60).max(86400).default(1800),
    summary_strategy: z.enum(['brief', 'standard']).default('standard'),
  })
  .transform(({ default_session_tab_override, ...config }) => ({
    ...config,
    default_session_tab:
      default_session_tab_override && config.default_session_tab === 'overview'
        ? default_session_tab_override
        : defaultSessionTabSchema.parse(config.default_session_tab),
  }))

export const cliConfigSchema = z.object({
  /** Allow --raw output that bypasses privacy preprocessing (user-side opt-in). */
  allow_raw: z.boolean().default(false),
  /** Allow the read-only `sql` query command. */
  allow_sql: z.boolean().default(true),
})

export const desktopConfigSchema = z.object({
  close_behavior: z.enum(['background', 'quit']).default('background'),
  ui_scale: z.number().min(0.9).max(1.5).default(1),
})

export const configSchema = z.object({
  llm: llmConfigSchema.default({}),
  data: dataConfigSchema.default({}),
  api: apiConfigSchema.default({}),
  locale: localeConfigSchema.default({}),
  ui: uiConfigSchema.default({}),
  cli: cliConfigSchema.default({}),
  desktop: desktopConfigSchema.default({}),
})

export type ChatLabConfig = z.infer<typeof configSchema>
export type LlmConfig = z.infer<typeof llmConfigSchema>
export type DataConfig = z.infer<typeof dataConfigSchema>
export type ApiConfig = z.infer<typeof apiConfigSchema>
export type LocaleConfig = z.infer<typeof localeConfigSchema>
export type UiConfig = z.infer<typeof uiConfigSchema>
export type CliConfig = z.infer<typeof cliConfigSchema>
export type DesktopConfig = z.infer<typeof desktopConfigSchema>
