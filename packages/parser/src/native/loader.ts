/**
 * Loader for the optional Rust parsing kernels (@openchatlab/parser-native).
 *
 * The native module is a local-build artifact: contributors without a Rust
 * toolchain, published CLI installs and unsupported platforms simply fall
 * back to the pure-TS parsers. Loading uses a runtime require so bundlers
 * (electron-vite / tsup) never try to inline the .node binary.
 */

import { createRequire } from 'node:module'

import type { ChatlabParser, WeflowParser } from '@openchatlab/parser-native'

export interface NativeParserModule {
  WeflowParser: typeof WeflowParser
  ChatlabParser: typeof ChatlabParser
}

let cachedModule: NativeParserModule | null | undefined

function isNativeDisabled(): boolean {
  return process.env.CHATLAB_DISABLE_NATIVE_PERF === '1'
}

function requireNativeModule(): NativeParserModule {
  const requireFn = createRequire(import.meta.url)
  return requireFn('@openchatlab/parser-native') as NativeParserModule
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
  } catch {
    cachedModule = null
  }
  return cachedModule
}
