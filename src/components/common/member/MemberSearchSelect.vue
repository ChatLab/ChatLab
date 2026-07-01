<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onClickOutside, useDebounceFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'

import { useDataService } from '@/services'
import type { MemberWithStats } from '@/types/analysis'
import { formatMemberOption, getMemberDisplayName, mergeMemberPages } from './member-select-utils'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    sessionId?: string
    modelValue: number | null
    memberName?: string
    placeholder?: string
    widthClass?: string
  }>(),
  {
    sessionId: '',
    memberName: '',
    placeholder: '',
    widthClass: 'w-40',
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | null): void
  (e: 'update:memberName', value: string): void
  (e: 'select', member: MemberWithStats): void
  (e: 'clear'): void
}>()

const PAGE_SIZE = 30
const LOAD_MORE_THRESHOLD_PX = 32

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const searchText = ref(props.memberName)
const members = ref<MemberWithStats[]>([])
const isLoading = ref(false)
const currentPage = ref(0)
const totalPages = ref(0)
const total = ref(0)
let requestSeq = 0

const options = computed(() => members.value.map(formatMemberOption))
const hasMore = computed(() => currentPage.value > 0 && currentPage.value < totalPages.value)
const displayPlaceholder = computed(() => props.placeholder || t('common.memberSearchSelect.placeholder'))

function clearSelection() {
  emit('update:modelValue', null)
  emit('update:memberName', '')
}

// 分页搜索请求可能被快速输入打乱顺序；用 requestSeq 只接收最后一次返回，避免旧结果覆盖新搜索。
async function loadMembers(reset: boolean) {
  if (!reset && (isLoading.value || !hasMore.value)) return

  if (!props.sessionId) {
    members.value = []
    currentPage.value = 0
    totalPages.value = 0
    total.value = 0
    return
  }

  const nextPage = reset ? 1 : currentPage.value + 1
  const seq = ++requestSeq
  isLoading.value = true

  try {
    const result = await useDataService().getMembersPaginated(props.sessionId, {
      page: nextPage,
      pageSize: PAGE_SIZE,
      search: searchText.value.trim(),
      sortOrder: 'desc',
    })

    if (seq !== requestSeq) return

    members.value = reset ? result.items : mergeMemberPages(members.value, result.items)
    currentPage.value = result.page
    totalPages.value = result.totalPages
    total.value = result.total
  } catch (error) {
    console.error('Failed to load members for search select:', error)
    if (seq === requestSeq && reset) {
      members.value = []
      currentPage.value = 0
      totalPages.value = 0
      total.value = 0
    }
  } finally {
    if (seq === requestSeq) {
      isLoading.value = false
    }
  }
}

function handleListScroll() {
  const list = listRef.value
  if (!list || !hasMore.value || isLoading.value) return

  const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight
  if (distanceToBottom <= LOAD_MORE_THRESHOLD_PX) {
    loadMembers(false)
  }
}

const debouncedReload = useDebounceFn(() => {
  if (open.value) {
    loadMembers(true)
  }
}, 250)

function handleInput() {
  if (props.modelValue !== null && searchText.value !== props.memberName) {
    clearSelection()
  }
  if (searchText.value.trim() === '') {
    clearSelection()
  }
  debouncedReload()
}

function handleOpen() {
  open.value = true
}

onClickOutside(rootRef, () => {
  open.value = false
})

function selectMember(member: MemberWithStats) {
  const name = getMemberDisplayName(member)
  searchText.value = name
  emit('update:modelValue', member.id)
  emit('update:memberName', name)
  emit('select', member)
  open.value = false
}

function handleClear() {
  searchText.value = ''
  members.value = []
  clearSelection()
  emit('clear')
  if (open.value) {
    loadMembers(true)
  }
}

watch(
  () => open.value,
  (isOpen) => {
    if (isOpen) {
      loadMembers(true)
    }
  }
)

watch(
  () => props.memberName,
  (name) => {
    if (props.modelValue !== null && name !== searchText.value) {
      searchText.value = name || ''
    }
  }
)

watch(
  () => props.sessionId,
  () => {
    searchText.value = ''
    members.value = []
    currentPage.value = 0
    totalPages.value = 0
    total.value = 0
    clearSelection()
  }
)
</script>

<template>
  <div ref="rootRef" class="relative" :class="widthClass">
    <div class="relative">
      <UInput
        v-model="searchText"
        icon="i-heroicons-user"
        :placeholder="displayPlaceholder"
        size="sm"
        class="w-full"
        :disabled="!sessionId"
        @focus="handleOpen"
        @click="handleOpen"
        @update:model-value="handleInput"
        @keydown.escape="open = false"
      />
      <button
        v-if="modelValue !== null || searchText"
        type="button"
        class="absolute top-1/2 right-2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        @click.stop="handleClear"
      >
        <UIcon name="i-heroicons-x-mark" class="h-3.5 w-3.5" />
      </button>
    </div>

    <div
      v-if="open"
      class="absolute top-full left-0 z-[100] mt-1 w-80 rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-950"
    >
      <div ref="listRef" class="max-h-80 overflow-y-auto py-1" @scroll="handleListScroll">
        <div v-if="isLoading && options.length === 0" class="px-3 py-3 text-sm text-gray-500">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="options.length === 0" class="px-3 py-3 text-sm text-gray-500">
          {{ t('common.noResults') }}
        </div>

        <button
          v-for="option in options"
          :key="option.id"
          type="button"
          class="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
          @click="selectMember(option.member)"
        >
          <img v-if="option.avatar" :src="option.avatar" :alt="option.label" class="h-7 w-7 rounded object-cover" />
          <div
            v-else
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gray-200 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-200"
          >
            {{ option.label.slice(0, 1) }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm text-gray-800 dark:text-gray-100">{{ option.label }}</div>
            <div class="truncate text-xs text-gray-500 dark:text-gray-400">
              {{ option.secondary || t('common.memberSearchSelect.noSecondary') }}
            </div>
          </div>
          <span class="shrink-0 text-xs text-gray-400">{{ option.messageCount }}</span>
        </button>

        <div
          v-if="isLoading && options.length > 0"
          class="flex items-center justify-center gap-1 px-3 py-2 text-xs text-gray-400"
        >
          <UIcon name="i-heroicons-arrow-path" class="h-3.5 w-3.5 animate-spin" />
          <span>{{ t('common.loading') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
