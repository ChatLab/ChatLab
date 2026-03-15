<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownIt from 'markdown-it'
import { useSkillStore, type SkillSummary } from '@/stores/skill'

const { t, te } = useI18n()
const skillStore = useSkillStore()

const props = defineProps<{
  visible: boolean
  skills: SkillSummary[]
  highlightIndex: number
  activeSkillId?: string | null
}>()

const emit = defineEmits<{
  select: [skill: SkillSummary]
  close: []
  manage: []
  highlight: [index: number]
}>()

const previewPromptCache = ref<Record<string, string>>({})
const previewPrompt = ref('')
const previewLoading = ref(false)

// 与消息渲染保持一致，使用 markdown-it 展示技能 prompt 的结构化内容。
const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
})

const previewSkill = computed(() => {
  if (props.skills.length === 0) return null
  const index = Math.min(props.highlightIndex, props.skills.length - 1)
  return props.skills[index] ?? null
})

const renderedPreviewPrompt = computed(() => {
  if (!previewPrompt.value) return ''
  return md.render(previewPrompt.value)
})

function getToolLabel(toolName: string): string {
  const key = `ai.assistant.builtinToolDesc.${toolName}`
  return te(key) ? t(key) : toolName
}

const previewTagsText = computed(() => {
  return previewSkill.value?.tags.join(' / ') || ''
})

const previewToolsText = computed(() => {
  return previewSkill.value?.tools.map((tool) => getToolLabel(tool)).join(' / ') || ''
})

watch(
  () => [props.visible, previewSkill.value?.id] as const,
  async ([visible, skillId]) => {
    if (!visible || !skillId) {
      previewPrompt.value = ''
      previewLoading.value = false
      return
    }

    if (previewPromptCache.value[skillId]) {
      previewPrompt.value = previewPromptCache.value[skillId]
      previewLoading.value = false
      return
    }

    previewLoading.value = true
    const config = await skillStore.getSkillConfig(skillId)
    const prompt = config?.prompt?.trim() || ''
    previewPromptCache.value = {
      ...previewPromptCache.value,
      [skillId]: prompt,
    }

    // 仅在当前高亮项未变化时更新预览，避免异步请求回写旧数据。
    if (previewSkill.value?.id === skillId) {
      previewPrompt.value = prompt
      previewLoading.value = false
    }
  },
  { immediate: true }
)
</script>

<template>
  <Transition name="slash-menu">
    <div v-if="visible" class="absolute bottom-full left-0 z-20 mb-1.5 w-[240px] max-w-[calc(100vw-2rem)]">
      <div
        class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-900"
      >
        <div class="flex items-center justify-between border-b border-gray-100 px-2.5 py-1.5 dark:border-gray-800">
          <div class="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <span>{{ t('ai.chat.input.slashHint') }}</span>
          </div>
          <button
            type="button"
            class="rounded-md p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            :title="t('common.close')"
            @click="emit('close')"
          >
            <UIcon name="i-heroicons-x-mark" class="h-3.5 w-3.5" />
          </button>
        </div>

        <div v-if="props.skills.length > 0" class="max-h-72 overflow-y-auto p-1.5">
          <button
            v-for="(skill, index) in props.skills"
            :key="skill.id"
            type="button"
            class="flex w-full items-start justify-between gap-1.5 rounded-lg px-2.5 py-1.5 text-left transition-colors"
            :class="
              index === props.highlightIndex
                ? 'bg-primary-50 text-gray-900 dark:bg-primary-950/30 dark:text-gray-100'
                : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800/80'
            "
            @mouseenter="emit('highlight', index)"
            @click="emit('select', skill)"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="truncate text-xs font-medium">
                  {{ skill.name }}
                </span>
                <UIcon
                  v-if="props.activeSkillId === skill.id"
                  name="i-heroicons-check-circle-20-solid"
                  class="h-3.5 w-3.5 shrink-0 text-primary-500"
                />
              </div>

              <p class="mt-0.5 line-clamp-1 text-xs leading-4 text-gray-500 dark:text-gray-400">
                {{ skill.description }}
              </p>
            </div>
          </button>
        </div>

        <div v-else class="px-3 py-4 text-center">
          <p class="text-sm font-medium text-gray-700 dark:text-gray-200">
            {{ t('ai.chat.input.slashEmpty') }}
          </p>
          <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {{ t('ai.chat.input.slashEmptyHint') }}
          </p>
        </div>

        <button
          type="button"
          class="flex w-full items-center justify-between border-t border-gray-100 px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800/80 dark:hover:text-gray-100"
          @click="emit('manage')"
        >
          <span>{{ t('ai.chat.input.manageSkills') }}</span>
          <UIcon name="i-heroicons-arrow-top-right-on-square" class="h-3.5 w-3.5" />
        </button>
      </div>

      <!-- 让详情预览相对左侧菜单在 Y 轴居中，避免视觉上只偏向顶部或底部。 -->
      <div
        v-if="props.skills.length > 0 && previewSkill"
        class="absolute top-1/2 left-full ml-1 flex max-h-[min(348px,calc(100vh-10rem))] w-[300px] -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-900"
      >
        <div class="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
          <p class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {{ previewSkill.name }}
          </p>
          <p class="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {{ previewSkill.description }}
          </p>

          <div v-if="previewTagsText" class="mt-1 flex items-start gap-1.5 text-[11px] leading-4">
            <span class="shrink-0 font-medium text-gray-600 dark:text-gray-300">
              {{ t('ai.chat.input.previewTagsLabel') }}
            </span>
            <span class="line-clamp-1 min-w-0 flex-1 text-gray-500 dark:text-gray-400">
              {{ previewTagsText }}
            </span>
          </div>

          <div v-if="previewToolsText" class="mt-0.5 flex items-start gap-1.5 text-[11px] leading-4">
            <span class="shrink-0 font-medium text-gray-600 dark:text-gray-300">
              {{ t('ai.chat.input.previewToolsLabel') }}
            </span>
            <span class="line-clamp-1 min-w-0 flex-1 text-gray-500 dark:text-gray-400">
              {{ previewToolsText }}
            </span>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <div v-if="previewLoading" class="text-xs text-gray-400 dark:text-gray-500">
            {{ t('common.loading') }}
          </div>
          <div
            v-else-if="renderedPreviewPrompt"
            class="prose prose-sm max-w-none text-xs leading-5 dark:prose-invert prose-headings:mb-1.5 prose-headings:mt-2 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5"
            v-html="renderedPreviewPrompt"
          />
          <div v-else class="text-xs leading-relaxed text-gray-400 dark:text-gray-500">
            {{ t('ai.chat.input.previewUnavailable') }}
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slash-menu-enter-active,
.slash-menu-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.slash-menu-enter-from,
.slash-menu-leave-to {
  transform: translateY(8px);
  opacity: 0;
}
</style>
