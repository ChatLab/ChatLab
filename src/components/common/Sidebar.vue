<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { isNewerStableVersion } from '@openchatlab/core'
import type { AnalysisSession } from '@/types/base'
import SidebarButton from './sidebar/SidebarButton.vue'
import SidebarFooter from './sidebar/SidebarFooter.vue'
import SidebarSortPopover from './sidebar/SidebarSortPopover.vue'
import SubTabs from '@/components/UI/SubTabs.vue'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { usePlatformService } from '@/services'
import { IS_ELECTRON } from '@/utils/platform'
import logoSvg from '@/assets/images/logo.svg'

const { t } = useI18n()
const LATEST_VERSION_URL = 'https://chatlab.fun/latest-version'
const UPDATE_CHECK_CACHE_KEY = 'chatlab:latest-version-check'
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const { sessions, sortedSessions, filterType } = storeToRefs(sessionStore)
const { isSidebarCollapsed: isCollapsed } = storeToRefs(layoutStore)
const { toggleSidebar } = layoutStore
const router = useRouter()
const route = useRoute()

// 是否在首页
const isHomePage = computed(() => route.path === '/')

// 重命名相关状态
const showRenameModal = ref(false)
const renameTarget = ref<AnalysisSession | null>(null)
const newName = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

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
    void checkUpdateNotice()
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

function readUpdateCheckCache(): { lastCheckTime: number; latestVersion: string | null } | null {
  try {
    const raw = window.localStorage.getItem(UPDATE_CHECK_CACHE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { lastCheckTime?: unknown; latestVersion?: unknown }
    if (typeof data.lastCheckTime !== 'number') return null
    return {
      lastCheckTime: data.lastCheckTime,
      latestVersion: typeof data.latestVersion === 'string' ? data.latestVersion : null,
    }
  } catch {
    return null
  }
}

function writeUpdateCheckCache(nextLatestVersion: string | null) {
  try {
    window.localStorage.setItem(
      UPDATE_CHECK_CACHE_KEY,
      JSON.stringify({
        lastCheckTime: Date.now(),
        latestVersion: nextLatestVersion,
      })
    )
  } catch {
    // localStorage 不可用时忽略，更新提醒是非关键能力。
  }
}

function setLatestVersion(nextLatestVersion: string | null) {
  latestVersion.value = nextLatestVersion || ''
  hasUpdate.value = Boolean(nextLatestVersion && isNewerStableVersion(nextLatestVersion, version.value))
}

function parseLatestVersionPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const versionValue = (data as { version?: unknown }).version
  return typeof versionValue === 'string' ? versionValue : null
}

async function fetchLatestVersion(): Promise<string | null> {
  const platformService = usePlatformService()
  if (IS_ELECTRON) {
    const result = await platformService.fetchRemoteConfig(LATEST_VERSION_URL)
    if (!result.success) return null
    return parseLatestVersionPayload(result.data)
  }

  const result = await platformService.checkUpdate()
  if (!result || result.error) return null
  return result.latestVersion || null
}

async function checkUpdateNotice() {
  const cache = readUpdateCheckCache()
  if (cache) {
    setLatestVersion(cache.latestVersion)
    if (Date.now() - cache.lastCheckTime < UPDATE_CHECK_INTERVAL_MS) return
  }

  try {
    const nextLatestVersion = await fetchLatestVersion()
    writeUpdateCheckCache(nextLatestVersion)
    setLatestVersion(nextLatestVersion)
  } catch (error) {
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
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
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

// 根据会话 ID 生成雅致的莫兰迪色系头像背景和文字颜色（中文注释）
function getAvatarColorClass(session: AnalysisSession, isActive: boolean) {
  if (isActive) {
    return isPrivateChat(session)
      ? 'bg-pink-500 text-white dark:bg-pink-600'
      : 'bg-primary-600 text-white dark:bg-primary-500'
  }

  // 雅致的低饱和度配色方案，提升侧边栏的简洁感与品质感（中文注释）
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
    class="flex h-full flex-col border-r border-gray-200/50 transition-all duration-300 ease-in-out dark:border-gray-800/50"
    :class="[isCollapsed ? 'w-20' : 'w-72', isHomePage ? '' : 'bg-gray-50 dark:bg-gray-900']"
  >
    <div class="flex flex-col pt-5" :class="[isCollapsed ? 'px-3 pb-4' : 'p-4']">
      <!-- Header -->
      <div
        class="mb-2 flex items-center"
        :class="[isCollapsed ? 'justify-center' : 'justify-between']"
        style="-webkit-app-region: drag"
      >
        <div v-if="!isCollapsed" class="ml-2 flex items-center">
          <img :src="logoSvg" alt="ChatLab" class="h-6 w-6 select-none pointer-events-none" />
          <div class="ml-2 text-2xl font-black tracking-tight text-pink-500">
            {{ t('layout.brand') }}
          </div>
          <span class="ml-2 text-xs text-gray-400">v{{ version }}</span>
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
          class="group relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-gray-200/60 dark:hover:bg-gray-800"
          style="-webkit-app-region: no-drag"
          @click="toggleSidebar"
        >
          <img :src="logoSvg" alt="ChatLab" class="size-5 select-none pointer-events-none group-hover:hidden" />
          <UIcon name="i-lucide-panel-right-open" class="size-4 hidden group-hover:block scale-x-[-1]" />
        </div>
        <UTooltip
          v-if="!isCollapsed"
          :text="t('layout.tooltip.collapse')"
          :content="{ side: 'bottom' }"
          style="-webkit-app-region: no-drag"
        >
          <UButton
            color="gray"
            variant="ghost"
            size="sm"
            class="group flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-gray-200/60 dark:hover:bg-gray-800"
            @click="toggleSidebar"
          >
            <UIcon name="i-lucide-panel-right" class="size-4 group-hover:hidden scale-x-[-1]" />
            <UIcon name="i-lucide-panel-right-close" class="size-4 hidden group-hover:block scale-x-[-1]" />
          </UButton>
        </UTooltip>
      </div>

      <!-- 新建分析 -->
      <SidebarButton
        icon="i-heroicons-plus"
        :title="t('layout.newAnalysis')"
        :active="isHomePage"
        @click="handleImport"
      />
    </div>

    <!-- Session List -->
    <div class="flex-1 relative min-h-0 flex flex-col">
      <!-- 筛选与排序 - 固定在顶部，不随列表滚动 -->
      <div v-if="!isCollapsed && sessions.length > 0" class="mb-2">
        <SubTabs v-model="filterType" :items="filterTabItems" size="sm" :bordered="false">
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
              <UTooltip :text="t('layout.manage')" :content="{ side: 'bottom' }">
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
        </SubTabs>
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
      <div class="flex-1 overflow-y-auto">
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

        <div class="space-y-1 pb-8" :class="[isCollapsed ? 'px-3' : 'px-4']">
          <UContextMenu
            v-for="session in filteredSortedSessions"
            :key="session.id"
            :items="getContextMenuItems(session)"
          >
            <!-- 侧边栏折叠时，hover 显示完整会话名称（Tooltip 需绑定到真实 DOM） -->
            <UTooltip :text="session.name" :disabled="!isCollapsed || !session.name" :content="{ side: 'right' }">
              <div
                class="group relative flex items-center text-left transition-all duration-200 cursor-pointer"
                :class="[
                  route.params.id === session.id
                    ? 'bg-gray-200/50 dark:bg-gray-800/80 text-gray-900 dark:text-white font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200/30 dark:hover:bg-gray-800/30',
                  isCollapsed ? 'justify-center h-10 w-10 rounded-xl mx-auto' : 'w-full rounded-xl p-1.5 px-2.5 pl-1.5',
                ]"
                @click="
                  router.push({ name: getSessionRouteName(session), params: { id: session.id }, query: route.query })
                "
              >
                <!-- 激活指示器：在展开和折叠下，都优雅地贴在侧边栏最左侧边缘 -->
                <div
                  class="absolute top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-pink-500 dark:bg-pink-400 transition-all duration-200"
                  :class="[
                    isCollapsed ? '-left-3' : '-left-4',
                    route.params.id === session.id
                      ? 'h-4.5 opacity-100'
                      : 'h-0 opacity-0 group-hover:h-2.5 group-hover:opacity-40',
                  ]"
                />

                <!-- 会话头像 -->
                <!-- 有头像图片时显示图片 -->
                <img
                  v-if="getSessionAvatar(session)"
                  :src="getSessionAvatar(session)!"
                  :alt="session.name"
                  class="h-7 w-7 min-w-7 shrink-0 rounded-lg object-cover"
                  :class="[isCollapsed ? '' : 'mr-2.5']"
                />
                <!-- 无头像时显示精致的首字母/缩写字头像 -->
                <div
                  v-else
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold select-none"
                  :class="[getAvatarColorClass(session, route.params.id === session.id), isCollapsed ? '' : 'mr-2.5']"
                >
                  {{ getSessionAvatarText(session) }}
                </div>

                <!-- Session Info -->
                <div v-if="!isCollapsed" class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-1.5">
                    <p class="truncate text-xs font-medium">
                      {{ session.name }}
                    </p>
                    <UIcon
                      v-if="sessionStore.isPinned(session.id)"
                      name="i-lucide-pin"
                      class="h-3 w-3 shrink-0 text-gray-400/80 rotate-45"
                    />
                  </div>
                  <p class="truncate text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-none">
                    {{ t('layout.sessionInfo', { count: session.messageCount }) }}
                  </p>
                </div>
              </div>
            </UTooltip>
          </UContextMenu>
        </div>
      </div>
      <!-- 底部渐变蒙层 - 让列表消失更自然（固定在外层容器底部） -->
      <div
        class="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-gray-50 to-transparent dark:from-gray-900"
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
    <SidebarFooter />
  </div>
</template>
