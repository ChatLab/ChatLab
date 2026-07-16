import type { PathProvider } from '@openchatlab/core'
import {
  assertDataDirCompatible,
  DataDirCompatibilityError,
  type RuntimeIdentity,
} from '@openchatlab/node-runtime/data-dir-compat'

export function resolveDesktopAppVersion(electronVersion: string | null | undefined, bundledVersion?: string): string {
  const normalizedElectronVersion = normalizeVersion(electronVersion)
  if (normalizedElectronVersion && normalizedElectronVersion !== '0.0.0') return normalizedElectronVersion

  const normalizedBundledVersion = normalizeVersion(bundledVersion)
  if (normalizedBundledVersion) return normalizedBundledVersion

  return normalizedElectronVersion || '0.0.0'
}

export function getDesktopAppVersion(electronVersion: string | null | undefined): string {
  return resolveDesktopAppVersion(electronVersion, typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined)
}

export function createDesktopRuntimeIdentity(version: string): RuntimeIdentity {
  return { version, kind: 'desktop' }
}

export function assertDesktopDataDirCompatible(pathProvider: PathProvider, version: string): RuntimeIdentity {
  const runtime = createDesktopRuntimeIdentity(version)

  try {
    assertDataDirCompatible(pathProvider, runtime)
  } catch (error) {
    if (
      error instanceof DataDirCompatibilityError &&
      error.code === 'DATA_DIR_REQUIRES_NEWER_RUNTIME' &&
      error.minRuntimeVersion
    ) {
      throw new Error(formatDesktopDataDirCompatibilityError(error, runtime), { cause: error })
    }

    throw error
  }

  return runtime
}

function normalizeVersion(version: string | null | undefined): string {
  return typeof version === 'string' ? version.trim() : ''
}

function formatDesktopDataDirCompatibilityError(error: DataDirCompatibilityError, runtime: RuntimeIdentity): string {
  return [
    `ChatLab data directory requires ChatLab ${error.minRuntimeVersion} or newer.`,
    `Current desktop version: ${runtime.version}.`,
    `Data directory: ${error.userDataDir}.`,
    'Please upgrade ChatLab desktop before opening this data directory.',
  ].join('\n')
}
