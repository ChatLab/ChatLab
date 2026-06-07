import type { PathProvider } from '@openchatlab/core'
import {
  assertDataDirCompatible,
  DataDirCompatibilityError,
  type RuntimeIdentity,
  type RuntimeKind,
} from '@openchatlab/node-runtime'
import { getVersion } from './version'

export function createCliRuntimeIdentity(kind: Extract<RuntimeKind, 'cli' | 'mcp'>): RuntimeIdentity {
  return { version: getVersion(), kind }
}

export function assertCliDataDirCompatible(
  pathProvider: PathProvider,
  kind: Extract<RuntimeKind, 'cli' | 'mcp'>,
  options?: { version?: string }
): RuntimeIdentity {
  const runtime: RuntimeIdentity = { version: options?.version ?? getVersion(), kind }

  try {
    assertDataDirCompatible(pathProvider, runtime)
  } catch (error) {
    if (
      error instanceof DataDirCompatibilityError &&
      error.code === 'DATA_DIR_REQUIRES_NEWER_RUNTIME' &&
      error.minRuntimeVersion
    ) {
      throw new Error(formatCliDataDirCompatibilityError(error, runtime), { cause: error })
    }

    throw error
  }

  return runtime
}

function formatCliDataDirCompatibilityError(error: DataDirCompatibilityError, runtime: RuntimeIdentity): string {
  return [
    `ChatLab data directory requires ChatLab ${error.minRuntimeVersion} or newer.`,
    `Current ${runtime.kind} version: ${runtime.version}.`,
    `Data directory: ${error.userDataDir}.`,
    'Upgrade: npm install -g chatlab-cli@latest',
  ].join('\n')
}
