<script setup lang="ts">
/**
 * 聊天记录筛选面板
 * 支持消息ID、成员、时间范围、关键词的组合筛选
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import { DatePicker } from '@/components/UI'
import MemberSearchSelect from '@/components/common/member/MemberSearchSelect.vue'
import type { ChatRecordQuery, FilterFormData } from './types'

const { t } = useI18n()

const props = defineProps<{
  /** 当前查询条件 */
  query: ChatRecordQuery
  /** 当前会话 ID，用于分页搜索成员 */
  sessionId?: string
}>()

const emit = defineEmits<{
  /** 应用筛选 */
  (e: 'apply', query: ChatRecordQuery): void
  /** 重置筛选 */
  (e: 'reset'): void
}>()

// 本地表单数据
const formData = ref<FilterFormData>({
  messageId: '',
  memberId: null,
  memberName: '',
  keywords: '',
  startDate: '',
  endDate: '',
})

// 同步外部 query 到表单
watch(
  () => props.query,
  (query) => {
    if (query) {
      formData.value = {
        messageId: query.scrollToMessageId?.toString() || '',
        memberId: query.memberId ?? null,
        memberName: query.memberName || '',
        keywords: query.keywords?.join(', ') || '',
        startDate: query.startTs ? dayjs.unix(query.startTs).format('YYYY-MM-DD') : '',
        endDate: query.endTs ? dayjs.unix(query.endTs).format('YYYY-MM-DD') : '',
      }
    }
  },
  { immediate: true }
)

// 应用筛选
function applyFilter() {
  const f = formData.value
  const query: ChatRecordQuery = {}

  // 关键词和消息 ID 互斥：如果有关键词，则清空消息 ID
  const hasKeywords = f.keywords && f.keywords.trim()

  // 消息 ID（只有在没有关键词时才使用）
  if (f.messageId && !hasKeywords) {
    const id = parseInt(f.messageId, 10)
    if (!isNaN(id)) {
      query.scrollToMessageId = id
    }
  }

  // 成员筛选可与关键词、时间范围组合使用。
  if (f.memberId !== null) {
    query.memberId = f.memberId
    query.memberName = f.memberName
  }

  // 关键词
  if (hasKeywords) {
    const keywords = f.keywords
      .split(/[,，]/)
      .map((k) => k.trim())
      .filter((k) => k)
    if (keywords.length > 0) {
      query.keywords = keywords
      query.highlightKeywords = keywords
      // 清空消息 ID（互斥）
      formData.value.messageId = ''
    }
  }

  // 时间范围
  if (f.startDate) {
    query.startTs = dayjs(f.startDate).startOf('day').unix()
  }
  if (f.endDate) {
    query.endTs = dayjs(f.endDate).endOf('day').unix()
  }

  emit('apply', query)
}

// 回车搜索
function handleKeywordsKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    applyFilter()
  }
}

// 重置筛选
function resetFilter() {
  formData.value = {
    messageId: '',
    memberId: null,
    memberName: '',
    keywords: '',
    startDate: '',
    endDate: '',
  }
  emit('reset')
}
</script>

<template>
  <div class="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
    <!-- 第一行：消息ID、成员、时间范围 -->
    <div class="flex items-center gap-3">
      <UInput
        v-model="formData.messageId"
        type="number"
        :placeholder="t('records.filter.messageId')"
        size="sm"
        class="w-24"
      />
      <MemberSearchSelect
        v-model="formData.memberId"
        v-model:member-name="formData.memberName"
        :session-id="sessionId"
        :placeholder="t('records.filter.memberPlaceholder')"
        width-class="w-36"
        @select="applyFilter"
        @clear="applyFilter"
      />
      <div class="flex items-center gap-2">
        <DatePicker v-model="formData.startDate" :placeholder="t('records.filter.startDate')" />
        <span class="text-xs text-gray-400">~</span>
        <DatePicker v-model="formData.endDate" :placeholder="t('records.filter.endDate')" />
      </div>
    </div>

    <!-- 第二行：关键词和操作按钮 -->
    <div class="mt-2 flex items-center gap-3">
      <UInput
        v-model="formData.keywords"
        :placeholder="t('records.filter.keywordsPlaceholder')"
        size="sm"
        class="flex-1"
        @keydown="handleKeywordsKeydown"
      />
      <div class="flex gap-2">
        <UButton color="neutral" variant="ghost" size="sm" @click="resetFilter">
          {{ t('records.filter.reset') }}
        </UButton>
        <UButton color="primary" size="sm" @click="applyFilter">
          {{ t('records.filter.filter') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
