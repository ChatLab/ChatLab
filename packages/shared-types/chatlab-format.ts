/** ChatLab 当前生成文件时使用的格式版本。 */
export const CHATLAB_FORMAT_VERSION = '0.0.2' as const

/** ChatLab 当前可以读取和验证的历史格式版本。 */
export const CHATLAB_SUPPORTED_FORMAT_VERSIONS = ['0.0.1', CHATLAB_FORMAT_VERSION] as const

export type ChatLabFormatVersion = (typeof CHATLAB_SUPPORTED_FORMAT_VERSIONS)[number]

export function isSupportedChatLabFormatVersion(version: string): version is ChatLabFormatVersion {
  return (CHATLAB_SUPPORTED_FORMAT_VERSIONS as readonly string[]).includes(version)
}
