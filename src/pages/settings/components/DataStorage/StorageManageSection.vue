<script setup lang="ts">
/**
 * 存储管理区块
 * 显示本地缓存目录信息及清理功能
 */
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// 缓存目录信息类型
interface CacheDirectoryInfo {
  id: string
  name: string
  description: string
  path: string
  icon: string
  canClear: boolean
  size: number
  fileCount: number
  exists: boolean
}

interface CacheInfo {
  baseDir: string
  directories: CacheDirectoryInfo[]
  totalSize: number
}

// 状态
const cacheInfo = ref<CacheInfo | null>(null)
const isLoading = ref(false)
const clearingId = ref<string | null>(null)
const dataDir = ref('')
const isCustomDataDir = ref(false)
const isUpdatingDataDir = ref(false)
const dataDirError = ref<string | null>(null)

// 确认弹窗状态
const showConfirmModal = ref(false)
const pendingNewDir = ref<string | null>(null)
const pendingMigrate = ref(false)

// 重启弹窗状态
const showRelaunchModal = ref(false)

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)
  return `${size} ${units[i]}`
}

// 计算总大小
const totalSizeFormatted = computed(() => {
  if (!cacheInfo.value) return '0 B'
  return formatSize(cacheInfo.value.totalSize)
})

// 加载缓存信息
async function loadCacheInfo() {
  isLoading.value = true
  try {
    cacheInfo.value = await window.cacheApi.getInfo()
  } catch (error) {
    console.error('获取缓存信息失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 加载数据目录
async function loadDataDir() {
  try {
    const info = await window.cacheApi.getDataDir()
    dataDir.value = info.path
    isCustomDataDir.value = info.isCustom
  } catch (error) {
    console.error('获取数据目录失败:', error)
  }
}

// 清理缓存
async function clearCache(cacheId: string) {
  clearingId.value = cacheId
  try {
    const result = await window.cacheApi.clear(cacheId)
    if (result.success) {
      // 刷新缓存信息
      await loadCacheInfo()
    } else {
      console.error('清理缓存失败:', result.error)
    }
  } catch (error) {
    console.error('清理缓存失败:', error)
  } finally {
    clearingId.value = null
  }
}

// 打开目录
async function openDirectory(cacheId: string) {
  try {
    await window.cacheApi.openDir(cacheId)
  } catch (error) {
    console.error('打开目录失败:', error)
  }
}

// 打开数据根目录
async function openBaseDir() {
  await openDirectory('base')
}

// 选择数据目录
async function selectDataDir() {
  dataDirError.value = null
  try {
    const result = await window.cacheApi.selectDataDir()
    if (!result.success || !result.path) return

    // 显示确认弹窗
    pendingNewDir.value = result.path
    pendingMigrate.value = true
    showConfirmModal.value = true
  } catch (error) {
    dataDirError.value = error instanceof Error ? error.message : String(error)
  }
}

// 恢复默认数据目录
async function resetDataDir() {
  dataDirError.value = null
  // 显示确认弹窗
  pendingNewDir.value = null
  pendingMigrate.value = true
  showConfirmModal.value = true
}

// 确认切换数据目录
async function confirmDataDirChange() {
  showConfirmModal.value = false
  await applyDataDirChange(pendingNewDir.value, pendingMigrate.value)
}

// 取消切换
function cancelDataDirChange() {
  showConfirmModal.value = false
  pendingNewDir.value = null
  pendingMigrate.value = false
}

// 应用数据目录变更
async function applyDataDirChange(newDir: string | null, migrate: boolean) {
  isUpdatingDataDir.value = true
  try {
    const result = await window.cacheApi.setDataDir(newDir, migrate)
    if (!result.success) {
      dataDirError.value = result.error || '设置失败'
      return
    }

    // 迁移成功，显示强制重启弹窗
    showRelaunchModal.value = true
  } catch (error) {
    dataDirError.value = error instanceof Error ? error.message : String(error)
  } finally {
    isUpdatingDataDir.value = false
  }
}

// 重启应用
async function relaunchApp() {
  await window.api.app.relaunch()
}

// 组件挂载时加载数据
onMounted(() => {
  loadCacheInfo()
  loadDataDir()
})

// 暴露刷新方法
defineExpose({
  refresh: loadCacheInfo,
})
</script>

<template>
  <div class="space-y-6">
    <!-- 标题和总览 -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <UIcon name="i-heroicons-folder-open" class="h-4 w-4 text-amber-500" />
          {{ t('settings.storage.title') }}
        </h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('settings.storage.description') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <!-- 总大小 -->
        <div class="rounded-lg bg-gray-100 px-3 py-1.5 dark:bg-gray-800">
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.storage.totalUsage') }}</span>
          <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ totalSizeFormatted }}</span>
        </div>
        <!-- 刷新按钮 -->
        <UButton icon="i-heroicons-arrow-path" variant="ghost" size="sm" :loading="isLoading" @click="loadCacheInfo" />
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoading && !cacheInfo" class="flex items-center justify-center py-8">
      <UIcon name="i-heroicons-arrow-path" class="h-5 w-5 animate-spin text-gray-400" />
      <span class="ml-2 text-sm text-gray-500">{{ t('settings.storage.loading') }}</span>
    </div>

    <!-- 缓存目录列表 -->
    <div v-else-if="cacheInfo" class="space-y-2">
      <div
        v-for="dir in cacheInfo.directories"
        :key="dir.id"
        class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:bg-gray-800"
      >
        <div class="flex items-center justify-between">
          <!-- 左侧信息 -->
          <div class="flex items-center gap-3">
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              :class="{
                'bg-green-100 dark:bg-green-900/30': dir.id === 'databases',
                'bg-violet-100 dark:bg-violet-900/30': dir.id === 'ai',
                'bg-amber-100 dark:bg-amber-900/30': dir.id === 'downloads',
                'bg-blue-100 dark:bg-blue-900/30': dir.id === 'logs',
              }"
            >
              <UIcon
                :name="dir.icon"
                class="h-4 w-4"
                :class="{
                  'text-green-600 dark:text-green-400': dir.id === 'databases',
                  'text-violet-600 dark:text-violet-400': dir.id === 'ai',
                  'text-amber-600 dark:text-amber-400': dir.id === 'downloads',
                  'text-blue-600 dark:text-blue-400': dir.id === 'logs',
                }"
              />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h4 class="text-sm font-medium text-gray-900 dark:text-white">{{ t(dir.name) }}</h4>
                <UBadge v-if="!dir.exists" variant="soft" color="gray" size="xs">
                  {{ t('settings.storage.notExist') }}
                </UBadge>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ t(dir.description) }}</p>
            </div>
          </div>

          <!-- 右侧信息和操作按钮 -->
          <div class="flex items-center">
            <!-- 文件数和大小（固定宽度对齐） -->
            <div class="flex items-center gap-2 text-xs text-gray-400">
              <span class="w-14 text-right">{{ dir.fileCount }} {{ t('settings.storage.files') }}</span>
              <span class="w-16 text-right">{{ formatSize(dir.size) }}</span>
            </div>
            <!-- 操作按钮（固定宽度） -->
            <div class="ml-4 flex w-36 shrink-0 items-center justify-end gap-1">
              <UButton
                v-if="dir.canClear && dir.size > 0"
                icon="i-heroicons-trash"
                variant="soft"
                color="red"
                size="xs"
                :loading="clearingId === dir.id"
                :disabled="clearingId !== null"
                @click="clearCache(dir.id)"
              >
                {{ t('settings.storage.clear') }}
              </UButton>
              <UButton icon="i-heroicons-folder-open" variant="ghost" size="xs" @click="openDirectory(dir.id)">
                {{ t('settings.storage.open') }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 数据目录设置 -->
    <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ t('settings.storage.dataLocation.title') }}
          </p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.storage.dataLocation.description') }}
          </p>
        </div>
        <div class="shrink-0">
          <UButton icon="i-heroicons-folder-open" variant="ghost" size="xs" @click="openBaseDir">
            {{ t('settings.storage.dataLocation.open') }}
          </UButton>
        </div>
      </div>

      <div class="mt-3 flex items-center gap-2">
        <UInput v-model="dataDir" readonly size="sm" class="min-w-0 flex-1" />
        <UButton
          size="sm"
          variant="soft"
          :loading="isUpdatingDataDir"
          :disabled="isUpdatingDataDir"
          @click="selectDataDir"
        >
          {{ t('settings.storage.dataLocation.choose') }}
        </UButton>
        <UButton v-if="isCustomDataDir" size="sm" variant="ghost" :disabled="isUpdatingDataDir" @click="resetDataDir">
          {{ t('settings.storage.dataLocation.reset') }}
        </UButton>
      </div>

      <p class="mt-2 text-xs text-amber-600 dark:text-amber-400">
        {{ t('settings.storage.dataLocation.restartTip') }}
      </p>
      <p v-if="dataDirError" class="mt-1 text-xs text-red-500">
        {{ dataDirError }}
      </p>
    </div>

    <!-- 提示信息 -->
    <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/20">
      <div class="flex items-start gap-2">
        <UIcon name="i-heroicons-exclamation-triangle" class="h-4 w-4 shrink-0 text-amber-500" />
        <div class="text-xs text-amber-700 dark:text-amber-400">
          <p class="font-medium">{{ t('settings.storage.notes.title') }}</p>
          <ul class="mt-1 list-inside list-disc space-y-0.5 text-amber-600 dark:text-amber-500">
            <li>{{ t('settings.storage.notes.logSafe') }}</li>
            <li>{{ t('settings.storage.notes.noRecover') }}</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 切换数据目录确认弹窗 -->
    <UModal v-model:open="showConfirmModal">
      <template #content>
        <div class="p-5">
          <div class="mb-4 flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <UIcon name="i-heroicons-exclamation-triangle" class="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('settings.storage.dataLocation.confirmTitle') }}
            </h3>
          </div>

          <div class="space-y-3 text-sm text-gray-600 dark:text-gray-400">
            <p>{{ t('settings.storage.dataLocation.confirmMessage') }}</p>
            <div class="rounded-lg bg-gray-100 p-3 dark:bg-gray-800">
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('settings.storage.dataLocation.newPath') }}
              </p>
              <p class="mt-1 font-mono text-sm text-gray-900 dark:text-white">
                {{ pendingNewDir || t('settings.storage.dataLocation.defaultPath') }}
              </p>
            </div>
            <div
              class="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/20"
            >
              <p class="text-xs text-amber-700 dark:text-amber-400">
                {{ t('settings.storage.dataLocation.confirmWarning') }}
              </p>
            </div>
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <UButton variant="ghost" @click="cancelDataDirChange">
              {{ t('settings.storage.dataLocation.cancel') }}
            </UButton>
            <UButton color="primary" @click="confirmDataDirChange">
              {{ t('settings.storage.dataLocation.confirm') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 迁移成功后强制重启弹窗 -->
    <UModal v-model:open="showRelaunchModal" :dismissible="false">
      <template #content>
        <div class="p-5">
          <div class="mb-4 flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <UIcon name="i-heroicons-check-circle" class="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('settings.storage.dataLocation.migrationSuccessTitle') }}
            </h3>
          </div>

          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t('settings.storage.dataLocation.migrationSuccessMessage') }}
          </p>

          <div class="mt-5 flex justify-end">
            <UButton color="primary" @click="relaunchApp">
              {{ t('settings.storage.dataLocation.relaunchNow') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
