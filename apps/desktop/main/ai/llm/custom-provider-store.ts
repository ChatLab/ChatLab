/**
 * 自定义 Provider 持久化存储
 * 文件位置: {aiDataDir}/custom-providers.json
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { getPathProvider } from '../../paths/provider'
import { aiLogger } from '../logger'
import type { ProviderDefinition } from './model-types'

function getStorePath(): string {
  return path.join(getPathProvider().getAiDataDir(), 'custom-providers.json')
}

function readStore(): ProviderDefinition[] {
  const storePath = getStorePath()
  if (!fs.existsSync(storePath)) return []

  try {
    const content = fs.readFileSync(storePath, 'utf-8')
    return JSON.parse(content) as ProviderDefinition[]
  } catch (error) {
    aiLogger.error('CustomProviderStore', 'Failed to read store', error)
    return []
  }
}

function writeStore(providers: ProviderDefinition[]): void {
  const storePath = getStorePath()
  const dir = path.dirname(storePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(storePath, JSON.stringify(providers, null, 2), 'utf-8')
}

export function loadCustomProviders(): ProviderDefinition[] {
  return readStore()
}

export function addCustomProvider(
  input: Omit<ProviderDefinition, 'id' | 'builtin' | 'enabledByDefault'>
): ProviderDefinition {
  const providers = readStore()
  const newProvider: ProviderDefinition = {
    ...input,
    id: `custom:${randomUUID()}`,
    builtin: false,
    enabledByDefault: false,
  }
  providers.push(newProvider)
  writeStore(providers)
  return newProvider
}

export function updateCustomProvider(
  id: string,
  updates: Partial<Omit<ProviderDefinition, 'id' | 'builtin'>>
): { success: boolean; error?: string } {
  const providers = readStore()
  const index = providers.findIndex((p) => p.id === id)
  if (index === -1) return { success: false, error: 'Custom provider not found' }

  providers[index] = { ...providers[index], ...updates }
  writeStore(providers)
  return { success: true }
}

export function deleteCustomProvider(id: string): { success: boolean; error?: string } {
  const providers = readStore()
  const index = providers.findIndex((p) => p.id === id)
  if (index === -1) return { success: false, error: 'Custom provider not found' }

  providers.splice(index, 1)
  writeStore(providers)
  return { success: true }
}
