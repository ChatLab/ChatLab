<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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
  select: [payload: { id: string; remember: boolean }]
  configure: [id: string]
  market: []
}>()

const assistantStore = useAssistantStore()
const { filteredAssistants, isLoaded } = storeToRefs(assistantStore)
const rememberSelection = ref(true)

function getLocaleGeneralId(locale: string): string {
  if (locale.startsWith('ja')) return 'general_ja'
  if (locale.startsWith('en')) return 'general_en'
  return 'general_cn'
}

const sortedVisibleAssistants = computed(() => {
  const preferredGeneralId = getLocaleGeneralId(props.locale)
  return [...filteredAssistants.value].sort((a, b) => {
    if (a.id === preferredGeneralId) return -1
    if (b.id === preferredGeneralId) return 1
    return 0
  })
})

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
  emit('select', {
    id,
    remember: rememberSelection.value,
  })
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
      <div v-if="sortedVisibleAssistants.length === 0" class="py-8 text-center text-sm text-gray-400">
        {{ t('ai.assistant.selector.noAssistants') }}
      </div>

      <!-- 助手卡片可滚动区域 -->
      <div class="max-h-[40vh] overflow-y-auto pr-1">
        <div class="assistant-grid">
          <AssistantCard
            v-for="assistant in sortedVisibleAssistants"
            :key="assistant.id"
            class="assistant-grid-item"
            :assistant="assistant"
            @select="handleSelect"
            @configure="handleConfigure"
          />
          <!-- 新增助手按钮 -->
          <div
            class="assistant-grid-item flex h-[46px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3.5 transition-all duration-200 hover:border-primary-400 hover:bg-primary-50/50 dark:border-gray-600 dark:hover:border-primary-500 dark:hover:bg-primary-950/20"
            @click="emit('market')"
          >
            <UIcon name="i-heroicons-plus" class="h-4 w-4 text-gray-400 dark:text-gray-500" />
            <span class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('ai.assistant.selector.addNew') }}
            </span>
          </div>
        </div>
      </div>

      <div class="mt-4 shrink-0 text-center">
        <div class="inline-flex">
          <UCheckbox v-model="rememberSelection" :label="t('ai.assistant.selector.rememberSelection')" />
        </div>
      </div>

      <!-- 管理助手入口 -->
      <div class="mt-6 shrink-0 text-center">
        <UButton
          color="primary"
          variant="soft"
          size="sm"
          icon="i-heroicons-cog-6-tooth"
          @click="emit('market')"
        >
          {{ t('ai.assistant.selector.manage') }}
        </UButton>
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

/* 交给内容决定卡片宽度，形成更自然的标签式布局。 */
.assistant-grid-item {
  flex: 0 0 auto;
  max-width: 100%;
}
</style>
