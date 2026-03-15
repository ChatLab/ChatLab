<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useAssistantStore } from '@/stores/assistant'
import AssistantCard from './AssistantCard.vue'

const { t } = useI18n()

const props = defineProps<{
  chatType: 'group' | 'private'
  locale: string
}>()

const emit = defineEmits<{
  select: [id: string]
  configure: [id: string]
  market: []
}>()

const assistantStore = useAssistantStore()
const { filteredAssistants, isLoaded } = storeToRefs(assistantStore)

watch(
  () => [props.chatType, props.locale],
  ([chatType, locale]) => {
    assistantStore.setFilterContext(chatType as 'group' | 'private', locale as string)
  },
  { immediate: true }
)

onMounted(async () => {
  if (!isLoaded.value) {
    await assistantStore.loadAssistants()
  }
})

function handleSelect(id: string) {
  emit('select', id)
}

function handleConfigure(id: string) {
  emit('configure', id)
}
</script>

<template>
  <div class="flex h-full flex-col items-center p-8">
    <div class="flex w-full max-w-4xl flex-col" style="max-height: 100%">
      <!-- 标题 -->
      <div class="mb-8 shrink-0 text-center">
        <h2 class="mb-2 text-xl font-bold text-gray-900 dark:text-gray-100">{{ t('ai.assistant.selector.title') }}</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('ai.assistant.selector.subtitle') }}</p>
      </div>

      <!-- 无可用助手提示 -->
      <div v-if="filteredAssistants.length === 0" class="py-8 text-center text-sm text-gray-400">
        {{ t('ai.assistant.selector.noAssistants') }}
      </div>

      <!-- 助手卡片可滚动区域 -->
      <div class="max-h-[40vh] overflow-y-auto pr-1">
        <div class="assistant-grid">
          <AssistantCard
            v-for="assistant in filteredAssistants"
            :key="assistant.id"
            class="assistant-grid-item"
            :assistant="assistant"
            @select="handleSelect"
            @configure="handleConfigure"
          />
          <!-- 新增助手按钮 -->
          <div
            class="flex aspect-square w-[100px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 transition-all duration-200 hover:border-primary-400 hover:bg-primary-50/50 dark:border-gray-600 dark:hover:border-primary-500 dark:hover:bg-primary-950/20"
            @click="emit('market')"
          >
            <UIcon name="i-heroicons-plus" class="mb-1 h-5 w-5 text-gray-400 dark:text-gray-500" />
            <span class="text-xs text-gray-500 dark:text-gray-400">{{ t('ai.assistant.selector.addNew') }}</span>
          </div>
        </div>
      </div>

      <!-- 管理助手入口 -->
      <div class="mt-6 shrink-0 text-center">
        <button
          class="inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-primary-500 dark:text-gray-500 dark:hover:text-primary-400"
          @click="emit('market')"
        >
          <UIcon name="i-heroicons-cog-6-tooth" class="h-4 w-4" />
          <span>{{ t('ai.assistant.selector.manage') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 使用换行 flex 布局，让不足一整行的卡片（含最后一行剩余项）自动居中 */
.assistant-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: center;
}

/* 单卡宽度在 170~220px 之间收缩，最小窗口下可稳定维持约 3 列 */
.assistant-grid-item {
  min-width: 170px;
  flex: 0 1 220px;
}
</style>
