/**
 * Loader for the optional Rust parsing kernels (@openchatlab/parser-native).
 *
 * The native module is a local-build artifact: contributors without a Rust
 * toolchain, published CLI installs and unsupported platforms simply fall
 * back to the pure-TS parsers. Loading uses a runtime require so bundlers
 * (electron-vite / tsup) never try to inline the .node binary.
 */

import { createRequire } from 'node:module'

import type { NativeParser } from '@openchatlab/parser-native'
import { PARSER_FORMAT_IDS, normalizeParserFormatId } from '../format-ids'

export interface NativeParserModule {
  NativeParser: typeof NativeParser
}

/** Load-state snapshot for startup observability (see node-runtime logNativeParserStatus). */
export interface NativeParserStatus {
  available: boolean
  /** true when CHATLAB_DISABLE_NATIVE_PERF=1 forces the TS parsers. */
  disabled: boolean
  /** Load failure reason when unavailable (e.g. module not shipped, ABI mismatch). */
  error?: string
}

let cachedModule: NativeParserModule | null | undefined
let cachedLoadError: string | undefined

function isNativeDisabled(): boolean {
  return process.env.CHATLAB_DISABLE_NATIVE_PERF === '1'
}

function isNativeParserModule(value: unknown): value is NativeParserModule {
  return typeof (value as { NativeParser?: unknown } | null)?.NativeParser === 'function'
}

function requireNativeModule(): NativeParserModule {
  const requireFn = createRequire(import.meta.url)
  const module = requireFn('@openchatlab/parser-native') as unknown
  if (!isNativeParserModule(module)) {
    throw new Error('Native parser module missing NativeParser export')
  }
  return module
}

/**
 * Returns the native module, or null when disabled/unavailable.
 * The module itself is cached; the env switch is evaluated on every call so
 * tests can toggle it at runtime.
 */
export function loadNativeParser(): NativeParserModule | null {
  if (isNativeDisabled()) return null
  if (cachedModule !== undefined) return cachedModule
  try {
    cachedModule = requireNativeModule()
  } catch (error) {
    cachedModule = null
    cachedLoadError = error instanceof Error ? error.message : String(error)
  }
  return cachedModule
}

/** Report whether the Rust kernels can load in this process, without throwing. */
export function getNativeParserStatus(): NativeParserStatus {
  if (isNativeDisabled()) return { available: false, disabled: true }
  const module = loadNativeParser()
  return { available: module !== null, disabled: false, error: module ? undefined : cachedLoadError }
}

/**
 * Report whether the currently loaded binary understands one kernel id.
 *
 * This is intentionally stricter than module availability: an older `.node`
 * can load successfully while not containing a newly added format. The
 * constructor only validates the id and stores the path; it does not read the
 * file, so an empty probe path has no side effects.
 */
export function isNativeFormatAvailable(formatId: string): boolean {
  const module = loadNativeParser()
  if (!module) return false

  try {
    new module.NativeParser(resolveNativeKernelId(formatId), '')
    return true
  } catch {
    return false
  }
}

function resolveNativeKernelId(formatId: string): string {
  const canonicalId = normalizeParserFormatId(formatId)
  if (canonicalId === PARSER_FORMAT_IDS.QQ_SHUAKAMI) return 'shuakami-qq-exporter'
  if (canonicalId === PARSER_FORMAT_IDS.ECHOTRACE) return 'weflow'
  return canonicalId
}
