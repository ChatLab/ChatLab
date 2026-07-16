<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useToast } from '@/composables/useToast'
import { useTableRowSelection, useTableSort, type TableSortDirection } from '@/composables/useTable'
import { useSessionStore } from '@/stores/session'
import type { AnalysisSession } from '@/types/base'
import LazyAvatar from '@/components/common/avatar/LazyAvatar.vue'
import OwnerPromptModal from '@/components/analysis/member/OwnerPromptModal.vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
const toast = useToast()
const SESSION_ROW_HEIGHT = 48

const props = withDefaults(
  defineProps<{
    focusOwnerIssues?: boolean
  }>(),
  {
    focusOwnerIssues: false,
  }
)

const { t, locale } = useI18n()
const sessionStore = useSessionStore()
const { sessions } = storeToRefs(sessionStore)

// 搜索关键词
const searchQuery = ref('')
const ownerIssueCount = computed(() => sessions.value.filter((session) => session.ownerStatus !== 'resolved').length)

// 过滤后的会话列表
const filteredSessions = computed(() => {
  if (!searchQuery.value.trim()) {
    return sessions.value
  }
  const query = searchQuery.value.toLowerCase().trim()
  return sessions.value.filter(
    (session) => session.name.toLowerCase().includes(query) || session.platform.toLowerCase().includes(query)
  )
})

type SortField = 'name' | 'platform' | 'owner' | 'messageCount' | 'importedAt'
type HeaderAlign = 'left' | 'center' | 'right'
type HeaderColumn =
  | {
      key: string
      type: 'spacer'
      class: string
    }
  | {
      key: string
      type: 'static'
      labelKey: string
      class: string
      align: HeaderAlign
    }
  | {
      key: string
      type: 'sortable'
      field: SortField
      labelKey: string
      class: string
      align: HeaderAlign
    }

const headerColumns: HeaderColumn[] = [
  { key: 'spacer-select', type: 'spacer', class: 'w-6' },
  { key: 'spacer-avatar', type: 'spacer', class: 'w-8' },
  {
    key: 'name',
    type: 'sortable',
    field: 'name',
    labelKey: 'tools.batchManage.columns.name',
    class: 'min-w-0 flex-1',
    align: 'left',
  },
  {
    key: 'platform',
    type: 'sortable',
    field: 'platform',
    labelKey: 'tools.batchManage.columns.platform',
    class: 'w-20',
    align: 'center',
  },
  {
    key: 'owner',
    type: 'sortable',
    field: 'owner',
    labelKey: 'tools.batchManage.columns.owner',
    class: 'w-28',
    align: 'left',
  },
  {
    key: 'messages',
    type: 'sortable',
    field: 'messageCount',
    labelKey: 'tools.batchManage.columns.messages',
    class: 'w-24',
    align: 'right',
  },
  {
    key: 'summaries',
    type: 'static',
    labelKey: 'tools.batchManage.columns.summaries',
    class: 'w-16',
    align: 'right',
  },
  {
    key: 'aiChats',
    type: 'static',
    labelKey: 'tools.batchManage.columns.aiChats',
    class: 'w-16',
    align: 'right',
  },
  {
    key: 'importedAt',
    type: 'sortable',
    field: 'importedAt',
    labelKey: 'tools.batchManage.columns.importedAt',
    class: 'w-28',
    align: 'right',
  },
]

const { sortState, toggleSort, setSort, isSortActive } = useTableSort<SortField>({
  initialState: { field: 'importedAt', direction: 'desc' },
})

function getSortIconClass(field: SortField, direction: TableSortDirection): string {
  return isSortActive(field, direction) ? 'text-primary-500 dark:text-primary-400' : 'text-gray-300 dark:text-gray-600'
}

function getAlignClass(align: HeaderAlign): string {
  if (align === 'left') return 'justify-start text-left'
  if (align === 'center') return 'justify-center text-center'
  return 'justify-end text-right'
}

function getStaticHeaderClass(column: Extract<HeaderColumn, { type: 'static' }>): string {
  return `${column.class} ${getAlignClass(column.align)}`
}

function getSortableHeaderClass(column: Extract<HeaderColumn, { type: 'sortable' }>): string {
  return `${column.class} flex items-center gap-1 transition-colors hover:text-gray-700 dark:hover:text-gray-200 ${getAlignClass(
    column.align
  )}`
}

const sortedSessions = computed(() => {
  const items = [...filteredSessions.value]
  const { field, direction } = sortState.value
  if (!field || !direction) return items
  const multiplier = direction === 'asc' ? 1 : -1

  items.sort((a, b) => {
    if (field === 'name') {
      return a.name.localeCompare(b.name, locale.value) * multiplier
    }
    if (field === 'platform') {
      return getPlatformLabel(a.platform).localeCompare(getPlatformLabel(b.platform), locale.value) * multiplier
    }
    if (field === 'owner') {
      const ownerValue = (session: AnalysisSession) => {
        if (session.ownerStatus === 'resolved') return `0:${session.ownerName || session.ownerId || ''}`
        return session.ownerStatus === 'unresolved' ? '1:' : '2:'
      }
      return ownerValue(a).localeCompare(ownerValue(b), locale.value) * multiplier
    }
    if (field === 'messageCount') {
      return (a.messageCount - b.messageCount) * multiplier
    }
    return (a.importedAt - b.importedAt) * multiplier
  })

  return items
})

const listScrollRef = ref<HTMLElement | null>(null)

function prioritizeOwnerIssues() {
  setSort('owner', 'desc')
  nextTick(() => listScrollRef.value?.scrollTo({ top: 0 }))
}

watch(
  () => props.focusOwnerIssues,
  (focus) => {
    if (focus) prioritizeOwnerIssues()
  },
  { immediate: true }
)

const sessionVirtualizer = useVirtualizer(
  computed(() => ({
    count: sortedSessions.value.length,
    getScrollElement: () => listScrollRef.value,
    estimateSize: () => SESSION_ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index: number) => sortedSessions.value[index]?.id ?? index,
  }))
)
const virtualSessionRows = computed(() =>
  sessionVirtualizer.value.getVirtualItems().map((virtualItem) => ({
    virtualItem,
    session: sortedSessions.value[virtualItem.index]!,
  }))
)
const virtualListHeight = computed(() => sessionVirtualizer.value.getTotalSize())

const {
  selectedIds,
  setSelection: setSelectedSessionIds,
  clearSelection: clearSessionSelection,
  isSelected,
  handleRowClick,
  handleRowMouseDown,
} = useTableRowSelection({
  rows: sortedSessions,
  getRowId: (session) => session.id,
})

// 删除确认弹窗
const showDeleteModal = ref(false)

// 删除中状态
const isDeleting = ref(false)

// 正在编辑的会话 ID
const editingId = ref<string | null>(null)

// 编辑中的名称
const editingName = ref('')

const ownerSessionId = ref<string | null>(null)
const showOwnerModal = ref(false)
const continueOwnerSetup = ref(false)
const ownerSession = computed(() => sessions.value.find((session) => session.id === ownerSessionId.value) ?? null)

function openOwnerModal(session: AnalysisSession, event: Event) {
  event.stopPropagation()
  ownerSessionId.value = session.id
  continueOwnerSetup.value = session.ownerStatus !== 'resolved'
  showOwnerModal.value = true
}

async function refreshAfterOwnerChange() {
  await sessionStore.loadSessions()
  if (!continueOwnerSetup.value) return

  await nextTick()
  const nextSession = sortedSessions.value.find((session) => session.ownerStatus !== 'resolved')
  if (nextSession) {
    ownerSessionId.value = nextSession.id
    showOwnerModal.value = true
  } else {
    continueOwnerSetup.value = false
  }
}

const selectedMergeSessions = computed(() => sessions.value.filter((s) => selectedIds.value.has(s.id)))
const selectedMergeTypes = computed(() => new Set(selectedMergeSessions.value.map((s) => s.type)))

// 是否可以合并（选中 2 个以上同类型会话）
const canMerge = computed(() => {
  if (selectedIds.value.size < 2) return false
  return selectedMergeTypes.value.size === 1
})

// 全选状态（基于过滤后的列表）
const isAllSelected = computed(() => {
  return sortedSessions.value.length > 0 && sortedSessions.value.every((s) => selectedIds.value.has(s.id))
})

// 部分选中状态（用于 indeterminate）
const isPartialSelected = computed(() => {
  const selectedInFiltered = sortedSessions.value.filter((s) => selectedIds.value.has(s.id)).length
  return selectedInFiltered > 0 && selectedInFiltered < sortedSessions.value.length
})

// 切换全选（只影响过滤后的列表）
function toggleSelectAll() {
  if (isAllSelected.value) {
    // 取消选中过滤列表中的所有项
    const filteredIds = new Set(sortedSessions.value.map((s) => s.id))
    setSelectedSessionIds([...selectedIds.value].filter((id) => !filteredIds.has(id)))
  } else {
    // 选中过滤列表中的所有项
    const newSet = new Set(selectedIds.value)
    for (const s of sortedSessions.value) {
      newSet.add(s.id)
    }
    setSelectedSessionIds(newSet)
  }
}

// 格式化时间
function formatTime(timestamp: number): string {
  return dayjs
    .unix(timestamp)
    .locale(({ 'zh-CN': 'zh-cn', 'zh-TW': 'zh-tw', 'ja-JP': 'ja' } as Record<string, string>)[locale.value] ?? 'en')
    .fromNow()
}

// 判断是否是私聊
function isPrivateChat(session: AnalysisSession): boolean {
  return session.type === 'private'
}

// 获取会话头像
function getSessionAvatar(session: AnalysisSession): string | null {
  if (isPrivateChat(session)) {
    return session.memberAvatar || null
  }
  return session.groupAvatar || null
}

// 获取会话头像文字
function getSessionAvatarText(session: AnalysisSession): string {
  const name = session.name || ''
  if (!name) return '?'
  if (isPrivateChat(session)) {
    return name.length <= 2 ? name : name.slice(-2)
  } else {
    return name.length <= 2 ? name : name.slice(0, 2)
  }
}

// 平台显示配置
const PLATFORM_CONFIG: Record<string, { label: string; class: string }> = {
  qq: { label: 'QQ', class: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  weixin: { label: '微信', class: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  discord: { label: 'Discord', class: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  whatsapp: {
    label: 'WhatsApp',
    class: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  instagram: { label: 'Instagram', class: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300' },
  line: { label: 'LINE', class: 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300' },
  unknown: { label: '未知', class: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
}

// 获取平台标签
function getPlatformLabel(platform: string): string {
  return PLATFORM_CONFIG[platform]?.label || platform
}

// 获取平台样式类
function getPlatformClass(platform: string): string {
  return PLATFORM_CONFIG[platform]?.class || PLATFORM_CONFIG.unknown.class
}

// 开始编辑名称
function startEdit(session: AnalysisSession, event: Event) {
  event.stopPropagation()
  editingId.value = session.id
  editingName.value = session.name
}

// 保存编辑的名称
async function saveEdit() {
  if (!editingId.value || !editingName.value.trim()) {
    editingId.value = null
    editingName.value = ''
    return
  }

  const newName = editingName.value.trim()
  const session = sessions.value.find((s) => s.id === editingId.value)

  // 如果名称没变，不保存
  if (session && session.name !== newName) {
    await sessionStore.renameSession(editingId.value, newName)
  }

  editingId.value = null
  editingName.value = ''
}

// 取消编辑
function cancelEdit() {
  editingId.value = null
  editingName.value = ''
}

// 打开删除确认弹窗
function openDeleteModal() {
  if (selectedIds.value.size === 0) return
  showDeleteModal.value = true
}

// 合并弹窗相关状态
const showMergeModal = ref(false)
const isMerging = ref(false)
const mergeProgress = ref('')
const deleteOriginalsAfterMerge = ref(false)

// 合并选中的会话
async function handleMerge() {
  if (!canMerge.value) return
  deleteOriginalsAfterMerge.value = false
  showMergeModal.value = true
}

// 执行合并
async function executeMerge() {
  if (!canMerge.value) return

  isMerging.value = true
  mergeProgress.value = t('tools.batchManage.mergeSteps.exporting')

  const selectedSessionIds = Array.from(selectedIds.value)
  let tempFiles: string[] = []

  try {
    // 1. 导出选中的会话为临时文件
    const exportResult = await window.mergeApi.exportSessionsToTempFiles(selectedSessionIds)
    if (!exportResult.success) {
      throw new Error(exportResult.error || '导出失败')
    }
    tempFiles = exportResult.tempFiles

    // 2. 解析临时文件获取信息
    mergeProgress.value = t('tools.batchManage.mergeSteps.parsing')
    for (const filePath of tempFiles) {
      await window.mergeApi.parseFileInfo(filePath)
    }

    // 3. 检测冲突
    mergeProgress.value = t('tools.batchManage.mergeSteps.checking')
    const conflictResult = await window.mergeApi.checkConflicts(tempFiles)

    if (conflictResult.conflicts.length > 0) {
      // 有冲突，暂时跳过（后续可以添加冲突解决 UI）
      // 默认使用第一个文件的版本
      console.log(`[BatchDelete] 检测到 ${conflictResult.conflicts.length} 个冲突，使用默认解决方案`)
    }

    // 4. 执行合并
    mergeProgress.value = t('tools.batchManage.mergeSteps.merging')
    const firstSession = sessions.value.find((s) => selectedIds.value.has(s.id))
    const baseName = firstSession?.name || '聊天记录'
    const mergedName = `${baseName}（${t('tools.batchManage.mergedSuffix')}）`
    const mergeResult = await window.mergeApi.mergeFiles({
      filePaths: tempFiles,
      outputName: mergedName,
      outputFormat: 'json',
      conflictResolutions: conflictResult.conflicts.map((c) => ({
        id: c.id,
        resolution: 'keep1' as const,
      })),
      andAnalyze: true, // 直接导入分析
    })

    if (!mergeResult.success) {
      throw new Error(mergeResult.error || '合并失败')
    }

    // 5. 根据用户选择决定是否删除原会话
    if (deleteOriginalsAfterMerge.value) {
      mergeProgress.value = t('tools.batchManage.mergeSteps.cleaning')
      for (const sessionId of selectedSessionIds) {
        await sessionStore.deleteSession(sessionId)
      }
    }

    // 6. 清理临时文件
    await window.mergeApi.cleanupTempExportFiles(tempFiles)

    // 7. 刷新会话列表
    await sessionStore.loadSessions()

    // 清空选择
    clearSessionSelection()
    showMergeModal.value = false

    // 提示成功
    toast.success(t('tools.batchManage.mergeSuccess', { count: selectedSessionIds.length }))
  } catch (error) {
    console.error('[BatchDelete] 合并失败:', error)
    toast.fail(t('tools.batchManage.mergeError', { error: String(error) }))

    // 清理临时文件
    if (tempFiles.length > 0) {
      await window.mergeApi.cleanupTempExportFiles(tempFiles)
    }
  } finally {
    isMerging.value = false
    mergeProgress.value = ''
  }
}

// 确认批量删除
async function confirmBatchDelete() {
  if (selectedIds.value.size === 0) return

  isDeleting.value = true
  try {
    const idsToDelete = Array.from(selectedIds.value)

    // 逐个删除
    for (const id of idsToDelete) {
      await sessionStore.deleteSession(id)
    }

    // 清空选择
    clearSessionSelection()
    showDeleteModal.value = false
  } catch (error) {
    console.error('Batch delete failed:', error)
  } finally {
    isDeleting.value = false
  }
}

// 关闭删除确认弹窗
function closeDeleteModal() {
  showDeleteModal.value = false
}

// 加载会话列表
onMounted(() => {
  sessionStore.loadSessions()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <button
      v-if="ownerIssueCount > 0"
      type="button"
      class="mb-3 inline-flex w-fit max-w-full items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-800 transition-colors hover:bg-amber-100 dark:bg-amber-950/20 dark:text-amber-300 dark:hover:bg-amber-950/30"
      @click="prioritizeOwnerIssues"
    >
      <UIcon name="i-heroicons-user-circle" class="h-4 w-4 shrink-0" />
      <span>{{ t('tools.batchManage.ownerIssues', { count: ownerIssueCount }) }}</span>
      <UIcon name="i-heroicons-arrow-right" class="h-3.5 w-3.5 shrink-0 opacity-70" />
    </button>

    <!-- 搜索栏 -->
    <div class="mb-4">
      <UInput
        v-model="searchQuery"
        :placeholder="t('tools.batchManage.searchPlaceholder')"
        icon="i-heroicons-magnifying-glass"
        size="md"
        class="w-80"
      />
    </div>

    <!-- 工具栏 -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <!-- 全选复选框 -->
        <UCheckbox
          :model-value="isAllSelected"
          :indeterminate="isPartialSelected"
          :label="t('tools.batchManage.selectAll')"
          @update:model-value="toggleSelectAll"
        />

        <!-- Shift 多选提示 -->
        <span class="text-xs text-gray-400 dark:text-gray-500">
          {{ t('tools.batchManage.shiftClickHint') }}
        </span>

        <!-- 已选数量 -->
        <span v-if="selectedIds.size > 0" class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('tools.batchManage.selected', { count: selectedIds.size }) }}
        </span>

        <!-- 搜索结果数量 -->
        <span
          v-if="searchQuery.trim() && filteredSessions.length !== sessions.length"
          class="text-sm text-gray-500 dark:text-gray-400"
        >
          {{ t('tools.batchManage.searchResult', { count: filteredSessions.length, total: sessions.length }) }}
        </span>
      </div>

      <div class="flex gap-2">
        <!-- 合并按钮 -->
        <UTooltip :text="canMerge ? '' : t('tools.batchManage.mergeHint')">
          <UButton color="primary" :disabled="!canMerge" icon="i-heroicons-document-duplicate" @click="handleMerge">
            {{ t('tools.batchManage.merge') }}
          </UButton>
        </UTooltip>

        <!-- 删除按钮 -->
        <UButton color="primary" :disabled="selectedIds.size === 0" icon="i-heroicons-trash" @click="openDeleteModal">
          {{ t('tools.batchManage.delete') }}
        </UButton>
      </div>
    </div>

    <!-- 会话列表 -->
    <div v-if="sessions.length === 0" class="flex flex-1 items-center justify-center">
      <div class="text-center text-gray-500 dark:text-gray-400">
        <UIcon name="i-heroicons-inbox" class="mb-2 h-12 w-12" />
        <p>{{ t('tools.batchManage.empty') }}</p>
      </div>
    </div>

    <div v-else-if="filteredSessions.length === 0" class="flex flex-1 items-center justify-center">
      <div class="text-center text-gray-500 dark:text-gray-400">
        <UIcon name="i-heroicons-magnifying-glass" class="mb-2 h-12 w-12" />
        <p>{{ t('tools.batchManage.noSearchResult') }}</p>
      </div>
    </div>

    <div
      v-else
      class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200/50 dark:border-gray-700/50"
    >
      <!-- 表头 -->
      <div
        class="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:border-gray-700 dark:bg-page-dark/80 dark:text-gray-400"
      >
        <template v-for="column in headerColumns" :key="column.key">
          <div v-if="column.type === 'spacer'" :class="column.class" />
          <div v-else-if="column.type === 'static'" :class="getStaticHeaderClass(column)">
            {{ t(column.labelKey) }}
          </div>
          <button v-else :class="getSortableHeaderClass(column)" @click="toggleSort(column.field)">
            <span>{{ t(column.labelKey) }}</span>
            <span class="flex shrink-0 flex-col leading-none">
              <UIcon name="i-heroicons-chevron-up" class="h-2.5 w-2.5" :class="getSortIconClass(column.field, 'asc')" />
              <UIcon
                name="i-heroicons-chevron-down"
                class="-mt-0.5 h-2.5 w-2.5"
                :class="getSortIconClass(column.field, 'desc')"
              />
            </span>
          </button>
        </template>
      </div>

      <!-- 列表内容 -->
      <div ref="listScrollRef" class="min-h-0 flex-1 overflow-y-auto">
        <div class="relative" :style="{ height: `${virtualListHeight}px` }">
          <div
            v-for="{ virtualItem, session } in virtualSessionRows"
            :key="String(virtualItem.key)"
            class="absolute left-0 right-0 top-0 flex h-12 cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            :class="[
              isSelected(session.id) ? 'bg-pink-50 dark:bg-pink-900/20' : '',
              virtualItem.index !== sortedSessions.length - 1 ? 'border-b border-gray-100 dark:border-gray-800' : '',
            ]"
            :style="{ transform: `translateY(${virtualItem.start}px)` }"
            @mousedown="handleRowMouseDown"
            @click="handleRowClick(virtualItem.index, session.id, $event)"
          >
            <!-- 复选框 -->
            <div class="w-6">
              <UCheckbox
                :model-value="isSelected(session.id)"
                @click.stop="handleRowClick(virtualItem.index, session.id, $event)"
              />
            </div>

            <!-- 头像 -->
            <div class="w-8">
              <LazyAvatar
                :src="getSessionAvatar(session)"
                :alt="session.name"
                :text="getSessionAvatarText(session)"
                :fallback-class="[
                  'flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold',
                  isPrivateChat(session) ? 'bg-pink-500 text-white' : 'bg-primary-500 text-white',
                ]"
              />
            </div>

            <!-- 名称 -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <UIcon
                  :name="isPrivateChat(session) ? 'i-heroicons-user' : 'i-heroicons-user-group'"
                  class="h-3.5 w-3.5 shrink-0 text-gray-400"
                />
                <!-- 编辑模式 -->
                <input
                  v-if="editingId === session.id"
                  v-model="editingName"
                  type="text"
                  class="w-full rounded border border-pink-300 bg-white px-2 py-0.5 text-sm font-medium text-gray-900 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:border-pink-600 dark:bg-gray-800 dark:text-white"
                  autofocus
                  @blur="saveEdit"
                  @keydown.enter="saveEdit"
                  @keydown.escape="cancelEdit"
                  @click.stop
                />
                <!-- 显示模式 -->
                <p
                  v-else
                  class="cursor-text truncate rounded px-1 text-sm font-medium text-gray-900 hover:bg-gray-200 dark:text-white dark:hover:bg-gray-700"
                  :title="t('tools.batchManage.clickToEdit')"
                  @click="startEdit(session, $event)"
                >
                  {{ session.name }}
                </p>
              </div>
            </div>

            <!-- 平台 -->
            <div class="w-20 text-center">
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                :class="getPlatformClass(session.platform)"
              >
                {{ getPlatformLabel(session.platform) }}
              </span>
            </div>

            <!-- 我是谁 -->
            <button
              type="button"
              class="flex w-28 min-w-0 items-center gap-1.5 text-left text-xs transition-colors hover:text-primary-600 dark:hover:text-primary-400"
              :class="
                session.ownerStatus === 'resolved'
                  ? 'text-gray-600 dark:text-gray-300'
                  : 'text-amber-600 dark:text-amber-400'
              "
              :title="session.ownerId || t('tools.batchManage.ownerStatus.missing')"
              @click="openOwnerModal(session, $event)"
            >
              <UIcon
                :name="
                  session.ownerStatus === 'resolved' ? 'i-heroicons-user-circle' : 'i-heroicons-exclamation-circle'
                "
                class="h-3.5 w-3.5 shrink-0"
              />
              <span class="truncate">
                {{
                  session.ownerStatus === 'resolved'
                    ? session.ownerName || session.ownerId
                    : t(`tools.batchManage.ownerStatus.${session.ownerStatus}`)
                }}
              </span>
              <UIcon name="i-heroicons-chevron-right" class="h-3 w-3 shrink-0 opacity-60" />
            </button>

            <!-- 消息数 -->
            <div class="w-24 text-right text-sm text-gray-600 dark:text-gray-300">
              {{ session.messageCount.toLocaleString() }}
            </div>

            <!-- AI 摘要数 -->
            <div class="w-16 text-right text-sm text-gray-600 dark:text-gray-300">
              {{ session.summaryCount || 0 }}
            </div>

            <!-- AI 对话数 -->
            <div class="w-16 text-right text-sm text-gray-600 dark:text-gray-300">
              {{ session.aiConversationCount || 0 }}
            </div>

            <!-- 导入时间 -->
            <div class="w-28 text-right text-xs text-gray-500 dark:text-gray-400">
              {{ formatTime(session.importedAt) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <OwnerPromptModal
      v-if="ownerSession"
      v-model="showOwnerModal"
      :session-id="ownerSession.id"
      :chat-type="ownerSession.type"
      @saved="refreshAfterOwnerChange"
      @cleared="refreshAfterOwnerChange"
    />

    <!-- 合并确认弹窗 -->
    <UModal v-model:open="showMergeModal" :ui="{ content: 'z-[101]', overlay: 'z-[100]' }">
      <template #content>
        <div class="p-4">
          <div class="mb-4 flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
              <UIcon name="i-heroicons-document-duplicate" class="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('tools.batchManage.mergeConfirmTitle') }}
            </h3>
          </div>

          <p class="mb-4 text-gray-600 dark:text-gray-400">
            {{ t('tools.batchManage.mergeConfirmMessage', { count: selectedIds.size }) }}
          </p>

          <!-- 选中的会话预览 -->
          <div class="mb-4 max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <div
              v-for="session in selectedMergeSessions"
              :key="session.id"
              class="flex items-center gap-2 border-b border-gray-100 px-3 py-2 last:border-b-0 dark:border-gray-800"
            >
              <UIcon
                :name="isPrivateChat(session) ? 'i-heroicons-user' : 'i-heroicons-user-group'"
                class="h-4 w-4 text-gray-400"
              />
              <span class="text-sm text-gray-700 dark:text-gray-300">{{ session.name }}</span>
              <span class="text-xs text-gray-400">{{ session.messageCount.toLocaleString() }} 条</span>
            </div>
          </div>

          <!-- 删除原记录选项 -->
          <div class="mb-4">
            <UCheckbox v-model="deleteOriginalsAfterMerge" :label="t('tools.batchManage.deleteOriginalsLabel')" />
          </div>

          <!-- 强提醒（仅勾选删除时显示） -->
          <div
            v-if="deleteOriginalsAfterMerge"
            class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800/50 dark:bg-red-900/20"
          >
            <div class="flex items-start gap-2">
              <UIcon name="i-heroicons-exclamation-triangle" class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p class="text-xs leading-5 text-red-700 dark:text-red-300">
                {{ t('tools.batchManage.mergeRiskWarning') }}
              </p>
            </div>
          </div>

          <!-- 进度显示 -->
          <div v-if="isMerging" class="mb-4 rounded-lg bg-blue-50 px-4 py-3 dark:bg-blue-900/20">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-arrow-path" class="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
              <span class="text-sm text-blue-700 dark:text-blue-300">{{ mergeProgress }}</span>
            </div>
          </div>

          <div class="flex justify-end gap-2">
            <UButton variant="soft" :disabled="isMerging" @click="showMergeModal = false">
              {{ t('common.cancel') }}
            </UButton>
            <UButton color="primary" :loading="isMerging" @click="executeMerge">
              {{ isMerging ? mergeProgress : t('tools.batchManage.merge') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 删除确认弹窗 -->
    <UModal v-model:open="showDeleteModal" :ui="{ content: 'z-[101]', overlay: 'z-[100]' }">
      <template #content>
        <div class="p-4">
          <div class="mb-4 flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <UIcon name="i-heroicons-exclamation-triangle" class="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('tools.batchManage.confirmTitle') }}
            </h3>
          </div>

          <p class="mb-6 text-gray-600 dark:text-gray-400">
            {{ t('tools.batchManage.confirmMessage', { count: selectedIds.size }) }}
          </p>

          <div class="flex justify-end gap-2">
            <UButton variant="soft" :disabled="isDeleting" @click="closeDeleteModal">
              {{ t('common.cancel') }}
            </UButton>
            <UButton color="error" :loading="isDeleting" @click="confirmBatchDelete">
              {{ isDeleting ? t('tools.batchManage.deleting') : t('common.delete') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
