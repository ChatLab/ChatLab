/**
 * Electron 词库管理器
 *
 * 封装 Electron 特定的 nlpDir 路径解析，
 * 实际词库操作委托给 @openchatlab/node-runtime 的共享实现。
 */

import * as path from 'path'
import {
  isDictDownloaded as _isDictDownloaded,
  getDictList as _getDictList,
  loadDictBuffer as _loadDictBuffer,
  downloadDict as _downloadDict,
  deleteDict as _deleteDict,
  ensureDefaultDict as _ensureDefaultDict,
} from '@openchatlab/node-runtime'
import type { DictInfo } from '@openchatlab/core'
import { getSystemDataDir } from '../paths'

export type { DictInfo }

export function getNlpDir(): string {
  return path.join(getSystemDataDir(), 'nlp')
}

export function isDictDownloaded(dictId: string): boolean {
  return _isDictDownloaded(getNlpDir(), dictId)
}

export function getDictList(): DictInfo[] {
  return _getDictList(getNlpDir())
}

export function loadDictBuffer(dictId: string): Buffer | null {
  return _loadDictBuffer(getNlpDir(), dictId)
}

export async function downloadDict(
  dictId: string,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; error?: string }> {
  return _downloadDict(getNlpDir(), dictId, onProgress)
}

export function deleteDict(dictId: string): { success: boolean; error?: string } {
  return _deleteDict(getNlpDir(), dictId)
}

export async function ensureDefaultDict(): Promise<void> {
  return _ensureDefaultDict(getNlpDir())
}
