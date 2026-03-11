<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { sanitizeSummary } from '@/utils/sanitizeSummary'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const { locale } = storeToRefs(settingsStore)

// 弹窗状态
const showModal = ref(false)

// 加载状态
const isLoading = ref(false)
const loadError = ref<string | null>(null)

// 展开的版本
// 使用 Map 来跟踪每个版本的展开状态，undefined 表示使用默认状态
const expandedState = ref<Map<string, boolean>>(new Map())

// 当前软件版本（用于高亮显示和默认展开）
const currentAppVersion = ref<string | null>(null)

// 版本日志已读标记的 localStorage key
const CHANGELOG_READ_KEY = 'chatlab_changelog_read_version'
// 用户协议同意标记的 localStorage key
const AGREEMENT_KEY = 'chatlab_agreement_version'

// summary 的白名单配置（可按需扩展）
const SUMMARY_SANITIZE_OPTIONS = {
  allowedTags: ['br', 'a', 'img'],
  allowedAttrs: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
  },
}

// 切换版本展开/收起
function toggleVersion(version: string, index: number) {
  const currentState = isExpanded(version, index)
  expandedState.value.set(version, !currentState)
}

// 版本号统一格式，避免 v 前缀造成匹配失败
function normalizeVersion(version?: string | null) {
  return version ? version.trim().replace(/^v/i, '') : null
}

// 判断版本是否展开
function isExpanded(version: string, index: number) {
  // 如果有明确设置的状态，使用该状态
  if (expandedState.value.has(version)) {
    return expandedState.value.get(version)!
  }
  // 如果设置了当前软件版本，则当前版本默认展开
  if (currentAppVersion.value) {
    return isCurrentVersion(version)
  }
  // 否则，第一个版本默认展开，其他默认收起
  return index === 0
}

// 判断是否是当前软件版本
function isCurrentVersion(version: string) {
  const current = normalizeVersion(currentAppVersion.value)
  return current ? normalizeVersion(version) === current : false
}

// Changelog 数据结构
interface ChangelogItem {
  version: string
  date: string
  summary: string
  changes: {
    type: 'feat' | 'fix' | 'chore' | 'style'
    items: string[]
  }[]
}

// Changelog 数据
const changelogs = ref<ChangelogItem[]>([])

function getChangelogUrl(lang: string) {
  const langPathMap: Record<string, string> = {
    'zh-CN': 'cn',
    'zh-TW': 'tw',
    'en-US': 'en',
    'ja-JP': 'ja',
  }
  const langPath = langPathMap[lang] ?? 'en'
  return `https://chatlab.fun/${langPath}/changelogs.json`
}

// 从服务端获取 changelog 数据
async function fetchChangelogs() {
  isLoading.value = true
  loadError.value = null

  try {
    const result = await window.api.app.fetchRemoteConfig(getChangelogUrl(locale.value))
    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch')
    }
    changelogs.value = result.data as ChangelogItem[]
  } catch (error) {
    console.error('Failed to fetch changelogs:', error)
    loadError.value = t('home.changelog.loadError')
  } finally {
    isLoading.value = false
  }
}

// 监听语言变化，重新获取数据
watch(locale, () => {
  if (showModal.value && changelogs.value.length > 0) {
    fetchChangelogs()
  }
})

// 变更类型图标和颜色映射
const changeTypeConfig = {
  feat: {
    icon: 'i-heroicons-sparkles',
    color: 'text-green-500',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
  },
  fix: {
    icon: 'i-heroicons-wrench-screwdriver',
    color: 'text-amber-500',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
  },
  chore: {
    icon: 'i-heroicons-cog-6-tooth',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100 dark:bg-gray-700/30',
  },
  style: {
    icon: 'i-heroicons-paint-brush',
    color: 'text-blue-500',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
  },
}

// 获取变更类型显示名称
function getChangeTypeLabel(type: string) {
  const labels: Record<string, string> = {
    feat: t('home.changelog.types.feat'),
    fix: t('home.changelog.types.fix'),
    chore: t('home.changelog.types.chore'),
    style: t('home.changelog.types.style'),
  }
  return labels[type] || type
}

// 格式化日期
function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  if (locale.value === 'zh-CN') {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
  }
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// 标记当前版本为已读
function markVersionAsRead(version: string) {
  localStorage.setItem(CHANGELOG_READ_KEY, version)
}

// 检查是否需要显示新版本日志（冷启动时自动检查）
async function checkNewVersion() {
  try {
    // 0. 如果用户还没同意隐私协议，不检查更新日志（避免两个弹窗同时弹出）
    const acceptedAgreement = localStorage.getItem(AGREEMENT_KEY)
    if (!acceptedAgreement) {
      return
    }

    // 1. 获取当前软件版本号
    const rawVersion = await window.api.app.getVersion()
    const currentVersion = normalizeVersion(rawVersion)
    if (!currentVersion) return

    // 2. 获取 localStorage 中存储的已读版本号
    const rawReadVersion = localStorage.getItem(CHANGELOG_READ_KEY)
    const readVersion = normalizeVersion(rawReadVersion)

    // 2.1 如果是全新用户（从未设置过该 key），静默标记当前版本为已读，不弹窗
    if (rawReadVersion === null) {
      markVersionAsRead(currentVersion)
      return
    }

    // 3. 如果 readVersion 等于 currentVersion，说明用户已看过，不需要请求数据
    if (readVersion === currentVersion) {
      return
    }

    // 4. readVersion 为空或不等于 currentVersion，需要请求远程 changelog 数据
    const result = await window.api.app.fetchRemoteConfig(getChangelogUrl(locale.value))
    if (!result.success || !result.data) return

    const data = result.data as ChangelogItem[]
    const latestChangelogVersion = normalizeVersion(data[0]?.version)
    if (!latestChangelogVersion) return

    // 仅当“当前版本就是最新版本”时才弹窗
    // 避免当前版本较旧时（存在更高版本日志）也弹出阅读
    if (currentVersion !== latestChangelogVersion) {
      return
    }

    // 5. 在 changelog 中查找当前软件版本
    const currentVersionExists = data.some((log) => normalizeVersion(log.version) === currentVersion)

    // 如果在 changelog 中找不到当前版本，说明日志还没更新到当前版本，不显示弹窗
    if (!currentVersionExists) {
      return
    }

    // 6. 找到了当前版本，显示弹窗
    // 传入完整的 changelog 和当前版本号，让弹窗组件处理展开逻辑和标签显示
    // 延迟打开，等待其他弹窗（如迁移弹窗）检查完成
    setTimeout(() => {
      openWithData(data, currentVersion)
      // 打开后标记当前软件版本为已读
      markVersionAsRead(currentVersion)
    }, 500)
  } catch (error) {
    console.error('Failed to check new version:', error)
  }
}

// 暴露方法给父组件

// 手动打开弹窗（用户点击时调用），会自动获取数据
async function open() {
  // 手动打开也标记当前版本，避免标签缺失
  try {
    currentAppVersion.value = normalizeVersion(await window.api.app.getVersion())
  } catch {
    currentAppVersion.value = null
  }
  expandedState.value.clear()
  showModal.value = true
  // 打开时获取数据（如果还没有数据）
  if (changelogs.value.length === 0) {
    fetchChangelogs()
  }
}

// 使用预设数据打开弹窗（自动检查新版本时调用）
function openWithData(data: ChangelogItem[], appVersion?: string) {
  changelogs.value = data
  currentAppVersion.value = appVersion || null
  expandedState.value.clear() // 重置展开状态
  showModal.value = true
}

function close() {
  showModal.value = false
}

// 获取最新版本号（供外部使用）
function getLatestVersion() {
  return changelogs.value[0]?.version || null
}

// 组件挂载时检查新版本
onMounted(() => {
  checkNewVersion()
})

defineExpose({ open, openWithData, close, fetchChangelogs, getLatestVersion })
</script>

<template>
  <UModal :open="showModal" :ui="{ content: 'max-w-2xl' }" @update:open="showModal = $event">
    <template #content>
      <div class="flex max-h-[80vh] flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-pink-500 to-pink-600"
            >
              <UIcon name="i-heroicons-document-text" class="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ t('home.changelog.title') }}
              </h2>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('home.changelog.subtitle') }}
              </p>
            </div>
          </div>
          <UButton color="neutral" variant="ghost" icon="i-heroicons-x-mark" @click="close" />
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto px-6 py-4">
          <!-- Loading State -->
          <div v-if="isLoading" class="flex items-center justify-center py-12">
            <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-gray-400" />
          </div>

          <!-- Error State -->
          <div v-else-if="loadError" class="flex flex-col items-center justify-center py-12 text-center">
            <UIcon name="i-heroicons-exclamation-circle" class="h-10 w-10 text-red-400 mb-3" />
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ loadError }}</p>
            <UButton color="primary" variant="soft" size="sm" class="mt-3" @click="fetchChangelogs">
              {{ t('home.changelog.retry') }}
            </UButton>
          </div>

          <!-- Changelog List -->
          <div v-else class="space-y-6">
            <div v-for="(log, index) in changelogs" :key="log.version" class="relative">
              <!-- Timeline line -->
              <div
                v-if="index < changelogs.length - 1"
                class="absolute left-[15px] top-10 h-[calc(100%-20px)] w-[2px] bg-gray-200 dark:bg-gray-700"
              />

              <!-- Version header -->
              <div class="flex items-start gap-4">
                <!-- Version badge -->
                <div
                  class="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  :class="index === 0 ? 'bg-pink-500' : 'bg-gray-300 dark:bg-gray-600'"
                >
                  <UIcon
                    :name="index === 0 ? 'i-heroicons-star' : 'i-heroicons-tag'"
                    class="h-4 w-4"
                    :class="index === 0 ? 'text-white' : 'text-gray-600 dark:text-gray-300'"
                  />
                </div>

                <!-- Version info -->
                <div class="flex-1 pt-0.5">
                  <!-- Clickable header -->
                  <div class="cursor-pointer select-none" @click="toggleVersion(log.version, index)">
                    <div class="flex items-center gap-3">
                      <h3 class="text-base font-bold text-gray-900 dark:text-white">v{{ log.version }}</h3>
                      <span
                        v-if="index === 0"
                        class="rounded-full bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-600 dark:bg-pink-900/30 dark:text-pink-400"
                      >
                        {{ t('home.changelog.latest') }}
                      </span>
                      <!-- 当前软件版本标签 -->
                      <span
                        v-if="isCurrentVersion(log.version)"
                        class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-600 dark:bg-green-900/30 dark:text-green-400"
                      >
                        {{ t('home.changelog.current') }}
                      </span>
                      <!-- Expand/Collapse indicator -->
                      <UIcon
                        name="i-heroicons-chevron-down"
                        class="h-4 w-4 text-gray-400 transition-transform duration-200"
                        :class="{ 'rotate-180': isExpanded(log.version, index) }"
                      />
                    </div>
                    <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                      {{ formatDate(log.date) }}
                    </p>
                    <p
                      class="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300"
                      v-html="sanitizeSummary(log.summary, SUMMARY_SANITIZE_OPTIONS)"
                    />
                  </div>

                  <!-- Changes (collapsible) -->
                  <div v-show="isExpanded(log.version, index)" class="mt-3 space-y-3">
                    <div
                      v-for="change in log.changes"
                      :key="change.type"
                      class="rounded-lg border border-gray-100 bg-gray-50/50 p-3 dark:border-gray-700/50 dark:bg-gray-800/30"
                    >
                      <!-- Change type header -->
                      <div class="mb-2 flex items-center gap-2">
                        <div
                          class="flex h-5 w-5 items-center justify-center rounded"
                          :class="changeTypeConfig[change.type]?.bgColor"
                        >
                          <UIcon
                            :name="changeTypeConfig[change.type]?.icon"
                            class="h-3 w-3"
                            :class="changeTypeConfig[change.type]?.color"
                          />
                        </div>
                        <span class="text-xs font-medium text-gray-600 dark:text-gray-400">
                          {{ getChangeTypeLabel(change.type) }}
                        </span>
                      </div>
                      <!-- Change items -->
                      <ul class="space-y-1.5 pl-7">
                        <li
                          v-for="(item, idx) in change.items"
                          :key="idx"
                          class="relative text-sm text-gray-600 dark:text-gray-400"
                        >
                          <span class="absolute -left-4 top-2 h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                          {{ item }}
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <div class="flex items-center justify-between">
            <p v-if="changelogs.length > 0" class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('home.changelog.total', { count: changelogs.length }) }}
            </p>
            <span v-else />
            <UButton color="primary" variant="soft" @click="close">
              {{ t('home.changelog.close') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
