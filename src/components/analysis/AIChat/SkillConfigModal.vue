<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillStore } from '@/stores/skill'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  skillId: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
  created: [id: string]
}>()

const skillStore = useSkillStore()

const rawMd = ref('')
const isLoading = ref(false)
const isSaving = ref(false)

const isCreateMode = ref(false)

const defaultTemplate = `---
name: ""
description: ""
tags: []
chatScope: all
tools: []
---

`

watch(
  () => [props.open, props.skillId] as const,
  async ([open, id]) => {
    if (!open) return

    if (!id) {
      isCreateMode.value = true
      rawMd.value = defaultTemplate
      return
    }

    isCreateMode.value = false
    isLoading.value = true
    try {
      const config = await skillStore.getSkillConfig(id)
      if (config) {
        const frontmatter = [
          '---',
          `name: "${config.name}"`,
          `description: "${config.description}"`,
          `tags: [${config.tags.map((t) => `"${t}"`).join(', ')}]`,
          `chatScope: ${config.chatScope}`,
          config.tools.length ? `tools: [${config.tools.map((t) => `"${t}"`).join(', ')}]` : 'tools: []',
          config.builtinId ? `builtinId: ${config.builtinId}` : '',
          '---',
          '',
          config.prompt,
        ]
          .filter(Boolean)
          .join('\n')
        rawMd.value = frontmatter
      }
    } finally {
      isLoading.value = false
    }
  },
  { immediate: true }
)

async function handleSave() {
  if (!rawMd.value.trim()) return
  isSaving.value = true

  try {
    if (isCreateMode.value) {
      const result = await skillStore.createSkill(rawMd.value)
      if (result.success && result.id) {
        emit('created', result.id)
        emit('update:open', false)
      }
    } else if (props.skillId) {
      const result = await skillStore.updateSkill(props.skillId, rawMd.value)
      if (result.success) {
        emit('saved')
        emit('update:open', false)
      }
    }
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal :open="open" :ui="{ content: 'sm:max-w-2xl z-50' }" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6">
        <!-- 标题 -->
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100">
            {{ isCreateMode ? t('ai.skill.config.createTitle') : t('ai.skill.config.editTitle') }}
          </h2>
          <button
            class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            @click="emit('update:open', false)"
          >
            <UIcon name="i-heroicons-x-mark" class="h-5 w-5" />
          </button>
        </div>

        <!-- 提示 -->
        <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
          {{ t('ai.skill.config.rawEditorHint') }}
        </p>

        <!-- Markdown 编辑器 -->
        <div v-if="isLoading" class="flex h-64 items-center justify-center text-gray-400">
          <UIcon name="i-heroicons-arrow-path" class="mr-2 h-5 w-5 animate-spin" />
        </div>
        <textarea
          v-else
          v-model="rawMd"
          class="h-[400px] w-full resize-none rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-xs text-gray-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          spellcheck="false"
        />

        <!-- 底部按钮 -->
        <div class="mt-4 flex justify-end gap-2">
          <button
            class="rounded-lg px-4 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            @click="emit('update:open', false)"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
            :disabled="isSaving || !rawMd.trim()"
            @click="handleSave"
          >
            {{ isCreateMode ? t('ai.skill.config.create') : t('ai.skill.config.save') }}
          </button>
        </div>
      </div>
    </template>
  </UModal>
</template>
