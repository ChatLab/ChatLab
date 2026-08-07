import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  WebAIChatRuntime,
  type SaveWebModelConfigInput,
  type WebAIConnectionTestResult,
  type WebModelConfig,
} from '@openchatlab/web-ai-runtime'
import { useBrowserRuntimeRpc } from '@/services/browser-runtime/service'

export const useWebAISettingsStore = defineStore('web-ai-settings', () => {
  const config = ref<WebModelConfig | null>(null)
  const loaded = ref(false)
  let runtime: WebAIChatRuntime | null = null

  function getRuntime(): WebAIChatRuntime {
    return (runtime ??= new WebAIChatRuntime(useBrowserRuntimeRpc()))
  }

  async function loadConfig(force = false): Promise<WebModelConfig | null> {
    if (!loaded.value || force) {
      config.value = await getRuntime().getConfig()
      loaded.value = true
    }
    return config.value
  }

  function testConnection(input?: SaveWebModelConfigInput): Promise<WebAIConnectionTestResult> {
    return getRuntime().testConnection(input)
  }

  async function saveConfig(input: SaveWebModelConfigInput): Promise<WebModelConfig> {
    config.value = await getRuntime().saveConfig(input)
    loaded.value = true
    return config.value
  }

  async function removeConfig(): Promise<void> {
    await getRuntime().clearConfig()
    config.value = null
    loaded.value = true
  }

  return {
    config,
    loaded,
    getRuntime,
    loadConfig,
    testConnection,
    saveConfig,
    removeConfig,
  }
})
