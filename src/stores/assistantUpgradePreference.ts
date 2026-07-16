import type { AssistantUpgradeInfo } from '@openchatlab/shared-types'

export function isAssistantUpgradeSkipped(
  skippedVersions: Readonly<Record<string, number>>,
  info: AssistantUpgradeInfo
): boolean {
  return info.latestVersion !== null && skippedVersions[info.builtinId] === info.latestVersion
}
