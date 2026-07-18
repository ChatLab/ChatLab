<script setup lang="ts">
/**
 * 存储管理区块
 * 显示本地缓存目录信息及清理功能
 */
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlatformService } from '@/services'
import { IS_ELECTRON } from '@/utils/platform'
import { useCacheService } from '@/services/cache/service'
import type { CacheInfo, DataDirCleanupInfo } from '@/services/cache/types'
import { clearMigrateHintIgnore, isMigrateHintIgnoredForDir, writeMigrateHintIgnore } from './migrateHintIgnore'

const { t } = useI18n()

// 状态
const cacheInfo = ref<CacheInfo | null>(null)
const isLoading = ref(false)
const clearingId = ref<string | null>(null)
const dataDir = ref('')
const dataDirInput = ref('')
const defaultDataDir = ref('')
const dataDirManagedDescription = ref('settings.storage.dataLocation.managedDescription')
const hasLegacyDataAtDefaultDir = ref(false)
const isCustomDataDir = ref(false)
const canSetDataDir = ref(false)
const isUpdatingDataDir = ref(false)
const dataDirError = ref<string | null>(null)
const isMigrateHintIgnored = ref(false)
const pendingCleanups = ref<DataDirCleanupInfo[]>([])
const cleanupToDelete = ref<DataDirCleanupInfo | null>(null)
const deletingCleanupId = ref<string | null>(null)
const showCleanupDeleteModal = ref(false)

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
    cacheInfo.value = await useCacheService().getInfo()
  } catch (error) {
    console.error('获取缓存信息失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 加载数据目录
const showDataDirSettings = computed(() => {
  return IS_ELECTRON || canSetDataDir.value || Boolean(dataDir.value)
})

const canMigrateToDefault = computed(() => {
  return (
    showDataDirSettings.value &&
    dataDir.value &&
    defaultDataDir.value &&
    dataDir.value !== defaultDataDir.value &&
    hasLegacyDataAtDefaultDir.value &&
    !isMigrateHintIgnored.value
  )
})

function updateMigrateHintIgnored() {
  if (!dataDir.value || !defaultDataDir.value) {
    isMigrateHintIgnored.value = false
    return
  }

  try {
    isMigrateHintIgnored.value = isMigrateHintIgnoredForDir(localStorage, dataDir.value)
  } catch {
    isMigrateHintIgnored.value = false
  }
}

async function loadDataDir() {
  try {
    const info = await useCacheService().getDataDir()
    dataDir.value = info.path
    dataDirInput.value = info.pendingMigration?.to || info.path
    defaultDataDir.value = info.defaultPath || ''
    dataDirManagedDescription.value = info.managedDescription || 'settings.storage.dataLocation.managedDescription'
    hasLegacyDataAtDefaultDir.value = Boolean(info.hasLegacyDataAtDefaultDir)
    isCustomDataDir.value = info.isCustom
    canSetDataDir.value = IS_ELECTRON || Boolean(info.canSetDataDir)
    pendingCleanups.value = info.pendingCleanups ?? []
    updateMigrateHintIgnored()
  } catch (error) {
    console.error('获取数据目录失败:', error)
  }
}

// 清理缓存
async function clearCache(cacheId: string) {
  clearingId.value = cacheId
  try {
    const result = await useCacheService().clear(cacheId)
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
    await useCacheService().openDir(cacheId)
  } catch (error) {
    console.error('打开目录失败:', error)
  }
}

// 打开数据根目录
async function openBaseDir() {
  await openDirectory('base')
}

async function openUserDataDir() {
  await openDirectory('userData')
}

async function openCleanupDir(cleanupId: string) {
  try {
    await useCacheService().openDataDirCleanup(cleanupId)
  } catch (error) {
    dataDirError.value = error instanceof Error ? error.message : String(error)
  }
}

function requestCleanupDelete(cleanup: DataDirCleanupInfo) {
  cleanupToDelete.value = cleanup
  showCleanupDeleteModal.value = true
}

async function confirmCleanupDelete() {
  const cleanup = cleanupToDelete.value
  if (!cleanup) return

  deletingCleanupId.value = cleanup.id
  try {
    const result = await useCacheService().deleteDataDirCleanup(cleanup.id)
    if (!result.success) {
      dataDirError.value = result.error || t('settings.storage.dataLocation.cleanupDeleteFailed')
      return
    }
    showCleanupDeleteModal.value = false
    cleanupToDelete.value = null
    await Promise.all([loadDataDir(), loadCacheInfo()])
  } catch (error) {
    dataDirError.value = error instanceof Error ? error.message : String(error)
  } finally {
    deletingCleanupId.value = null
  }
}

// 选择数据目录
async function selectDataDir() {
  dataDirError.value = null
  try {
    const result = await window.cacheApi.selectDataDir()
    if (!result.success || !result.path) {
      if (result.error === 'INSTALL_DIR_FORBIDDEN') {
        dataDirError.value = t('settings.storage.dataLocation.installDirForbidden')
      }
      return
    }

    // 显示确认弹窗
    pendingNewDir.value = result.path
    pendingMigrate.value = true
    showConfirmModal.value = true
  } catch (error) {
    dataDirError.value = error instanceof Error ? error.message : String(error)
  }
}

async function resetDataDir() {
  dataDirError.value = null
  pendingNewDir.value = null
  pendingMigrate.value = true
  showConfirmModal.value = true
}

function migrateToDefaultDir() {
  dataDirError.value = null
  pendingNewDir.value = null
  pendingMigrate.value = true
  showConfirmModal.value = true
}

function applyTypedDataDir() {
  dataDirError.value = null
  const targetDir = dataDirInput.value.trim()
  if (!targetDir) {
    dataDirError.value = t('settings.storage.dataLocation.pathRequired')
    return
  }
  pendingNewDir.value = targetDir
  pendingMigrate.value = true
  showConfirmModal.value = true
}

function ignoreMigrateHint() {
  if (!dataDir.value || !defaultDataDir.value) return

  try {
    writeMigrateHintIgnore(localStorage, dataDir.value)
  } catch {
    // localStorage 不可用时只在当前页面隐藏，避免阻塞用户继续使用设置页。
  }
  isMigrateHintIgnored.value = true
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
    const result = IS_ELECTRON
      ? await window.cacheApi.setDataDir(newDir, migrate)
      : await useCacheService().setDataDir(newDir, migrate)
    if (!result.success) {
      dataDirError.value = result.error || '设置失败'
      return
    }

    if (result.requiresRelaunch !== false) {
      try {
        clearMigrateHintIgnore(localStorage)
      } catch {
        // localStorage 清理失败不影响目录切换，下一次加载时仍会按当前内存状态处理。
      }
    }

    if (result.requiresRelaunch === false) {
      await loadDataDir()
      return
    }

    // 已登记重启期迁移任务，重启后会在数据库服务启动前执行
    showRelaunchModal.value = true
  } catch (error) {
    dataDirError.value = error instanceof Error ? error.message : String(error)
  } finally {
    isUpdatingDataDir.value = false
  }
}

// 重启应用
async function relaunchApp() {
  if (IS_ELECTRON) {
    await usePlatformService().relaunch()
    return
  }
  showRelaunchModal.value = false
}

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
        <UButton
          v-if="cacheInfo?.baseDir"
          icon="i-heroicons-folder-open"
          variant="ghost"
          size="sm"
          @click="openBaseDir"
        >
          {{ t('settings.storage.openRootDir') }}
        </UButton>
        <!-- 总大小 -->
        <div class="rounded-lg bg-gray-100 px-3 py-1.5 dark:bg-gray-800">
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.storage.totalUsage') }}</span>
          <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ totalSizeFormatted }}</span>
        </div>
        <!-- 刷新按钮 -->
        <UButton icon="i-heroicons-arrow-path" variant="ghost" size="sm" :loading="isLoading" @click="loadCacheInfo" />
      </div>
    </div>

    <!-- 迁移后的旧目录需要用户确认清理，置顶展示以避免被普通存储项淹没。 -->
    <div
      v-if="pendingCleanups.length > 0"
      class="rounded-lg border border-gray-200 border-l-2 border-l-primary-400 bg-gray-50 px-3 py-3 dark:border-gray-700 dark:border-l-primary-500 dark:bg-gray-800/50"
    >
      <div class="flex items-start gap-3">
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-600 dark:bg-primary-900/50 dark:text-primary-300"
        >
          <UIcon name="i-heroicons-archive-box" class="h-4 w-4" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-gray-900 dark:text-white">
            {{ t('settings.storage.dataLocation.cleanupTitle') }}
          </p>
          <p class="mt-0.5 text-xs leading-5 text-gray-600 dark:text-gray-400">
            {{ t('settings.storage.dataLocation.cleanupDescription') }}
          </p>
        </div>
      </div>

      <div class="mt-2.5 divide-y divide-gray-200 pl-11 dark:divide-gray-700">
        <div
          v-for="cleanup in pendingCleanups"
          :key="cleanup.id"
          class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate font-mono text-xs text-gray-700 dark:text-gray-300" :title="cleanup.sourceDir">
              {{ cleanup.sourceDir }}
            </p>
            <p class="mt-0.5 text-xs text-gray-400">
              {{ cleanup.exists ? formatSize(cleanup.size) : t('settings.storage.notExist') }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <UButton
              icon="i-heroicons-folder-open"
              variant="ghost"
              size="xs"
              :disabled="!cleanup.exists || deletingCleanupId !== null"
              @click="openCleanupDir(cleanup.id)"
            >
              {{ t('settings.storage.dataLocation.open') }}
            </UButton>
            <UButton
              icon="i-heroicons-trash"
              color="red"
              variant="soft"
              size="xs"
              :loading="deletingCleanupId === cleanup.id"
              :disabled="deletingCleanupId !== null"
              @click="requestCleanupDelete(cleanup)"
            >
              {{ t('settings.storage.dataLocation.cleanupDeleteAction') }}
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoading && !cacheInfo" class="flex items-center justify-center py-8">
      <UIcon name="i-heroicons-arrow-path" class="h-5 w-5 animate-spin text-gray-400" />
      <span class="ml-2 text-sm text-gray-500">{{ t('settings.storage.loading') }}</span>
    </div>

    <!-- 缓存目录列表 -->
    <div
      v-else-if="cacheInfo"
      class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"
    >
      <div class="divide-y divide-gray-200 dark:divide-gray-700">
        <div
          v-for="dir in cacheInfo.directories"
          :key="dir.id"
          class="group flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-gray-100/50 dark:hover:bg-gray-700/30"
        >
          <div class="flex min-w-0 items-center gap-3">
            <div
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
            >
              <UIcon :name="dir.icon" class="h-3.5 w-3.5" />
            </div>
            <div class="flex min-w-0 items-center gap-2">
              <span class="w-32 shrink-0 truncate text-sm font-medium text-gray-900 dark:text-white">
                {{ t(dir.name) }}
              </span>
              <span class="flex min-w-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span class="truncate">{{ t(dir.description) }}</span>
                <UBadge v-if="!dir.exists" color="neutral" variant="subtle" size="xs">
                  {{ t('settings.storage.notExist') }}
                </UBadge>
              </span>
            </div>
          </div>

          <div class="ml-4 flex shrink-0 items-center gap-3">
            <div class="flex items-center gap-1.5 text-xs text-gray-400 tabular-nums">
              <span class="w-20 text-right">{{ dir.fileCount }} {{ t('settings.storage.files') }}</span>
              <span>·</span>
              <span class="w-16 text-right">{{ formatSize(dir.size) }}</span>
            </div>
            <div class="flex w-16 shrink-0 items-center justify-end gap-1">
              <UButton
                icon="i-heroicons-folder-open"
                color="neutral"
                variant="ghost"
                size="xs"
                class="hover:bg-gray-200/80 dark:hover:bg-gray-700"
                :aria-label="t('settings.storage.open')"
                :title="t('settings.storage.open')"
                @click="openDirectory(dir.id)"
              />
              <UButton
                v-if="dir.canClear && dir.size > 0"
                icon="i-heroicons-trash"
                color="error"
                variant="ghost"
                size="xs"
                :loading="clearingId === dir.id"
                :disabled="clearingId !== null"
                :aria-label="t('settings.storage.clear')"
                :title="t('settings.storage.clear')"
                @click="clearCache(dir.id)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 数据目录设置 -->
    <template v-if="showDataDirSettings">
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.storage.dataLocation.title') }}
            </p>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.storage.dataLocation.description') }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ t(dataDirManagedDescription) }}
            </p>
          </div>
          <div class="shrink-0">
            <UButton icon="i-heroicons-folder-open" variant="ghost" size="xs" @click="openUserDataDir">
              {{ t('settings.storage.dataLocation.open') }}
            </UButton>
          </div>
        </div>

        <div class="mt-3 flex items-center gap-2">
          <UInput v-model="dataDirInput" :readonly="IS_ELECTRON || !canSetDataDir" size="sm" class="min-w-0 flex-1" />
          <UButton
            v-if="IS_ELECTRON"
            size="sm"
            variant="soft"
            :loading="isUpdatingDataDir"
            :disabled="isUpdatingDataDir"
            @click="selectDataDir"
          >
            {{ t('settings.storage.dataLocation.choose') }}
          </UButton>
          <UButton
            v-else-if="canSetDataDir"
            size="sm"
            variant="soft"
            :loading="isUpdatingDataDir"
            :disabled="isUpdatingDataDir || !dataDirInput.trim()"
            @click="applyTypedDataDir"
          >
            {{ t('settings.storage.dataLocation.applyPath') }}
          </UButton>
          <UButton v-if="isCustomDataDir" size="sm" variant="ghost" :disabled="isUpdatingDataDir" @click="resetDataDir">
            {{ t('settings.storage.dataLocation.reset') }}
          </UButton>
        </div>
        <p v-if="!IS_ELECTRON && canSetDataDir" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {{ t('settings.storage.dataLocation.serverPathHint') }}
        </p>

        <!-- 一键迁移到默认路径 -->
        <div
          v-if="canMigrateToDefault"
          class="mt-3 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800/50 dark:bg-blue-900/20"
        >
          <div>
            <p class="text-xs font-medium text-blue-700 dark:text-blue-300">
              {{ t('settings.storage.dataLocation.migrateHint') }}
            </p>
            <p class="mt-0.5 font-mono text-xs text-blue-600 dark:text-blue-400">
              {{ defaultDataDir }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <UButton size="sm" variant="ghost" :disabled="isUpdatingDataDir" @click="ignoreMigrateHint">
              {{ t('settings.storage.dataLocation.ignoreMigrateHint') }}
            </UButton>
            <UButton
              size="sm"
              color="primary"
              variant="soft"
              :loading="isUpdatingDataDir"
              :disabled="isUpdatingDataDir"
              @click="migrateToDefaultDir"
            >
              {{ t('settings.storage.dataLocation.migrateAction') }}
            </UButton>
          </div>
        </div>

        <p class="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {{
            IS_ELECTRON
              ? t('settings.storage.dataLocation.restartTip')
              : t('settings.storage.dataLocation.cliRestartTip')
          }}
        </p>
        <p v-if="dataDirError" class="mt-1 text-xs text-red-500">
          {{ dataDirError }}
        </p>
      </div>

      <!-- 切换数据目录确认弹窗 -->
      <UModal v-model:open="showConfirmModal" :ui="{ content: 'z-[101]', overlay: 'z-[100]' }">
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
                  {{
                    IS_ELECTRON
                      ? t('settings.storage.dataLocation.confirmWarning')
                      : t('settings.storage.dataLocation.cliConfirmWarning')
                  }}
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

      <UModal v-model:open="showCleanupDeleteModal" :ui="{ content: 'sm:max-w-[500px] z-[103]', overlay: 'z-[102]' }">
        <template #content>
          <div class="p-5">
            <div class="flex items-start gap-3">
              <div
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
              >
                <UIcon name="i-heroicons-trash" class="h-5 w-5" />
              </div>
              <div class="min-w-0 flex-1">
                <h3 class="text-base font-semibold text-gray-900 dark:text-white">
                  {{ t('settings.storage.dataLocation.cleanupDeleteConfirmTitle') }}
                </h3>
                <p class="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">
                  {{ t('settings.storage.dataLocation.cleanupDeleteConfirmDescription') }}
                </p>
              </div>
            </div>

            <div v-if="cleanupToDelete" class="mt-4 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/60">
              <p class="break-all font-mono text-xs text-gray-700 dark:text-gray-300">
                {{ cleanupToDelete.sourceDir }}
              </p>
            </div>

            <div class="mt-5 flex justify-end gap-2">
              <UButton variant="ghost" :disabled="deletingCleanupId !== null" @click="showCleanupDeleteModal = false">
                {{ t('common.cancel') }}
              </UButton>
              <UButton color="red" :loading="deletingCleanupId !== null" @click="confirmCleanupDelete">
                {{ t('settings.storage.dataLocation.cleanupDeleteConfirmAction') }}
              </UButton>
            </div>
          </div>
        </template>
      </UModal>

      <!-- 迁移成功后强制重启弹窗 -->
      <UModal v-model:open="showRelaunchModal" :dismissible="false" :ui="{ content: 'z-[101]', overlay: 'z-[100]' }">
        <template #content>
          <div class="p-5">
            <div class="mb-4 flex items-center gap-3">
              <div class="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <UIcon name="i-heroicons-check-circle" class="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ t('settings.storage.dataLocation.migrationQueuedTitle') }}
              </h3>
            </div>

            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{
                IS_ELECTRON
                  ? t('settings.storage.dataLocation.migrationSuccessMessage')
                  : t('settings.storage.dataLocation.cliMigrationSuccessMessage')
              }}
            </p>

            <div class="mt-5 flex justify-end">
              <UButton color="primary" @click="relaunchApp">
                {{
                  IS_ELECTRON
                    ? t('settings.storage.dataLocation.relaunchNow')
                    : t('settings.storage.dataLocation.acknowledge')
                }}
              </UButton>
            </div>
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
