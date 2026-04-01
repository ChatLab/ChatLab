<script setup lang="ts">
/**
 * 条件筛选面板
 * 支持关键词、时间范围、发送者筛选，以及上下文扩展配置
 */

import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '@/stores/session'
import type { MemberWithStats } from '@/types/analysis'
import Tabs from '@/components/UI/Tabs.vue'

const { t } = useI18n()
const sessionStore = useSessionStore()

// Props
const keywords = defineModel<string[]>('keywords', { default: () => [] })
const timeRange = defineModel<{ start: number; end: number } | null>('timeRange', { default: null })
const senderIds = defineModel<number[]>('senderIds', { default: () => [] })
const contextSize = defineModel<number>('contextSize', { default: 10 })

// 关键词输入
const keywordInput = ref('')

// 成员列表
const members = ref<MemberWithStats[]>([])
const isLoadingMembers = ref(false)

// 时间范围选择
type TimeRangePreset = 'all' | 'today' | 'week' | 'month' | '3months' | 'year' | 'custom'
const timeRangeType = ref<TimeRangePreset>('all')
const customStartDate = ref('')
const customEndDate = ref('')

// 时间范围预设选项
const timeRangePresets = [
  { id: 'all' as TimeRangePreset, label: 'analysis.filter.allTime' },
  { id: 'today' as TimeRangePreset, label: 'analysis.filter.today' },
  { id: 'week' as TimeRangePreset, label: 'analysis.filter.lastWeek' },
  { id: 'month' as TimeRangePreset, label: 'analysis.filter.lastMonth' },
  { id: '3months' as TimeRangePreset, label: 'analysis.filter.last3Months' },
  { id: 'year' as TimeRangePreset, label: 'analysis.filter.lastYear' },
  { id: 'custom' as TimeRangePreset, label: 'analysis.filter.customTime' },
]

// 时间范围 Tabs 选项（用于 Tabs 组件）
const timeRangeTabItems = computed(() =>
  timeRangePresets.map((preset) => ({
    label: t(preset.label),
    value: preset.id,
  }))
)

// 监听时间范围类型变化
watch(timeRangeType, () => {
  updateTimeRange()
})

// 数据库时间范围
const dbTimeRange = ref<{ start: number; end: number } | null>(null)

// 加载成员列表
async function loadMembers() {
  const sessionId = sessionStore.currentSessionId
  if (!sessionId) return

  isLoadingMembers.value = true
  try {
    members.value = await window.chatApi.getMembers(sessionId)
  } catch (error) {
    console.error('加载成员失败:', error)
  } finally {
    isLoadingMembers.value = false
  }
}

// 加载时间范围
async function loadTimeRange() {
  const sessionId = sessionStore.currentSessionId
  if (!sessionId) return

  try {
    const range = await window.chatApi.getTimeRange(sessionId)
    if (range) {
      dbTimeRange.value = range
    }
  } catch (error) {
    console.error('加载时间范围失败:', error)
  }
}

// 添加关键词
function addKeyword() {
  const kw = keywordInput.value.trim()
  if (kw && !keywords.value.includes(kw)) {
    keywords.value = [...keywords.value, kw]
    keywordInput.value = ''
  }
}

// 移除关键词
function removeKeyword(kw: string) {
  keywords.value = keywords.value.filter((k) => k !== kw)
}

// 处理关键词输入回车
function handleKeywordKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    addKeyword()
  }
}

// 切换成员选择
function toggleMember(memberId: number) {
  if (senderIds.value.includes(memberId)) {
    senderIds.value = senderIds.value.filter((id) => id !== memberId)
  } else {
    senderIds.value = [...senderIds.value, memberId]
  }
}

// 更新时间范围
function updateTimeRange() {
  const now = Math.floor(Date.now() / 1000)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStart = Math.floor(today.getTime() / 1000)

  switch (timeRangeType.value) {
    case 'all':
      timeRange.value = null
      break
    case 'today':
      timeRange.value = { start: todayStart, end: now }
      break
    case 'week':
      timeRange.value = { start: now - 7 * 24 * 60 * 60, end: now }
      break
    case 'month':
      timeRange.value = { start: now - 30 * 24 * 60 * 60, end: now }
      break
    case '3months':
      timeRange.value = { start: now - 90 * 24 * 60 * 60, end: now }
      break
    case 'year':
      timeRange.value = { start: now - 365 * 24 * 60 * 60, end: now }
      break
    case 'custom':
      if (customStartDate.value && customEndDate.value) {
        const start = new Date(customStartDate.value).getTime() / 1000
        const end = new Date(customEndDate.value).getTime() / 1000 + 86399 // 当天结束
        timeRange.value = { start, end }
      }
      break
  }
}

// 成员搜索
const memberSearch = ref('')
const filteredMembers = computed(() => {
  if (!memberSearch.value) return members.value
  const search = memberSearch.value.toLowerCase()
  return members.value.filter(
    (m) =>
      m.accountName?.toLowerCase().includes(search) ||
      m.groupNickname?.toLowerCase().includes(search) ||
      m.platformId.toLowerCase().includes(search) ||
      m.aliases.some((a) => a.toLowerCase().includes(search))
  )
})

onMounted(() => {
  loadMembers()
  loadTimeRange()
})
</script>

<template>
  <div class="p-4 space-y-6">
    <!-- 关键词 -->
    <div>
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {{ t('analysis.filter.keywords') }}
        <span class="text-gray-500 text-xs ml-1">({{ t('analysis.filter.keywordsHint') }})</span>
      </label>

      <div class="flex gap-2 mb-2">
        <UInput
          v-model="keywordInput"
          :placeholder="t('analysis.filter.keywordPlaceholder')"
          class="flex-1"
          @keydown="handleKeywordKeydown"
        />
        <UButton size="sm" @click="addKeyword">{{ t('common.add') }}</UButton>
      </div>

      <div v-if="keywords.length > 0" class="flex flex-wrap gap-2">
        <UBadge v-for="kw in keywords" :key="kw" color="primary" variant="subtle" class="gap-1">
          {{ kw }}
          <button class="ml-1 hover:text-red-500" @click="removeKeyword(kw)">
            <UIcon name="i-heroicons-x-mark" class="w-3 h-3" />
          </button>
        </UBadge>
      </div>
    </div>

    <!-- 时间范围 -->
    <div>
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {{ t('analysis.filter.timeRange') }}
      </label>

      <div class="space-y-2">
        <!-- Tabs 选择器 -->
        <Tabs v-model="timeRangeType" :items="timeRangeTabItems" size="sm" />

        <!-- 自定义日期选择 -->
        <div v-if="timeRangeType === 'custom'" class="flex gap-2 items-center">
          <input
            v-model="customStartDate"
            type="date"
            class="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800"
            @change="updateTimeRange"
          />
          <span class="text-gray-500">~</span>
          <input
            v-model="customEndDate"
            type="date"
            class="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800"
            @change="updateTimeRange"
          />
        </div>
      </div>
    </div>

    <!-- 发送者筛选 -->
    <div>
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {{ t('analysis.filter.senders') }}
        <span class="text-gray-500 text-xs ml-1">({{ t('analysis.filter.sendersHint') }})</span>
      </label>

      <UInput
        v-model="memberSearch"
        :placeholder="t('analysis.filter.searchMember')"
        icon="i-heroicons-magnifying-glass"
        size="sm"
        class="mb-2"
      />

      <div class="max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md">
        <div v-if="isLoadingMembers" class="p-4 text-center text-gray-500">
          <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin" />
        </div>
        <div v-else-if="filteredMembers.length === 0" class="p-4 text-center text-gray-500 text-sm">
          {{ t('analysis.filter.noMembers') }}
        </div>
        <div v-else class="divide-y divide-gray-100 dark:divide-gray-700">
          <label
            v-for="member in filteredMembers"
            :key="member.id"
            class="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
          >
            <input
              type="checkbox"
              :checked="senderIds.includes(member.id)"
              class="text-primary-500 rounded"
              @change="toggleMember(member.id)"
            />
            <span class="text-sm text-gray-700 dark:text-gray-300 truncate">
              {{ member.groupNickname || member.accountName || member.platformId }}
            </span>
            <span class="text-xs text-gray-400 ml-auto">({{ member.messageCount }})</span>
          </label>
        </div>
      </div>

      <div v-if="senderIds.length > 0" class="mt-2 text-xs text-gray-500">
        {{ t('analysis.filter.selectedCount', { count: senderIds.length }) }}
      </div>
    </div>

    <!-- 上下文扩展 -->
    <div>
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {{ t('analysis.filter.contextSize') }}
        <span class="text-gray-500 text-xs ml-1">±{{ contextSize }} {{ t('analysis.filter.messages') }}</span>
      </label>

      <input
        v-model.number="contextSize"
        type="range"
        min="0"
        max="50"
        step="5"
        class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
      />

      <div class="flex justify-between text-xs text-gray-400 mt-1">
        <span>0</span>
        <span>25</span>
        <span>50</span>
      </div>
    </div>
  </div>
</template>
