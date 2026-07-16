<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useI18n } from 'vue-i18n'
import type { MemberWithStats } from '@/types/analysis'
import OwnerEntryCard from '@/components/analysis/member/OwnerEntryCard.vue'
import LazyAvatar from '@/components/common/avatar/LazyAvatar.vue'
import { filterAndSortMembers, shouldShowMemberMergeControls, type MemberSortField } from './member-select-utils'
import { useDataService } from '@/services'
import { useTableRowSelection, useTableSort, type TableSortDirection } from '@/composables/useTable'
import { reportError } from '@/services/log-report'
import { useLayoutStore } from '@/stores/layout'
import { formatDateTime } from '@/utils/dateFormat'

const MEMBER_ROW_ESTIMATE = 64
const { t } = useI18n()
const dataService = useDataService()
const layoutStore = useLayoutStore()

// Props
const props = withDefaults(
  defineProps<{
    sessionId: string
    showHeader?: boolean
    chatType?: 'group' | 'private'
  }>(),
  {
    showHeader: true,
    chatType: 'group',
  }
)

// Emits
const emit = defineEmits<{
  'data-changed': []
}>()

// 成员列表
const members = ref<MemberWithStats[]>([])
const isLoading = ref(false)
const loadFailed = ref(false)
const searchQuery = ref('')
const showSelectionControls = computed(() => shouldShowMemberMergeControls(props.chatType, members.value.length))
const memberTableGridClass = computed(() => {
  if (props.chatType === 'group') return ''
  return showSelectionControls.value ? 'member-table-grid--private' : 'member-table-grid--private-without-selection'
})

// 删除确认状态
const deletingMember = ref<MemberWithStats | null>(null)
const isDeleting = ref(false)
const showBatchDeleteModal = ref(false)
const isBatchDeleting = ref(false)

// 合并确认状态
const showMergeModal = ref(false)
const isMerging = ref(false)

// 排序配置
const { sortState, toggleSort, resetSort, isSortActive } = useTableSort<MemberSortField>({
  initialState: { field: 'messageCount', direction: 'desc' },
})

// 正在保存别名的成员 ID
const savingAliasIds = ref<Set<number>>(new Set())

let loadRequestSeq = 0

function reportMemberManagementError(message: string, error: unknown) {
  const cause = error instanceof Error ? error : new Error(String(error))
  console.error(message, cause)
  reportError(`${message} ${cause.message}`, cause.stack)
}

// 获取成员显示名称
function getDisplayName(member: MemberWithStats): string {
  return member.groupNickname || member.accountName || member.platformId
}

// 获取成员首字符（用于头像）
function getFirstChar(member: MemberWithStats): string {
  const name = getDisplayName(member)
  return name.slice(0, 1)
}

function viewMemberChatRecords(member: MemberWithStats) {
  layoutStore.openChatRecordDrawer({
    sessionId: props.sessionId,
    memberId: member.id,
    memberName: getDisplayName(member),
  })
}

const filteredSortedMembers = computed(() => filterAndSortMembers(members.value, searchQuery.value, sortState.value))
const {
  selectedIds: selectedMemberIds,
  setSelection: setSelectedMemberIds,
  clearSelection: clearMemberSelection,
  handleRowClick: handleSelectionRowClick,
  handleRowMouseDown: handleSelectionRowMouseDown,
} = useTableRowSelection({
  rows: filteredSortedMembers,
  getRowId: (member) => member.id,
})
const selectedMembers = computed(() => members.value.filter((member) => selectedMemberIds.value.has(member.id)))
const canMergeSelected = computed(() => selectedMembers.value.length === 2)
const selectedMessageCount = computed(() =>
  selectedMembers.value.reduce((total, member) => total + member.messageCount, 0)
)

function handleMemberRowClick(index: number, memberId: number, event: MouseEvent) {
  if (!showSelectionControls.value) return
  handleSelectionRowClick(index, memberId, event)
}

function handleMemberRowMouseDown(event: MouseEvent) {
  if (!showSelectionControls.value) return
  handleSelectionRowMouseDown(event)
}

const mergePlan = computed(() => {
  if (selectedMembers.value.length !== 2) return null
  const [memberA, memberB] = selectedMembers.value
  if (
    memberB.messageCount > memberA.messageCount ||
    (memberB.messageCount === memberA.messageCount && memberB.id < memberA.id)
  ) {
    return { primary: memberB, secondary: memberA }
  }
  return { primary: memberA, secondary: memberB }
})

function getSortIconClass(field: MemberSortField, direction: TableSortDirection): string {
  return isSortActive(field, direction) ? 'text-primary-500 dark:text-primary-400' : 'text-gray-300 dark:text-gray-600'
}

const listScrollRef = ref<HTMLElement | null>(null)
const memberVirtualizer = useVirtualizer(
  computed(() => ({
    count: filteredSortedMembers.value.length,
    getScrollElement: () => listScrollRef.value,
    estimateSize: () => MEMBER_ROW_ESTIMATE,
    overscan: 8,
    getItemKey: (index: number) => filteredSortedMembers.value[index]?.id ?? index,
  }))
)
const virtualMemberRows = computed(() =>
  memberVirtualizer.value.getVirtualItems().map((virtualItem) => ({
    virtualItem,
    member: filteredSortedMembers.value[virtualItem.index]!,
  }))
)
const virtualListHeight = computed(() => memberVirtualizer.value.getTotalSize())

function measureVirtualRow(element: unknown) {
  if (element instanceof HTMLElement) {
    memberVirtualizer.value.measureElement(element)
  }
}

async function resetVirtualScroll() {
  await nextTick()
  listScrollRef.value?.scrollTo({ top: 0 })
  memberVirtualizer.value.measure()
}

// 加载完整成员列表；搜索、排序和渲染均在前端完成。
async function loadMembers() {
  const sessionId = props.sessionId
  if (!sessionId) return

  const requestSeq = ++loadRequestSeq
  isLoading.value = true
  loadFailed.value = false
  try {
    const result = await dataService.getMembers(sessionId)
    if (requestSeq !== loadRequestSeq || sessionId !== props.sessionId) return

    members.value = result
    await nextTick()
    memberVirtualizer.value.measure()
  } catch (error) {
    if (requestSeq === loadRequestSeq) {
      loadFailed.value = true
    }
    reportMemberManagementError('Failed to load member list:', error)
  } finally {
    if (requestSeq === loadRequestSeq) {
      isLoading.value = false
    }
  }
}

function setAliasSaving(memberId: number, saving: boolean) {
  const next = new Set(savingAliasIds.value)
  if (saving) next.add(memberId)
  else next.delete(memberId)
  savingAliasIds.value = next
}

// 直接更新别名（输入框失焦或回车时触发）
async function updateAliases(member: MemberWithStats, newAliases: string[]) {
  const sessionId = props.sessionId
  // 将 Vue 响应式数组转换为普通数组，避免 IPC 序列化问题
  const aliasesToSave = JSON.parse(JSON.stringify(newAliases)) as string[]

  // 检查是否有变化
  const currentAliases = JSON.stringify(member.aliases)
  const newAliasesStr = JSON.stringify(aliasesToSave)
  if (currentAliases === newAliasesStr) return

  setAliasSaving(member.id, true)
  try {
    const success = await dataService.updateMemberAliases(sessionId, member.id, aliasesToSave)
    if (success && sessionId === props.sessionId) {
      const idx = members.value.findIndex((m) => m.id === member.id)
      if (idx !== -1) {
        members.value[idx] = {
          ...members.value[idx],
          aliases: aliasesToSave,
        }
        await nextTick()
        memberVirtualizer.value.measure()
      }
    }
  } catch (error) {
    reportMemberManagementError('Failed to save member aliases:', error)
  } finally {
    setAliasSaving(member.id, false)
  }
}

// 显示删除确认
function showDeleteConfirm(member: MemberWithStats) {
  deletingMember.value = member
}

// 取消删除
function cancelDelete() {
  deletingMember.value = null
}

// 确认删除
async function confirmDelete() {
  if (!deletingMember.value) return
  isDeleting.value = true
  try {
    const memberId = deletingMember.value.id
    const success = await dataService.deleteMember(props.sessionId, memberId)
    if (success) {
      const nextSelection = new Set(selectedMemberIds.value)
      nextSelection.delete(memberId)
      setSelectedMemberIds(nextSelection)
      await loadMembers()
      emit('data-changed')
    }
  } catch (error) {
    reportMemberManagementError('Failed to delete member:', error)
  } finally {
    isDeleting.value = false
    deletingMember.value = null
  }
}

function openBatchDeleteModal() {
  if (selectedMemberIds.value.size === 0) return
  showBatchDeleteModal.value = true
}

async function confirmBatchDelete() {
  const sessionId = props.sessionId
  const memberIds = Array.from(selectedMemberIds.value)
  if (memberIds.length === 0) return

  isBatchDeleting.value = true
  try {
    const success = await dataService.deleteMembers(sessionId, memberIds)
    if (success && sessionId === props.sessionId) {
      showBatchDeleteModal.value = false
      clearMemberSelection()
      await loadMembers()
      emit('data-changed')
    }
  } catch (error) {
    reportMemberManagementError('Failed to delete selected members:', error)
  } finally {
    isBatchDeleting.value = false
  }
}

function openMergeModal() {
  if (!canMergeSelected.value) return
  showMergeModal.value = true
}

async function confirmMerge() {
  if (!mergePlan.value) return
  isMerging.value = true
  try {
    const success = await dataService.mergeMembers(
      props.sessionId,
      mergePlan.value.primary.id,
      mergePlan.value.secondary.id
    )
    if (success) {
      showMergeModal.value = false
      clearMemberSelection()
      await loadMembers()
      emit('data-changed')
    }
  } catch (error) {
    reportMemberManagementError('Failed to merge members:', error)
  } finally {
    isMerging.value = false
  }
}

watch([searchQuery, sortState], resetVirtualScroll)
watch(showSelectionControls, (show) => {
  if (!show) clearMemberSelection()
})

// 监听 sessionId 变化
watch(
  () => props.sessionId,
  () => {
    loadRequestSeq += 1
    members.value = []
    loadFailed.value = false
    savingAliasIds.value = new Set()
    searchQuery.value = ''
    resetSort()
    clearMemberSelection()
    void resetVirtualScroll()
    void loadMembers()
  },
  { immediate: true }
)

onUnmounted(() => {
  loadRequestSeq += 1
})
</script>

<template>
  <div
    class="main-content"
    :class="props.showHeader ? 'max-w-5xl p-6' : 'flex h-full max-w-none flex-col overflow-hidden p-4'"
  >
    <!-- 页面标题 -->
    <div v-if="props.showHeader" class="mb-6">
      <div class="flex items-center gap-3">
        <div>
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">
            {{ t(props.chatType === 'private' ? 'members.private.title' : 'members.list.title') }}
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            {{
              t(props.chatType === 'private' ? 'members.private.description' : 'members.list.description', {
                count: members.length,
              })
            }}
          </p>
        </div>
      </div>
    </div>

    <!-- Owner配置 -->
    <OwnerEntryCard class="mb-6" :session-id="sessionId" :members="members" :chat-type="props.chatType" />

    <!-- 搜索框 -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <UInput
        v-model="searchQuery"
        :placeholder="t('members.list.searchPlaceholder')"
        icon="i-heroicons-magnifying-glass"
        class="w-full md:w-100"
      >
        <template v-if="searchQuery" #trailing>
          <UButton icon="i-heroicons-x-mark" variant="link" color="neutral" size="xs" @click="searchQuery = ''" />
        </template>
      </UInput>
      <div v-if="showSelectionControls" class="flex items-center gap-2">
        <UIcon
          v-if="isLoading && members.length > 0"
          name="i-heroicons-arrow-path"
          class="h-4 w-4 animate-spin text-primary-500"
        />
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {{ t('members.list.selectedCount', { count: selectedMemberIds.size }) }}
        </span>
        <UButton
          icon="i-heroicons-link"
          size="sm"
          color="primary"
          :disabled="!canMergeSelected"
          @click="openMergeModal"
        >
          {{ t('members.list.mergeSelected') }}
        </UButton>
        <UButton
          icon="i-heroicons-trash"
          size="sm"
          color="error"
          variant="outline"
          :disabled="selectedMemberIds.size === 0"
          @click="openBatchDeleteModal"
        >
          {{ t('members.list.deleteSelected') }}
        </UButton>
      </div>
    </div>

    <!-- 成员列表 -->
    <div
      class="flex min-h-[240px] flex-col overflow-hidden rounded-lg border border-gray-200/60 bg-card-bg dark:border-white/5 dark:bg-card-dark"
      :class="props.showHeader ? 'h-[500px]' : 'min-h-0 flex-1'"
    >
      <!-- 加载状态 -->
      <div v-if="isLoading && members.length === 0" class="flex flex-1 items-center justify-center">
        <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-primary-500" />
      </div>

      <!-- 失败状态 -->
      <div
        v-else-if="loadFailed && members.length === 0"
        class="flex flex-1 flex-col items-center justify-center gap-3"
      >
        <UIcon name="i-heroicons-exclamation-circle" class="h-10 w-10 text-red-400" />
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('members.list.loadError') }}</p>
        <UButton size="sm" variant="outline" icon="i-heroicons-arrow-path" @click="loadMembers">
          {{ t('common.retry') }}
        </UButton>
      </div>

      <!-- 空状态 -->
      <div v-else-if="filteredSortedMembers.length === 0" class="flex flex-1 flex-col items-center justify-center">
        <UIcon name="i-heroicons-user-group" class="mb-3 h-12 w-12 text-gray-300 dark:text-gray-600" />
        <p class="text-gray-500 dark:text-gray-400">
          {{ searchQuery ? t('members.list.noMatch') : t('members.list.empty') }}
        </p>
      </div>

      <!-- 成员表格 -->
      <div v-else class="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div class="flex h-full flex-col" :class="props.chatType === 'private' ? 'min-w-[920px]' : 'min-w-[1120px]'">
          <!-- 固定表头：只让数据区纵向滚动 -->
          <div
            class="member-table-grid shrink-0 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:border-white/5 dark:bg-page-dark/80 dark:text-gray-400"
            :class="memberTableGridClass"
          >
            <span v-if="showSelectionControls" aria-hidden="true" />
            <span>{{ t('members.list.table.accountName') }}</span>
            <button
              v-if="props.chatType === 'group'"
              type="button"
              class="flex items-center justify-start gap-1.5 text-left transition-colors hover:text-gray-700 dark:hover:text-gray-200"
              @click="toggleSort('groupNickname')"
            >
              {{ t('members.list.table.groupNickname') }}
              <span class="flex shrink-0 flex-col leading-none">
                <UIcon
                  name="i-heroicons-chevron-up"
                  class="h-2.5 w-2.5"
                  :class="getSortIconClass('groupNickname', 'asc')"
                />
                <UIcon
                  name="i-heroicons-chevron-down"
                  class="-mt-0.5 h-2.5 w-2.5"
                  :class="getSortIconClass('groupNickname', 'desc')"
                />
              </span>
            </button>
            <button
              type="button"
              class="flex items-center justify-end gap-1.5 text-right transition-colors hover:text-gray-700 dark:hover:text-gray-200"
              @click="toggleSort('messageCount')"
            >
              {{ t('members.list.table.messageCount') }}
              <span class="flex shrink-0 flex-col leading-none">
                <UIcon
                  name="i-heroicons-chevron-up"
                  class="h-2.5 w-2.5"
                  :class="getSortIconClass('messageCount', 'asc')"
                />
                <UIcon
                  name="i-heroicons-chevron-down"
                  class="-mt-0.5 h-2.5 w-2.5"
                  :class="getSortIconClass('messageCount', 'desc')"
                />
              </span>
            </button>
            <button
              type="button"
              class="flex items-center justify-end gap-1.5 text-right transition-colors hover:text-gray-700 dark:hover:text-gray-200"
              @click="toggleSort('lastMessageTs')"
            >
              {{ t('members.list.table.lastMessageTime') }}
              <span class="flex shrink-0 flex-col leading-none">
                <UIcon
                  name="i-heroicons-chevron-up"
                  class="h-2.5 w-2.5"
                  :class="getSortIconClass('lastMessageTs', 'asc')"
                />
                <UIcon
                  name="i-heroicons-chevron-down"
                  class="-mt-0.5 h-2.5 w-2.5"
                  :class="getSortIconClass('lastMessageTs', 'desc')"
                />
              </span>
            </button>
            <span class="inline-flex items-center gap-1.5">
              <span>{{ t('members.list.table.customAlias') }}</span>
              <UTooltip :text="t('members.list.tip')" :popper="{ placement: 'top' }">
                <UIcon name="i-heroicons-question-mark-circle" class="h-4 w-4 text-gray-400 dark:text-gray-500" />
              </UTooltip>
            </span>
            <span class="text-right">{{ t('members.list.table.actions') }}</span>
          </div>

          <!-- 虚拟列表内容 -->
          <div ref="listScrollRef" class="min-h-0 flex-1 overflow-y-auto">
            <div class="relative" :style="{ height: `${virtualListHeight}px` }">
              <div
                v-for="{ virtualItem, member } in virtualMemberRows"
                :key="String(virtualItem.key)"
                :ref="measureVirtualRow"
                :data-index="virtualItem.index"
                class="member-table-grid absolute left-0 top-0 w-full min-h-16 border-b border-gray-100/80 px-3 py-2 transition-colors hover:bg-gray-50 dark:border-white/5 dark:hover:bg-gray-800/30"
                :class="[
                  memberTableGridClass,
                  showSelectionControls ? 'cursor-pointer' : '',
                  showSelectionControls && selectedMemberIds.has(member.id)
                    ? 'bg-primary-50/70 dark:bg-primary-950/20'
                    : '',
                ]"
                :style="{ transform: `translateY(${virtualItem.start}px)` }"
                @mousedown="handleMemberRowMouseDown"
                @click="handleMemberRowClick(virtualItem.index, member.id, $event)"
              >
                <div v-if="showSelectionControls" class="flex justify-center">
                  <UCheckbox
                    :model-value="selectedMemberIds.has(member.id)"
                    @click.stop="handleMemberRowClick(virtualItem.index, member.id, $event)"
                  />
                </div>

                <div class="flex min-w-0 items-center gap-2.5">
                  <LazyAvatar
                    :src="member.avatar"
                    :alt="getDisplayName(member)"
                    :text="getFirstChar(member)"
                    :fallback-class="[
                      'flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold',
                      'bg-primary-500 text-white',
                    ]"
                  />
                  <div class="min-w-0">
                    <p
                      class="truncate text-sm font-medium text-gray-900 dark:text-white"
                      :title="member.accountName || '-'"
                    >
                      {{ member.accountName || '-' }}
                    </p>
                    <p class="truncate text-xs text-gray-400 dark:text-gray-500" :title="member.platformId">
                      {{ member.platformId }}
                    </p>
                  </div>
                </div>

                <p
                  v-if="props.chatType === 'group'"
                  class="truncate text-sm text-gray-700 dark:text-gray-300"
                  :class="member.groupNickname ? 'font-medium' : 'text-gray-400 dark:text-gray-500'"
                  :title="member.groupNickname || '-'"
                >
                  {{ member.groupNickname || '-' }}
                </p>

                <span class="text-right font-mono text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                  {{ member.messageCount.toLocaleString() }}
                </span>

                <span
                  class="text-right font-mono text-xs tabular-nums text-gray-600 dark:text-gray-400"
                  :title="member.lastMessageTs === null ? '-' : formatDateTime(member.lastMessageTs)"
                >
                  {{ member.lastMessageTs === null ? '-' : formatDateTime(member.lastMessageTs) }}
                </span>

                <UInputTags
                  :model-value="member.aliases"
                  :placeholder="t('members.list.aliasPlaceholder')"
                  :loading="savingAliasIds.has(member.id)"
                  size="xs"
                  class="w-full"
                  @click.stop
                  @update:model-value="(val) => updateAliases(member, val)"
                />

                <div class="flex justify-end gap-1">
                  <UButton
                    icon="i-heroicons-chat-bubble-left-ellipsis"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :title="t('common.viewChatRecords')"
                    @click.stop="viewMemberChatRecords(member)"
                  />
                  <UButton
                    icon="i-heroicons-trash"
                    size="xs"
                    color="error"
                    variant="ghost"
                    :title="t('members.list.delete')"
                    @click.stop="showDeleteConfirm(member)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <UModal :open="!!deletingMember" :ui="{ content: 'max-w-sm' }" @update:open="deletingMember = null">
      <template #content>
        <div class="p-6 text-center">
          <div
            class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30"
          >
            <UIcon name="i-heroicons-exclamation-triangle" class="h-7 w-7 text-red-500" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">{{ t('members.list.modal.title') }}</h3>
          <p class="mb-6 text-sm text-gray-500 dark:text-gray-400">
            {{
              t('members.list.modal.content', {
                name: deletingMember ? getDisplayName(deletingMember) : '',
                count: deletingMember?.messageCount.toLocaleString(),
              })
            }}
          </p>
          <div class="flex justify-center gap-3">
            <UButton variant="outline" @click="cancelDelete">{{ t('members.list.modal.cancel') }}</UButton>
            <UButton color="error" :loading="isDeleting" @click="confirmDelete">
              {{ t('members.list.modal.confirm') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 批量删除确认弹窗 -->
    <UModal :open="showBatchDeleteModal" :ui="{ content: 'max-w-sm' }" @update:open="showBatchDeleteModal = $event">
      <template #content>
        <div class="p-6 text-center">
          <div
            class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30"
          >
            <UIcon name="i-heroicons-exclamation-triangle" class="h-7 w-7 text-red-500" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
            {{ t('members.list.batchDeleteModal.title') }}
          </h3>
          <p class="mb-6 text-sm text-gray-500 dark:text-gray-400">
            {{
              t('members.list.batchDeleteModal.content', {
                count: selectedMembers.length,
                messageCount: selectedMessageCount.toLocaleString(),
              })
            }}
          </p>
          <div class="flex justify-center gap-3">
            <UButton variant="outline" :disabled="isBatchDeleting" @click="showBatchDeleteModal = false">
              {{ t('members.list.modal.cancel') }}
            </UButton>
            <UButton color="error" :loading="isBatchDeleting" @click="confirmBatchDelete">
              {{ t('members.list.modal.confirm') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 合并确认弹窗 -->
    <UModal :open="showMergeModal" :ui="{ content: 'max-w-md' }" @update:open="showMergeModal = $event">
      <template #content>
        <div class="p-6">
          <div class="mb-4 flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <UIcon name="i-heroicons-link" class="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('members.list.mergeModal.title') }}
            </h3>
          </div>
          <p class="mb-2 text-sm text-gray-600 dark:text-gray-400">
            {{
              t('members.list.mergeModal.content', {
                source: mergePlan ? getDisplayName(mergePlan.secondary) : '',
                sourceCount: mergePlan ? mergePlan.secondary.messageCount.toLocaleString() : '0',
                target: mergePlan ? getDisplayName(mergePlan.primary) : '',
                targetCount: mergePlan ? mergePlan.primary.messageCount.toLocaleString() : '0',
              })
            }}
          </p>
          <p class="mb-6 text-xs text-amber-700 dark:text-amber-300">{{ t('members.list.mergeModal.hint') }}</p>
          <div class="flex justify-end gap-2">
            <UButton variant="outline" :disabled="isMerging" @click="showMergeModal = false">
              {{ t('members.list.mergeModal.cancel') }}
            </UButton>
            <UButton color="primary" :loading="isMerging" @click="confirmMerge">
              {{ t('members.list.mergeModal.confirm') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.member-table-grid {
  display: grid;
  grid-template-columns:
    40px minmax(220px, 1.45fr) minmax(120px, auto) 96px 148px minmax(280px, 1.35fr)
    80px;
  column-gap: 12px;
  align-items: center;
}

.member-table-grid--private {
  grid-template-columns: 40px minmax(220px, 1.45fr) 96px 148px minmax(280px, 1.35fr) 80px;
}

.member-table-grid--private-without-selection {
  grid-template-columns: minmax(220px, 1.45fr) 96px 148px minmax(280px, 1.35fr) 80px;
}
</style>
