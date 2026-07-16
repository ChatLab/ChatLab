/**
 * 自定义 Model 持久化存储
 * 文件位置: {aiDataDir}/custom-models.json
 */

import * as fs from 'fs'
import * as path from 'path'
import { getPathProvider } from '../../paths/provider'
import { aiLogger } from '../logger'
import type { ModelDefinition } from './model-types'

function getStorePath(): string {
  return path.join(getPathProvider().getAiDataDir(), 'custom-models.json')
}

function readStore(): ModelDefinition[] {
  const storePath = getStorePath()
  if (!fs.existsSync(storePath)) return []

  try {
    const content = fs.readFileSync(storePath, 'utf-8')
    return JSON.parse(content) as ModelDefinition[]
  } catch (error) {
    aiLogger.error('CustomModelStore', 'Failed to read store', error)
    return []
  }
}

function writeStore(models: ModelDefinition[]): void {
  const storePath = getStorePath()
  const dir = path.dirname(storePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(storePath, JSON.stringify(models, null, 2), 'utf-8')
}

export function loadCustomModels(): ModelDefinition[] {
  return readStore()
}

export function addCustomModel(input: Omit<ModelDefinition, 'builtin' | 'editable'>): ModelDefinition {
  const models = readStore()

  const existing = models.find((m) => m.id === input.id && m.providerId === input.providerId)
  if (existing) {
    throw new Error(`Model "${input.id}" already exists under provider "${input.providerId}"`)
  }

  const newModel: ModelDefinition = {
    ...input,
    builtin: false,
    editable: true,
  }
  models.push(newModel)
  writeStore(models)
  return newModel
}

export function updateCustomModel(
  providerId: string,
  modelId: string,
  updates: Partial<Omit<ModelDefinition, 'id' | 'providerId' | 'builtin'>>
): { success: boolean; error?: string } {
  const models = readStore()
  const index = models.findIndex((m) => m.id === modelId && m.providerId === providerId)
  if (index === -1) return { success: false, error: 'Custom model not found' }

  models[index] = { ...models[index], ...updates }
  writeStore(models)
  return { success: true }
}

export function deleteCustomModel(providerId: string, modelId: string): { success: boolean; error?: string } {
  const models = readStore()
  const index = models.findIndex((m) => m.id === modelId && m.providerId === providerId)
  if (index === -1) return { success: false, error: 'Custom model not found' }

  models.splice(index, 1)
  writeStore(models)
  return { success: true }
}
