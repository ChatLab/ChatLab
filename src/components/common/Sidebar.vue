<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { shouldEnableContactsEntry } from '@openchatlab/core'
import type { AnalysisSession } from '@/types/base'
import LazyAvatar from '@/components/common/avatar/LazyAvatar.vue'
import SidebarButton from './sidebar/SidebarButton.vue'
import SidebarFooter from './sidebar/SidebarFooter.vue'
import SidebarSortPopover from './sidebar/SidebarSortPopover.vue'
import {
  buildUpdateNoticeCacheEntry,
  buildUpdateNoticeState,
  getUsableCachedUpdateNotice,
  type UpdateNoticeCache,
  type UpdateNoticeState,
} from './sidebar/updateNotice'
import { CompactTabs } from '@/components/navigation'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { usePlatformService } from '@/services'
import { IS_ELECTRON } from '@/utils/platform'
import logoSvg from '@/assets/images/logo.svg'
import { focusExposedInput, type ExposedInputRef } from './sidebar/input-focus'

const props = defineProps<{
  backendFeatures: boolean
}>()

const { t } = useI18n()
const LATEST_VERSION_URL = 'https://chatlab.fun/latest-version'
const UPDATE_CHECK_CACHE_KEY = 'chatlab:latest-version-check:v2'
const hasMacTitlebarInset =
  IS_ELECTRON && typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const { sessions, sortedSessions, filterType } = storeToRefs(sessionStore)
const { isSidebarCollapsed: isCollapsed } = storeToRefs(layoutStore)
const { toggleSidebar } = layoutStore
const router = useRouter()
const route = useRoute()
const SESSION_ROW_SIZE = 44
const SESSION_LIST_BOTTOM_PADDING = 32

// 是否在首页
const isHomePage = computed(() => route.path === '/')
const isPeoplePage = computed(() => String(route.name ?? '').startsWith('people-'))
const privateSessionCount = computed(() => sessions.value.filter((session) => session.type === 'private').length)
const groupSessionCount = computed(() => sessions.value.filter((session) => session.type === 'group').length)
const showContactsEntry = computed(() =>
  shouldEnableContactsEntry({
    privateSessionCount: privateSessionCount.value,
    groupSessionCount: groupSessionCount.value,
  })
)

// 是否在足迹页
const isInsightPage = computed(() => String(route.name ?? '').startsWith('insight-'))

// 重命名相关状态
const showRenameModal = ref(false)
const renameTarget = ref<AnalysisSession | null>(null)
const newName = ref('')
const renameInputRef = ref<ExposedInputRef | null>(null)

// 删除确认相关状态
const showDeleteModal = ref(false)
const deleteTarget = ref<AnalysisSession | null>(null)

// 版本号
const version = ref('')
const latestVersion = ref('')
const hasUpdate = ref(false)
const showUpdateModal = ref(false)
const isStartingUpdate = ref(false)

// 搜索相关状态
const showSearch = ref(false)
const searchQuery = ref('')
const sessionListRef = ref<HTMLElement | null>(null)

// 筛选 Tab 配置
const filterTabItems = computed(() => [
  { id: 'all', label: t('layout.filter.all') },
  { id: 'private', label: t('layout.filter.private') },
  { id: 'group', label: t('layout.filter.group') },
])

// 过滤后的会话列表
const filteredSortedSessions = computed(() => {
  if (!searchQuery.value.trim()) {
    return sortedSessions.value
  }
  const query = searchQuery.value.toLowerCase().trim()
  return sortedSessions.value.filter((s) => s.name.toLowerCase().includes(query))
})

const sessionVirtualizer = useVirtualizer(
  computed(() => ({
    count: filteredSortedSessions.value.length,
    getScrollElement: () => sessionListRef.value,
    estimateSize: () => SESSION_ROW_SIZE,
    overscan: 8,
    getItemKey: (index: number) => filteredSortedSessions.value[index]?.id ?? index,
  }))
)

const virtualSessionItems = computed(() => sessionVirtualizer.value.getVirtualItems())
const virtualSessionListHeight = computed(() => sessionVirtualizer.value.getTotalSize() + SESSION_LIST_BOTTOM_PADDING)

function virtualSessionAt(index: number): AnalysisSession {
  return filteredSortedSessions.value[index]!
}

// 切换搜索框显示
function toggleSearch() {
  showSearch.value = !showSearch.value
  if (!showSearch.value) {
    searchQuery.value = ''
  }
}

let unlistenImportCompleted: (() => void) | null = null

onMounted(async () => {
  sessionStore.loadSessions()
  try {
    version.value = await usePlatformService().getVersion()
    if (props.backendFeatures) void checkUpdateNotice()
  } catch (e) {
    console.error('Failed to get version', e)
  }

  if (IS_ELECTRON) {
    unlistenImportCompleted = window.apiServerApi.onImportCompleted(() => {
      sessionStore.loadSessions()
    })
  }
})

onUnmounted(() => {
  unlistenImportCompleted?.()
})

function handleImport() {
  // Navigate to home (Welcome Guide)
  router.push('/')
}

function openContacts() {
  router.push({ name: 'people-contacts' })
}

function openSession(session: AnalysisSession) {
  router.push({
    name: getSessionRouteName(session),
    params: { id: session.id },
    query: route.query,
  })
}

function readUpdateCheckCache(): UpdateNoticeCache | null {
  try {
    const raw = window.localStorage.getItem(UPDATE_CHECK_CACHE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as {
      lastCheckTime?: unknown
      latestVersion?: unknown
      hasUpdate?: unknown
      currentVersion?: unknown
    }
    if (typeof data.lastCheckTime !== 'number') return null
    if (typeof data.hasUpdate !== 'boolean') return null
    if (typeof data.currentVersion !== 'string') return null
    return {
      lastCheckTime: data.lastCheckTime,
      latestVersion: typeof data.latestVersion === 'string' ? data.latestVersion : '',
      hasUpdate: data.hasUpdate,
      currentVersion: data.currentVersion,
    }
  } catch {
    return null
  }
}

function writeUpdateCheckCache(state: UpdateNoticeState | null) {
  const cacheEntry = buildUpdateNoticeCacheEntry(state)
  if (!cacheEntry) return

  try {
    window.localStorage.setItem(UPDATE_CHECK_CACHE_KEY, JSON.stringify(cacheEntry))
  } catch {
    // localStorage 不可用时忽略，更新提醒是非关键能力。
  }
}

function setUpdateNoticeState(state: UpdateNoticeState | null) {
  latestVersion.value = state?.latestVersion ?? ''
  hasUpdate.value = state?.hasUpdate ?? false
}

function parseLatestVersionPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const versionValue = (data as { version?: unknown }).version
  return typeof versionValue === 'string' ? versionValue : null
}

async function fetchUpdateNoticeState(): Promise<UpdateNoticeState | null> {
  const platformService = usePlatformService()
  if (IS_ELECTRON) {
    const result = await platformService.fetchRemoteConfig(LATEST_VERSION_URL)
    if (!result.success) return null
    return buildUpdateNoticeState({
      latestVersion: parseLatestVersionPayload(result.data),
      currentVersion: version.value,
    })
  }

  const result = await platformService.checkUpdate()
  if (!result || result.error) return null
  return buildUpdateNoticeState({
    latestVersion: result.latestVersion,
    currentVersion: result.currentVersion,
    serverHasUpdate: result.hasUpdate,
  })
}

async function checkUpdateNotice() {
  if (IS_ELECTRON) {
    const cache = readUpdateCheckCache()
    const usableCache = cache
      ? getUsableCachedUpdateNotice(cache, { isElectron: true, currentVersion: version.value })
      : null
    if (usableCache) {
      setUpdateNoticeState(usableCache)
      return
    }
  }

  try {
    const nextState = await fetchUpdateNoticeState()
    if (!nextState) {
      setUpdateNoticeState(null)
      return
    }
    if (IS_ELECTRON) writeUpdateCheckCache(nextState)
    setUpdateNoticeState(nextState)
  } catch (error) {
    setUpdateNoticeState(null)
    console.debug('Update notice check failed:', error)
  }
}

function openUpdateModal() {
  showUpdateModal.value = true
}

async function confirmUpdate() {
  if (!IS_ELECTRON) {
    showUpdateModal.value = false
    return
  }

  isStartingUpdate.value = true
  try {
    await usePlatformService().checkUpdate()
    showUpdateModal.value = false
  } finally {
    setTimeout(() => {
      isStartingUpdate.value = false
    }, 3000)
  }
}

// 打开重命名弹窗
function openRenameModal(session: AnalysisSession) {
  renameTarget.value = session
  newName.value = session.name
  showRenameModal.value = true
  // 等待 DOM 更新后聚焦输入框
  nextTick(() => {
    focusExposedInput(renameInputRef.value, { select: true })
  })
}

// 执行重命名
async function handleRename() {
  if (!renameTarget.value || !newName.value.trim()) return

  const success = await sessionStore.renameSession(renameTarget.value.id, newName.value.trim())
  if (success) {
    showRenameModal.value = false
    renameTarget.value = null
    newName.value = ''
  }
}

// 关闭重命名弹窗
function closeRenameModal() {
  showRenameModal.value = false
  renameTarget.value = null
  newName.value = ''
}

// 打开删除确认弹窗
function openDeleteModal(session: AnalysisSession) {
  deleteTarget.value = session
  showDeleteModal.value = true
}

// 确认删除会话
async function confirmDelete() {
  if (!deleteTarget.value) return

  const deletedId = deleteTarget.value.id
  const isViewingDeleted = route.params.id === deletedId
  await sessionStore.deleteSession(deletedId)
  showDeleteModal.value = false
  deleteTarget.value = null

  if (isViewingDeleted) {
    router.push('/')
  }
}

// 关闭删除确认弹窗
function closeDeleteModal() {
  showDeleteModal.value = false
  deleteTarget.value = null
}

async function copySessionId(sessionId: string) {
  try {
    await navigator.clipboard.writeText(sessionId)
  } catch (error) {
    console.error('Failed to copy session id:', error)
  }
}

// 生成右键菜单项
function getContextMenuItems(session: AnalysisSession) {
  const isPinned = sessionStore.isPinned(session.id)
  return [
    [
      {
        label: isPinned ? t('layout.contextMenu.unpin') : t('layout.contextMenu.pin'),
        class: 'p-2',
        onSelect: () => sessionStore.togglePinSession(session.id),
      },
      {
        label: t('layout.contextMenu.rename'),
        class: 'p-2',
        onSelect: () => openRenameModal(session),
      },
      {
        label: t('layout.contextMenu.copyId'),
        class: 'p-2',
        onSelect: () => copySessionId(session.id),
      },
      {
        label: t('layout.contextMenu.delete'),
        color: 'error' as const,
        class: 'p-2',
        onSelect: () => openDeleteModal(session),
      },
    ],
  ]
}

// 根据会话类型获取路由名称
function getSessionRouteName(session: AnalysisSession): string {
  return session.type === 'private' ? 'private-chat' : 'group-chat'
}

// 判断是否是私聊
function isPrivateChat(session: AnalysisSession): boolean {
  return session.type === 'private'
}

// 获取会话头像显示文字：私聊取最后一字，群聊取前一字
function getSessionAvatarText(session: AnalysisSession): string {
  const name = session.name || ''
  if (!name) return '?'
  if (isPrivateChat(session)) {
    // 私聊：取最后一个字
    return name.slice(-1)
  } else {
    // 群聊：取第一个字
    return name.slice(0, 1)
  }
}

// 获取会话头像 URL（群聊用 groupAvatar，私聊用 memberAvatar）
function getSessionAvatar(session: AnalysisSession): string | null {
  if (isPrivateChat(session)) {
    return session.memberAvatar || null
  }
  return session.groupAvatar || null
}

// 根据会话 ID 生成雅致的莫兰迪色系头像背景和文字颜色
function getAvatarColorClass(session: AnalysisSession, isActive: boolean) {
  if (isActive) {
    return 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
  }

  // 雅致的低饱和度配色方案，提升侧边栏的简洁感与品质感
  const palettes = [
    { bg: 'bg-pink-50 dark:bg-pink-950/20', text: 'text-pink-600 dark:text-pink-400' },
    { bg: 'bg-blue-50 dark:bg-blue-950/20', text: 'text-blue-600 dark:text-blue-400' },
    { bg: 'bg-emerald-50 dark:bg-emerald-950/20', text: 'text-emerald-600 dark:text-emerald-400' },
    { bg: 'bg-purple-50 dark:bg-purple-950/20', text: 'text-purple-600 dark:text-purple-400' },
    { bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-600 dark:text-amber-400' },
  ]

  const idStr = session.id || ''
  let hash = 0
  for (let i = 0; i < idStr.length; i++) {
    hash = idStr.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % palettes.length
  return `${palettes[index].bg} ${palettes[index].text}`
}
</script>

<template>
  <div
    class="flex h-full shrink-0 flex-col overflow-hidden rounded-lg bg-white transition-all duration-300 ease-in-out dark:bg-sidebar-dark"
    :class="isCollapsed ? 'w-14' : 'w-72'"
  >
    <div class="flex flex-col px-2 pb-4" :class="hasMacTitlebarInset ? 'pt-8' : 'pt-5'">
      <!-- Header -->
      <div
        class="mb-2 flex items-center"
        :class="[isCollapsed ? 'justify-center' : 'justify-between']"
        style="-webkit-app-region: drag"
      >
        <div v-if="!isCollapsed" class="ml-2 flex items-center">
          <img :src="logoSvg" alt="ChatLab" class="h-6 w-6 select-none pointer-events-none" />
          <div class="ml-2 flex items-baseline gap-2">
            <div class="text-xl font-black tracking-tight text-pink-500">
              {{ t('layout.brand') }}
            </div>
            <span class="text-xs text-gray-400">v{{ version }}</span>
          </div>
          <button
            v-if="hasUpdate"
            type="button"
            class="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm shadow-red-500/20 transition hover:bg-red-600"
            style="-webkit-app-region: no-drag"
            @click="openUpdateModal"
          >
            {{ t('layout.updateNotice.tag') }}
          </button>
        </div>
        <div
          v-else
          class="group relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-gray-200/60 dark:hover:bg-white/[0.06]"
          style="-webkit-app-region: no-drag"
          @click="toggleSidebar"
        >
          <img :src="logoSvg" alt="ChatLab" class="size-5 select-none pointer-events-none group-hover:hidden" />
          <UIcon name="i-lucide-panel-right-open" class="size-4 hidden group-hover:block scale-x-[-1]" />
        </div>
        <UButton
          v-if="!isCollapsed"
          color="neutral"
          variant="ghost"
          size="sm"
          class="group flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-gray-200/60 dark:hover:bg-white/[0.06]"
          style="-webkit-app-region: no-drag"
          @click="toggleSidebar"
        >
          <UIcon name="i-lucide-panel-right" class="size-4 group-hover:hidden scale-x-[-1]" />
          <UIcon name="i-lucide-panel-right-close" class="size-4 hidden group-hover:block scale-x-[-1]" />
        </UButton>
      </div>

      <div class="space-y-1">
        <!-- 新建分析 -->
        <SidebarButton
          icon="i-heroicons-plus"
          :title="t('layout.newAnalysis')"
          :active="isHomePage"
          @click="handleImport"
        />

        <!-- 足迹 -->
        <SidebarButton
          v-if="props.backendFeatures"
          icon="i-heroicons-presentation-chart-bar"
          :title="t('layout.insight')"
          :active="isInsightPage"
          @click="router.push('/insight')"
        />

        <SidebarButton
          v-if="props.backendFeatures && showContactsEntry"
          icon="i-lucide-users"
          icon-class="scale-90"
          :title="t('layout.relationships')"
          :active="isPeoplePage"
          @click="openContacts"
        />
      </div>
    </div>

    <!-- Session List -->
    <div class="flex-1 relative min-h-0 flex flex-col">
      <!-- 筛选与排序 - 固定在顶部，不随列表滚动 -->
      <div v-if="!isCollapsed && sessions.length > 0" class="mb-2">
        <CompactTabs v-model="filterType" :items="filterTabItems" size="sm" :bordered="false">
          <template #right>
            <div class="flex items-center gap-0.5">
              <UTooltip :text="t('layout.tooltip.search')" :content="{ side: 'bottom' }">
                <UButton
                  :icon="showSearch ? 'i-heroicons-x-mark' : 'i-heroicons-magnifying-glass'"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="toggleSearch"
                />
              </UTooltip>
              <SidebarSortPopover />
              <UTooltip v-if="props.backendFeatures" :text="t('layout.manage')" :content="{ side: 'bottom' }">
                <UButton
                  icon="i-heroicons-rectangle-stack"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="layoutStore.openSettings('data')"
                />
              </UTooltip>
            </div>
          </template>
        </CompactTabs>
        <!-- 搜索框 -->
        <div v-if="showSearch" class="mt-2 px-4">
          <UInput
            v-model="searchQuery"
            :placeholder="t('layout.searchPlaceholder')"
            icon="i-heroicons-magnifying-glass"
            size="sm"
            autofocus
          />
        </div>
      </div>

      <!-- 聊天记录列表 - 可滚动区域，滚动条贴边 -->
      <div ref="sessionListRef" class="session-list flex-1 overflow-y-auto">
        <div v-if="sessions.length === 0 && !isCollapsed" class="py-8 text-center text-sm text-gray-500">
          {{ t('layout.noRecords') }}
        </div>

        <!-- 搜索无结果 -->
        <div
          v-else-if="filteredSortedSessions.length === 0 && searchQuery.trim() && !isCollapsed"
          class="py-8 text-center text-sm text-gray-500"
        >
          {{ t('layout.noSearchResult') }}
        </div>

        <div v-else class="relative" :style="{ height: `${virtualSessionListHeight}px` }">
          <div
            v-for="virtualItem in virtualSessionItems"
            :key="String(virtualItem.key)"
            class="absolute left-2 right-2"
            :style="{ transform: `translateY(${virtualItem.start}px)` }"
          >
            <UContextMenu :items="getContextMenuItems(virtualSessionAt(virtualItem.index))">
              <!-- 侧边栏折叠时，hover 显示完整会话名称（Tooltip 需绑定到真实 DOM） -->
              <UTooltip
                :text="virtualSessionAt(virtualItem.index).name"
                :disabled="!isCollapsed || !virtualSessionAt(virtualItem.index).name"
                :content="{ side: 'right' }"
              >
                <div
                  class="group relative flex items-center text-left transition-all duration-200 cursor-pointer"
                  :class="[
                    route.params.id === virtualSessionAt(virtualItem.index).id
                      ? 'text-primary-600 font-medium dark:text-primary-400'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200/20 dark:hover:bg-white/[0.04]',
                    isCollapsed
                      ? 'justify-center h-10 w-10 rounded-lg mx-auto'
                      : 'h-10 w-full rounded-xl p-1.5 px-2.5 pl-1.5',
                  ]"
                  @click="openSession(virtualSessionAt(virtualItem.index))"
                >
                  <!-- 激活指示器：在展开和折叠下，都优雅地贴在侧边栏最左侧边缘 -->
                  <div
                    class="absolute -left-2 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-primary-500 transition-all duration-200"
                    :class="[
                      route.params.id === virtualSessionAt(virtualItem.index).id
                        ? 'h-4.5 opacity-100'
                        : 'h-0 opacity-0 group-hover:h-2.5 group-hover:opacity-40',
                    ]"
                  />

                  <!-- 会话头像 -->
                  <LazyAvatar
                    :src="getSessionAvatar(virtualSessionAt(virtualItem.index))"
                    :alt="virtualSessionAt(virtualItem.index).name"
                    :text="getSessionAvatarText(virtualSessionAt(virtualItem.index))"
                    :root-class="['h-7 w-7 min-w-7 shrink-0', isCollapsed ? '' : 'mr-2.5']"
                    image-class="h-7 w-7 rounded-lg object-cover"
                    :fallback-class="[
                      'flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold select-none',
                      getAvatarColorClass(
                        virtualSessionAt(virtualItem.index),
                        route.params.id === virtualSessionAt(virtualItem.index).id
                      ),
                    ]"
                  />

                  <!-- Session Info -->
                  <div v-if="!isCollapsed" class="min-w-0 flex-1">
                    <div class="flex items-center justify-between gap-1.5">
                      <p class="truncate text-xs font-medium">
                        {{ virtualSessionAt(virtualItem.index).name }}
                      </p>
                      <UIcon
                        v-if="sessionStore.isPinned(virtualSessionAt(virtualItem.index).id)"
                        name="i-lucide-pin"
                        class="h-3 w-3 shrink-0 text-gray-400/80 rotate-45"
                      />
                    </div>
                    <p class="truncate text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-none">
                      {{ t('layout.sessionInfo', { count: virtualSessionAt(virtualItem.index).messageCount }) }}
                    </p>
                  </div>
                </div>
              </UTooltip>
            </UContextMenu>
          </div>
        </div>
      </div>
      <!-- 底部渐变蒙层 - 让列表消失更自然（固定在外层容器底部） -->
      <div
        class="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent dark:from-[#202024]"
      />
    </div>

    <!-- Rename Modal -->
    <UModal v-model:open="showRenameModal" :ui="{ content: 'z-50' }">
      <template #content>
        <div class="p-4">
          <h3 class="mb-3 font-semibold text-gray-900 dark:text-white">{{ t('layout.renameModal.title') }}</h3>
          <UInput
            ref="renameInputRef"
            v-model="newName"
            :placeholder="t('layout.renameModal.placeholder')"
            class="mb-4 w-100"
            @keydown.enter="handleRename"
          />
          <div class="flex justify-end gap-2">
            <UButton variant="soft" @click="closeRenameModal">{{ t('common.cancel') }}</UButton>
            <UButton color="primary" :disabled="!newName.trim()" @click="handleRename">
              {{ t('common.confirm') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal v-model:open="showDeleteModal" :ui="{ content: 'z-50' }">
      <template #content>
        <div class="p-4">
          <h3 class="mb-3 font-semibold text-gray-900 dark:text-white">{{ t('layout.deleteModal.title') }}</h3>
          <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {{ t('layout.deleteModal.message', { name: deleteTarget?.name }) }}
          </p>
          <div class="flex justify-end gap-2">
            <UButton variant="soft" @click="closeDeleteModal">{{ t('common.cancel') }}</UButton>
            <UButton color="error" @click="confirmDelete">{{ t('common.delete') }}</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Update Notice Modal -->
    <UModal v-model:open="showUpdateModal" :ui="{ content: 'z-50' }">
      <template #content>
        <div class="p-4">
          <div class="mb-3 flex items-center gap-2">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-500 dark:bg-red-950/30">
              <UIcon name="i-lucide-sparkles" class="h-4 w-4" />
            </div>
            <h3 class="font-semibold text-gray-900 dark:text-white">
              {{ t('layout.updateNotice.title') }}
            </h3>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t('layout.updateNotice.message', { version: latestVersion }) }}
          </p>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {{ IS_ELECTRON ? t('layout.updateNotice.desktopHint') : t('layout.updateNotice.cliHint') }}
          </p>
          <div
            v-if="!IS_ELECTRON"
            class="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            clb update
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <UButton variant="soft" :disabled="isStartingUpdate" @click="showUpdateModal = false">
              {{ t('layout.updateNotice.later') }}
            </UButton>
            <UButton v-if="IS_ELECTRON" color="primary" :loading="isStartingUpdate" @click="confirmUpdate">
              {{ t('layout.updateNotice.updateNow') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Footer -->
    <SidebarFooter v-if="props.backendFeatures" />
  </div>
</template>

<style scoped>
.session-list {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
.session-list:hover {
  scrollbar-color: rgb(156 163 175 / 0.4) transparent;
}
.session-list::-webkit-scrollbar {
  width: 4px;
}
.session-list::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: 9999px;
}
.session-list:hover::-webkit-scrollbar-thumb {
  background-color: rgb(156 163 175 / 0.4);
}
</style>
