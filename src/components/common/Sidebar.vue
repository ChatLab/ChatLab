<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { AnalysisSession } from '@/types/base'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import SidebarButton from './sidebar/SidebarButton.vue'
import SidebarFooter from './sidebar/SidebarFooter.vue'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'

dayjs.extend(relativeTime)
const { t } = useI18n()

const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const { sessions, sortedSessions } = storeToRefs(sessionStore)
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

// 搜索相关状态
const showSearch = ref(false)
const searchQuery = ref('')

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

// 加载会话列表和版本号
onMounted(async () => {
  sessionStore.loadSessions()
  try {
    version.value = await window.api.app.getVersion()
  } catch (e) {
    console.error('Failed to get version', e)
  }
})

function handleImport() {
  // Navigate to home (Welcome Guide)
  router.push('/')
}

function formatTime(timestamp: number): string {
  return dayjs.unix(timestamp).fromNow()
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

  await sessionStore.deleteSession(deleteTarget.value.id)
  showDeleteModal.value = false
  deleteTarget.value = null
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

// 获取会话头像显示文字：私聊取最后两字，群聊取前两字
function getSessionAvatarText(session: AnalysisSession): string {
  const name = session.name || ''
  if (!name) return '?'
  if (isPrivateChat(session)) {
    // 私聊：取最后两个字
    return name.length <= 2 ? name : name.slice(-2)
  } else {
    // 群聊：取前两个字
    return name.length <= 2 ? name : name.slice(0, 2)
  }
}

// 获取会话头像 URL（群聊用 groupAvatar，私聊用 memberAvatar）
function getSessionAvatar(session: AnalysisSession): string | null {
  if (isPrivateChat(session)) {
    return session.memberAvatar || null
  }
  return session.groupAvatar || null
}
</script>

<template>
  <div
    class="flex h-full flex-col border-r border-gray-200/50 transition-all duration-300 ease-in-out dark:border-gray-800/50"
    :class="[isCollapsed ? 'w-20' : 'w-72', isHomePage ? '' : 'bg-gray-50 dark:bg-gray-900']"
  >
    <div class="flex flex-col p-4 pt-5">
      <!-- Header -->
      <div
        class="mb-2 flex items-center"
        :class="[isCollapsed ? 'justify-center' : 'justify-between']"
        style="-webkit-app-region: drag"
      >
        <div v-if="!isCollapsed" class="ml-2 flex items-baseline">
          <div class="text-2xl font-black tracking-tight text-pink-500">
            {{ t('layout.brand') }}
          </div>
          <span class="ml-2 text-xs text-gray-400">v{{ version }}</span>
        </div>
        <UTooltip
          :text="isCollapsed ? t('layout.tooltip.expand') : t('layout.tooltip.collapse')"
          :popper="{ placement: 'right' }"
          style="-webkit-app-region: no-drag"
        >
          <UButton
            icon="i-heroicons-bars-3"
            color="gray"
            variant="ghost"
            size="md"
            class="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full hover:bg-gray-200/60 dark:hover:bg-gray-800"
            @click="toggleSidebar"
          />
        </UTooltip>
      </div>

      <!-- 新建分析 -->
      <SidebarButton icon="i-heroicons-plus" :title="t('layout.newAnalysis')" @click="handleImport" />
    </div>

    <!-- Session List -->
    <div class="flex-1 relative min-h-0 flex flex-col">
      <!-- 聊天记录标题 - 固定在顶部，不随列表滚动 -->
      <div v-if="!isCollapsed && sessions.length > 0" class="px-4 mb-2">
        <div class="flex items-center justify-between">
          <UTooltip :text="t('layout.tooltip.hint')" :popper="{ placement: 'right' }">
            <div class="flex items-center gap-1 pl-3">
              <div class="text-sm font-medium text-gray-500">{{ t('layout.chatHistory') }}</div>
              <UIcon name="i-heroicons-question-mark-circle" class="size-3.5 text-gray-400" />
            </div>
          </UTooltip>
          <UTooltip :text="t('layout.tooltip.search')" :popper="{ placement: 'right' }">
            <UButton
              :icon="showSearch ? 'i-heroicons-x-mark' : 'i-heroicons-magnifying-glass'"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="toggleSearch"
            />
          </UTooltip>
        </div>
        <!-- 搜索框 -->
        <div v-if="showSearch" class="mt-2">
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

        <div class="space-y-1 pb-8" :class="[isCollapsed ? '' : 'px-4']">
          <UContextMenu
            v-for="session in filteredSortedSessions"
            :key="session.id"
            :items="getContextMenuItems(session)"
          >
            <!-- 侧边栏折叠时，hover 显示完整会话名称（Tooltip 需绑定到真实 DOM） -->
            <UTooltip :text="session.name" :disabled="!isCollapsed || !session.name" :popper="{ placement: 'right' }">
              <div
                class="group relative flex items-center p-2 text-left transition-colors"
                :class="[
                  route.params.id === session.id && !isCollapsed
                    ? 'bg-primary-100 text-gray-900 dark:bg-primary-900/30 dark:text-primary-100'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-800',
                  isCollapsed
                    ? 'justify-center cursor-pointer h-13 w-13 rounded-full ml-3.5'
                    : 'cursor-pointer w-full rounded-full',
                ]"
                @click="router.push({ name: getSessionRouteName(session), params: { id: session.id } })"
              >
                <!-- 会话头像 -->
                <!-- 有头像图片时显示图片 -->
                <img
                  v-if="getSessionAvatar(session)"
                  :src="getSessionAvatar(session)!"
                  :alt="session.name"
                  class="h-9 w-9 min-w-9 shrink-0 rounded-full object-cover"
                  :class="[isCollapsed ? '' : 'mr-3']"
                />
                <!-- 无头像时显示图标/文字 -->
                <div
                  v-else
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  :class="[
                    route.params.id === session.id
                      ? isPrivateChat(session)
                        ? 'bg-pink-600 text-white dark:bg-pink-500 dark:text-white'
                        : 'bg-primary-600 text-white dark:bg-primary-500 dark:text-white'
                      : 'bg-gray-400 text-white dark:bg-gray-600 dark:text-white',
                    isCollapsed ? '' : 'mr-3',
                  ]"
                >
                  <!-- 折叠时显示缩略名字，不折叠时显示图标 -->
                  <template v-if="isCollapsed">
                    {{ getSessionAvatarText(session) }}
                  </template>
                  <template v-else>
                    <UIcon
                      :name="isPrivateChat(session) ? 'i-heroicons-user' : 'i-heroicons-chat-bubble-left-right'"
                      class="h-4 w-4"
                    />
                  </template>
                </div>

                <!-- Session Info -->
                <div v-if="!isCollapsed" class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="truncate text-sm font-medium">
                      {{ session.name }}
                    </p>
                    <UIcon
                      v-if="sessionStore.isPinned(session.id)"
                      name="i-lucide-pin"
                      class="h-3.5 w-3.5 shrink-0 text-gray-400 rotate-45"
                    />
                  </div>
                  <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                    {{ t('layout.sessionInfo', { count: session.messageCount, time: formatTime(session.importedAt) }) }}
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
    <UModal v-model:open="showRenameModal">
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
    <UModal v-model:open="showDeleteModal">
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

    <!-- Footer -->
    <SidebarFooter />
  </div>
</template>
