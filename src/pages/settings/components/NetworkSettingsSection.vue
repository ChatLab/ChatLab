<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// 代理模式类型
type ProxyMode = 'off' | 'system' | 'manual'

// 代理配置
const proxyMode = ref<ProxyMode>('system')
const proxyUrl = ref('')
const proxyUrlError = ref('')
const isSavingProxy = ref(false)
const isTestingProxy = ref(false)
const proxyTestResult = ref<{ success: boolean; message: string } | null>(null)

// 代理模式选项
const proxyModeOptions = computed(() => [
  { label: t('settings.basic.network.modeOff'), value: 'off' },
  { label: t('settings.basic.network.modeSystem'), value: 'system' },
  { label: t('settings.basic.network.modeManual'), value: 'manual' },
])

// 加载代理配置
async function loadProxyConfig() {
  try {
    const config = await window.networkApi.getProxyConfig()
    proxyMode.value = config.mode || 'system'
    proxyUrl.value = config.url || ''
  } catch (error) {
    console.error('获取代理配置失败:', error)
  }
}

// 验证代理 URL 格式
function validateProxyUrl(url: string): boolean {
  if (!url) {
    proxyUrlError.value = ''
    return true
  }

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      proxyUrlError.value = t('settings.basic.network.onlyHttpSupported')
      return false
    }
    proxyUrlError.value = ''
    return true
  } catch {
    proxyUrlError.value = t('settings.basic.network.invalidProxyUrl')
    return false
  }
}

// 保存代理配置
async function saveProxyConfig() {
  // 清除测试结果
  proxyTestResult.value = null

  // 如果是手动模式但没填地址
  if (proxyMode.value === 'manual' && !proxyUrl.value.trim()) {
    proxyUrlError.value = t('settings.basic.network.enterProxyFirst')
    return
  }

  // 验证格式
  if (proxyMode.value === 'manual' && !validateProxyUrl(proxyUrl.value)) {
    return
  }

  isSavingProxy.value = true
  try {
    const result = await window.networkApi.saveProxyConfig({
      mode: proxyMode.value,
      url: proxyUrl.value.trim(),
    })

    if (!result.success) {
      proxyUrlError.value = result.error || t('settings.basic.network.saveFailed')
    }
  } catch (error) {
    console.error('保存代理配置失败:', error)
    proxyUrlError.value = t('settings.basic.network.saveFailed')
  } finally {
    isSavingProxy.value = false
  }
}

// 切换代理模式
async function handleProxyModeChange(mode: string | number) {
  const newMode = mode as ProxyMode
  proxyMode.value = newMode
  proxyTestResult.value = null
  proxyUrlError.value = ''

  // 非手动模式时立即保存
  if (newMode !== 'manual') {
    await saveProxyConfig()
  }
}

// 代理地址输入处理
function handleProxyUrlInput() {
  proxyTestResult.value = null
  if (proxyUrl.value) {
    validateProxyUrl(proxyUrl.value)
  } else {
    proxyUrlError.value = ''
  }
}

// 代理地址失去焦点时保存
async function handleProxyUrlBlur() {
  if (proxyMode.value === 'manual' && proxyUrl.value.trim()) {
    await saveProxyConfig()
  }
}

// 测试代理连接
async function testProxyConnection() {
  if (!proxyUrl.value.trim()) {
    proxyUrlError.value = t('settings.basic.network.enterProxyFirst')
    return
  }

  if (!validateProxyUrl(proxyUrl.value)) {
    return
  }

  isTestingProxy.value = true
  proxyTestResult.value = null

  try {
    const result = await window.networkApi.testProxyConnection(proxyUrl.value.trim())
    proxyTestResult.value = {
      success: result.success,
      message: result.success
        ? t('settings.basic.network.connectionSuccess')
        : result.error || t('settings.basic.network.connectionFailed'),
    }
  } catch (error) {
    proxyTestResult.value = {
      success: false,
      message:
        t('settings.basic.network.connectionFailed') + ': ' + (error instanceof Error ? error.message : String(error)),
    }
  } finally {
    isTestingProxy.value = false
  }
}

// 组件挂载时加载数据
onMounted(() => {
  loadProxyConfig()
})
</script>

<template>
  <div>
    <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
      <UIcon name="i-heroicons-globe-alt" class="h-4 w-4 text-cyan-500" />
      {{ t('settings.basic.network.title') }}
    </h3>
    <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <!-- 代理模式选择 -->
      <div class="flex items-center justify-between">
        <div class="flex-1 pr-4">
          <p class="text-sm font-medium text-gray-900 dark:text-white">{{ t('settings.basic.network.proxyMode') }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.basic.network.proxyModeDesc') }}</p>
        </div>
        <div class="w-64">
          <UTabs
            :model-value="proxyMode"
            size="sm"
            class="gap-0"
            :items="proxyModeOptions"
            @update:model-value="handleProxyModeChange"
          />
        </div>
      </div>

      <!-- 手动配置时显示代理地址输入 -->
      <div v-if="proxyMode === 'manual'" class="mt-4 space-y-3">
        <div>
          <label class="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {{ t('settings.basic.network.proxyAddress') }}
          </label>
          <UInput
            v-model="proxyUrl"
            :placeholder="t('settings.basic.network.proxyPlaceholder')"
            :color="proxyUrlError ? 'error' : 'neutral'"
            size="sm"
            class="w-full"
            @input="handleProxyUrlInput"
            @blur="handleProxyUrlBlur"
          />
          <p v-if="proxyUrlError" class="mt-1 text-xs text-red-500">
            {{ proxyUrlError }}
          </p>
          <p v-else class="mt-1 text-xs text-gray-400">{{ t('settings.basic.network.proxyHelp') }}</p>
        </div>

        <!-- 测试连接按钮和结果 -->
        <div class="flex items-center gap-3">
          <UButton
            :loading="isTestingProxy"
            :disabled="isTestingProxy || !proxyUrl.trim()"
            color="neutral"
            variant="soft"
            size="sm"
            @click="testProxyConnection"
          >
            <UIcon name="i-heroicons-signal" class="mr-1 h-4 w-4" />
            {{ isTestingProxy ? t('settings.basic.network.testing') : t('settings.basic.network.testConnection') }}
          </UButton>

          <div v-if="proxyTestResult" class="flex items-center gap-1.5">
            <UIcon
              :name="proxyTestResult.success ? 'i-heroicons-check-circle' : 'i-heroicons-x-circle'"
              :class="['h-4 w-4', proxyTestResult.success ? 'text-green-500' : 'text-red-500']"
            />
            <span
              :class="[
                'text-xs',
                proxyTestResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
              ]"
            >
              {{ proxyTestResult.message }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
