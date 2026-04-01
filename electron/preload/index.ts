/**
 * Electron Preload Script
 * 将主进程 API 暴露给渲染进程
 */
import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 从拆分的模块导入 API
import { extendedApi } from './apis/core'
import { chatApi, mergeApi } from './apis/chat'
import { aiApi, llmApi, agentApi, embeddingApi, assistantApi, skillApi } from './apis/ai'
import { nlpApi, networkApi, cacheApi, sessionApi } from './apis/utils'
import { apiServerApi } from './apis/api-server'

// 为渲染进程提供统一的类型入口，避免 type-only import 指向无导出的运行时代码。
export type { PreprocessConfig, EmbeddingServiceConfig, EmbeddingServiceConfigDisplay } from './apis/ai'

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', extendedApi)
    contextBridge.exposeInMainWorld('chatApi', chatApi)
    contextBridge.exposeInMainWorld('mergeApi', mergeApi)
    contextBridge.exposeInMainWorld('aiApi', aiApi)
    contextBridge.exposeInMainWorld('llmApi', llmApi)
    contextBridge.exposeInMainWorld('agentApi', agentApi)
    contextBridge.exposeInMainWorld('embeddingApi', embeddingApi)
    contextBridge.exposeInMainWorld('assistantApi', assistantApi)
    contextBridge.exposeInMainWorld('skillApi', skillApi)
    contextBridge.exposeInMainWorld('cacheApi', cacheApi)
    contextBridge.exposeInMainWorld('networkApi', networkApi)
    contextBridge.exposeInMainWorld('sessionApi', sessionApi)
    contextBridge.exposeInMainWorld('nlpApi', nlpApi)
    contextBridge.exposeInMainWorld('apiServerApi', apiServerApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = extendedApi
  // @ts-ignore (define in dts)
  window.chatApi = chatApi
  // @ts-ignore (define in dts)
  window.mergeApi = mergeApi
  // @ts-ignore (define in dts)
  window.aiApi = aiApi
  // @ts-ignore (define in dts)
  window.llmApi = llmApi
  // @ts-ignore (define in dts)
  window.agentApi = agentApi
  // @ts-ignore (define in dts)
  window.embeddingApi = embeddingApi
  // @ts-ignore (define in dts)
  window.assistantApi = assistantApi
  // @ts-ignore (define in dts)
  window.skillApi = skillApi
  // @ts-ignore (define in dts)
  window.cacheApi = cacheApi
  // @ts-ignore (define in dts)
  window.networkApi = networkApi
  // @ts-ignore (define in dts)
  window.sessionApi = sessionApi
  // @ts-ignore (define in dts)
  window.nlpApi = nlpApi
  // @ts-ignore (define in dts)
  window.apiServerApi = apiServerApi
}
