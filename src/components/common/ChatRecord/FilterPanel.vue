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
import TagInput from '@/components/common/TagInput.vue'
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

const advancedOpen = ref(false)
const markColors = [
  { value: 'amber', class: 'bg-amber-400' },
  { value: 'rose', class: 'bg-rose-400' },
  { value: 'violet', class: 'bg-violet-400' },
  { value: 'blue', class: 'bg-blue-400' },
  { value: 'emerald', class: 'bg-emerald-400' },
  { value: 'gray', class: 'bg-gray-400' },
]

// 本地表单数据
const formData = ref<FilterFormData>({
  messageId: '',
  memberId: null,
  memberName: '',
  keywords: '',
  startDate: '',
  endDate: '',
  markCategories: [],
  markColor: '',
  markComment: '',
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
        markCategories: [...(query.markCategories || [])],
        markColor: query.markColor || '',
        markComment: query.markComments?.join(', ') || '',
      }
      if (query.markCategories?.length || query.markColor || query.markComments?.length) advancedOpen.value = true
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
  const hasMarkFilter = f.markCategories.length > 0 || !!f.markColor || !!f.markComment.trim()

  // 消息 ID（只有在没有关键词时才使用）
  if (f.messageId && !hasKeywords && !hasMarkFilter) {
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

  if (hasMarkFilter) {
    query.markCategories = [...new Set(f.markCategories.map((category) => category.trim()).filter(Boolean))]
    query.markColor = f.markColor || undefined
    query.markComments = f.markComment
      .split(/[,，]/)
      .map((comment) => comment.trim())
      .filter(Boolean)
    formData.value.messageId = ''
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
    markCategories: [],
    markColor: '',
    markComment: '',
  }
  emit('reset')
}
</script>

<template>
  <div class="shrink-0 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex w-[200px] shrink-0 items-center gap-2">
        <UInput
          v-model="formData.messageId"
          type="number"
          :placeholder="t('records.filter.messageId')"
          size="sm"
          class="w-20 shrink-0"
        />
        <MemberSearchSelect
          v-model="formData.memberId"
          v-model:member-name="formData.memberName"
          :session-id="sessionId"
          :placeholder="t('records.filter.memberPlaceholder')"
          width-class="w-28"
          @select="applyFilter"
          @clear="applyFilter"
        />
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <DatePicker v-model="formData.startDate" :placeholder="t('records.filter.startDate')" width-class="w-28" />
        <span class="text-xs text-gray-400">~</span>
        <DatePicker v-model="formData.endDate" :placeholder="t('records.filter.endDate')" width-class="w-28" />
      </div>
      <UInput
        v-model="formData.keywords"
        :placeholder="t('records.filter.keywordsPlaceholder')"
        size="sm"
        class="min-w-24 max-w-[260px] flex-1"
        @keydown="handleKeywordsKeydown"
      />
      <div class="ml-auto flex shrink-0 gap-1">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          :icon="advancedOpen ? 'i-heroicons-chevron-double-up' : 'i-heroicons-chevron-double-down'"
          :aria-label="t('records.filter.advanced')"
          :title="t('records.filter.advanced')"
          @click="advancedOpen = !advancedOpen"
        />
        <UButton color="neutral" variant="ghost" size="sm" @click="resetFilter">
          {{ t('records.filter.reset') }}
        </UButton>
        <UButton color="primary" size="sm" @click="applyFilter">
          {{ t('records.filter.filter') }}
        </UButton>
      </div>
      <div v-if="advancedOpen" class="basis-full border-t border-gray-100 dark:border-gray-800" />
      <div v-if="advancedOpen" class="w-[200px] shrink-0">
        <TagInput
          v-model="formData.markCategories"
          size="sm"
          :placeholder="t('records.filter.markCategoriesPlaceholder')"
        />
      </div>
      <div
        v-if="advancedOpen"
        class="flex h-8 w-[238px] shrink-0 items-center gap-1.5 px-1"
        role="group"
        :aria-label="t('records.filter.markColor')"
        :title="t('records.filter.markColor')"
      >
        <button
          v-for="color in markColors"
          :key="color.value"
          type="button"
          class="size-5 rounded-full border-2"
          :class="[
            color.class,
            formData.markColor === color.value ? 'border-gray-900 dark:border-white' : 'border-transparent',
          ]"
          :aria-label="t(`records.markColors.${color.value}`)"
          :aria-pressed="formData.markColor === color.value"
          @click="formData.markColor = formData.markColor === color.value ? '' : color.value"
        />
      </div>
      <UInput
        v-if="advancedOpen"
        v-model="formData.markComment"
        size="sm"
        class="min-w-24 max-w-[260px] flex-1"
        :placeholder="t('records.filter.markCommentPlaceholder')"
        @keydown="handleKeywordsKeydown"
      />
    </div>
  </div>
</template>
