/**
 * 平台检测工具
 *
 * 通过编译时注入的常量区分运行环境：
 * - Electron: __IS_ELECTRON__ = true
 * - CLI Web: 两者都为 false（默认，FetchAdapter）
 * - Web WASM: __IS_WEB_WASM__ = true
 */

declare const __IS_ELECTRON__: boolean | undefined
declare const __IS_WEB_WASM__: boolean | undefined

export const IS_ELECTRON = typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__

export const IS_WEB_WASM = typeof __IS_WEB_WASM__ !== 'undefined' && __IS_WEB_WASM__
