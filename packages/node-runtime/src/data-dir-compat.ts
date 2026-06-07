import fs from 'node:fs'
import path from 'node:path'
import type { PathProvider } from '@openchatlab/core'

export type RuntimeKind = 'cli' | 'desktop' | 'mcp' | 'unknown'

export interface RuntimeIdentity {
  version: string
  kind: RuntimeKind
}

export interface DataDirCompatibilityMeta {
  formatVersion: 1
  minRuntimeVersion: string
  dataCompatibilityVersion: number
  reasons: string[]
  updatedBy: {
    runtime: RuntimeKind
    module: string
    version: string
  }
  updatedAt: number
}

export interface RaiseDataDirCompatibilityInput {
  minRuntimeVersion: string
  dataCompatibilityVersion: number
  reason: string
  runtime: RuntimeIdentity
  module: string
  now?: () => number
}

export interface AssertDataDirCompatibilityOptions {
  warn?: (message: string) => void
  env?: Pick<NodeJS.ProcessEnv, 'CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR'>
}

type DataDirCompatibilityErrorCode = 'DATA_DIR_REQUIRES_NEWER_RUNTIME' | 'DATA_DIR_COMPATIBILITY_META_INVALID'

export class DataDirCompatibilityError extends Error {
  readonly code: DataDirCompatibilityErrorCode
  readonly userDataDir: string
  readonly metaPath: string
  readonly currentVersion?: string
  readonly minRuntimeVersion?: string
  readonly statusCode = 409

  constructor(
    code: DataDirCompatibilityErrorCode,
    message: string,
    options: {
      userDataDir: string
      metaPath: string
      currentVersion?: string
      minRuntimeVersion?: string
      cause?: unknown
    }
  ) {
    super(message, { cause: options.cause })
    this.name = 'DataDirCompatibilityError'
    this.code = code
    this.userDataDir = options.userDataDir
    this.metaPath = options.metaPath
    this.currentVersion = options.currentVersion
    this.minRuntimeVersion = options.minRuntimeVersion
  }
}

export function readDataDirCompatibilityMeta(userDataDir: string): DataDirCompatibilityMeta | null {
  const metaPath = getMetaPath(userDataDir)
  if (!fs.existsSync(metaPath)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  } catch (error) {
    throw createInvalidMetaError(userDataDir, metaPath, 'Invalid data directory compatibility meta JSON.', error)
  }

  return validateDataDirCompatibilityMeta(parsed, userDataDir, metaPath)
}

export function assertDataDirCompatible(
  pathProvider: PathProvider,
  runtime: RuntimeIdentity,
  options: AssertDataDirCompatibilityOptions = {}
): void {
  const userDataDir = pathProvider.getUserDataDir()
  const meta = readDataDirCompatibilityMeta(userDataDir)
  if (!meta) return

  if (!isStableSemver(runtime.version) || compareStableSemver(runtime.version, meta.minRuntimeVersion) < 0) {
    const env = options.env ?? process.env
    if (env.CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR === '1') {
      const warn = options.warn ?? console.warn
      warn(
        [
          'CHATLAB_ALLOW_INCOMPATIBLE_DATA_DIR=1 is set. ChatLab will bypass the data directory runtime version gate.',
          `Current runtime ${runtime.kind}@${runtime.version} is below required version ${meta.minRuntimeVersion}.`,
          `Data directory: ${userDataDir}. Continuing may risk data corruption.`,
        ].join(' ')
      )
      return
    }

    throw new DataDirCompatibilityError(
      'DATA_DIR_REQUIRES_NEWER_RUNTIME',
      `ChatLab data directory requires runtime version ${meta.minRuntimeVersion} or newer; current version is ${runtime.version}.`,
      {
        userDataDir,
        metaPath: getMetaPath(userDataDir),
        currentVersion: runtime.version,
        minRuntimeVersion: meta.minRuntimeVersion,
      }
    )
  }
}

export function raiseDataDirMinRuntimeVersion(
  pathProvider: PathProvider,
  input: RaiseDataDirCompatibilityInput
): DataDirCompatibilityMeta {
  const userDataDir = pathProvider.getUserDataDir()
  const metaPath = getMetaPath(userDataDir)

  assertStableVersion(input.minRuntimeVersion, userDataDir, metaPath, 'Invalid minRuntimeVersion.')
  assertStableVersion(input.runtime.version, userDataDir, metaPath, 'Invalid runtime version.')
  if (!isRuntimeKind(input.runtime.kind)) {
    throw createInvalidMetaError(userDataDir, metaPath, 'Invalid runtime kind.')
  }
  if (!isNonEmptyString(input.module) || !isNonEmptyString(input.reason)) {
    throw createInvalidMetaError(userDataDir, metaPath, 'Invalid compatibility raise metadata.')
  }
  if (!Number.isInteger(input.dataCompatibilityVersion) || input.dataCompatibilityVersion < 0) {
    throw createInvalidMetaError(userDataDir, metaPath, 'Invalid dataCompatibilityVersion.')
  }

  const existing = readDataDirCompatibilityMeta(userDataDir)
  const minRuntimeVersion =
    existing && compareStableSemver(existing.minRuntimeVersion, input.minRuntimeVersion) > 0
      ? existing.minRuntimeVersion
      : input.minRuntimeVersion
  const dataCompatibilityVersion = Math.max(existing?.dataCompatibilityVersion ?? 0, input.dataCompatibilityVersion)
  const reasons = mergeReasons(existing?.reasons ?? [], input.reason)
  const now = input.now ?? (() => Math.floor(Date.now() / 1000))

  const nextMeta: DataDirCompatibilityMeta = {
    formatVersion: 1,
    minRuntimeVersion,
    dataCompatibilityVersion,
    reasons,
    updatedBy: {
      runtime: input.runtime.kind,
      module: input.module,
      version: input.runtime.version,
    },
    updatedAt: now(),
  }

  writeMetaAtomic(userDataDir, metaPath, nextMeta)
  return nextMeta
}

function getMetaPath(userDataDir: string): string {
  return path.join(userDataDir, '.chatlab-meta.json')
}

function validateDataDirCompatibilityMeta(
  value: unknown,
  userDataDir: string,
  metaPath: string
): DataDirCompatibilityMeta {
  if (!isRecord(value)) {
    throw createInvalidMetaError(userDataDir, metaPath, 'Data directory compatibility meta must be an object.')
  }

  if (value.formatVersion !== 1) {
    throw createInvalidMetaError(userDataDir, metaPath, 'Unsupported data directory compatibility meta format.')
  }

  const minRuntimeVersion = value.minRuntimeVersion
  const dataCompatibilityVersion = value.dataCompatibilityVersion
  const reasons = value.reasons
  const updatedBy = value.updatedBy
  const updatedAt = value.updatedAt

  if (
    !isStableSemver(minRuntimeVersion) ||
    typeof dataCompatibilityVersion !== 'number' ||
    !Number.isInteger(dataCompatibilityVersion) ||
    dataCompatibilityVersion < 0 ||
    !Array.isArray(reasons) ||
    !reasons.every(isNonEmptyString) ||
    !isRecord(updatedBy) ||
    !isRuntimeKind(updatedBy.runtime) ||
    !isNonEmptyString(updatedBy.module) ||
    !isStableSemver(updatedBy.version) ||
    typeof updatedAt !== 'number' ||
    !Number.isInteger(updatedAt) ||
    updatedAt < 0
  ) {
    throw createInvalidMetaError(userDataDir, metaPath, 'Invalid data directory compatibility meta fields.')
  }

  return {
    formatVersion: 1,
    minRuntimeVersion,
    dataCompatibilityVersion,
    reasons: [...reasons],
    updatedBy: {
      runtime: updatedBy.runtime,
      module: updatedBy.module,
      version: updatedBy.version,
    },
    updatedAt,
  }
}

function createInvalidMetaError(
  userDataDir: string,
  metaPath: string,
  message: string,
  cause?: unknown
): DataDirCompatibilityError {
  return new DataDirCompatibilityError('DATA_DIR_COMPATIBILITY_META_INVALID', message, {
    userDataDir,
    metaPath,
    cause,
  })
}

function assertStableVersion(version: string, userDataDir: string, metaPath: string, message: string): void {
  if (!isStableSemver(version)) {
    throw createInvalidMetaError(userDataDir, metaPath, message)
  }
}

function isStableSemver(version: unknown): version is string {
  return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version)
}

function compareStableSemver(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)

  for (let i = 0; i < 3; i += 1) {
    if (leftParts[i] > rightParts[i]) return 1
    if (leftParts[i] < rightParts[i]) return -1
  }

  return 0
}

function mergeReasons(existing: string[], next: string): string[] {
  return [...new Set([...existing, next])]
}

function writeMetaAtomic(userDataDir: string, metaPath: string, meta: DataDirCompatibilityMeta): void {
  fs.mkdirSync(userDataDir, { recursive: true })
  const tempPath = path.join(userDataDir, `.chatlab-meta.json.${process.pid}.${Date.now()}.tmp`)
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf-8')
    fs.renameSync(tempPath, metaPath)
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    } catch {
      // Ignore cleanup failures so callers see the original write/rename error.
    }
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRuntimeKind(value: unknown): value is RuntimeKind {
  return value === 'cli' || value === 'desktop' || value === 'mcp' || value === 'unknown'
}
