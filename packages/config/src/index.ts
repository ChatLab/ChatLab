/**
 * @openchatlab/config
 *
 * ChatLab 配置管理：TOML/JSON 文件读取 + CHATLAB_* 环境变量覆盖 + Zod 校验。
 */

export { loadConfig, getConfigPath, getConfigDir, writeConfigField } from './loader'
export { setConfigField, ConfigSetError } from './set-config-field'
export type { ConfigSetResult, ConfigSetErrorReason } from './set-config-field'
export { configSchema, DEFAULT_API_PORT } from './schema'
export type { ChatLabConfig, LlmConfig, DataConfig, ApiConfig, LocaleConfig, UiConfig, CliConfig } from './schema'
export {
  loadAuthProfiles,
  getApiKeyByProfile,
  getApiKeyByProvider,
  resolveApiKey,
  writeAuthProfile,
  deleteAuthProfile,
  deriveAuthProfileName,
} from './auth-profiles'
export type { AuthProfile, AuthProfilesData } from './auth-profiles'
export { readJsonFile, withFileLock, writeJsonFileAtomically } from './atomic-json-file'
export { MigrationRunner, ALL_MIGRATIONS } from './migrations'
export type { Migration, MigrationContext, Logger as MigrationLogger } from './migrations'
