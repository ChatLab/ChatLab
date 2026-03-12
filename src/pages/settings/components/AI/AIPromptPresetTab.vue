<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { PromptPreset } from '@/types/ai'
import AIPromptEditModal from './AIPromptEditModal.vue'
import ImportPresetModal from './ImportPresetModal.vue'
import { usePromptStore } from '@/stores/prompt'

const { t } = useI18n()

// Store
const promptStore = usePromptStore()
const { allPromptPresets, aiPromptSettings } = storeToRefs(promptStore)

// Emits
const emit = defineEmits<{
  'config-changed': []
}>()

// 弹窗状态
const showEditModal = ref(false)
const showImportModal = ref(false)
const editMode = ref<'add' | 'edit'>('add')
const editingPreset = ref<PromptPreset | null>(null)

/** 打开新增预设弹窗 */
function openAddModal() {
  editMode.value = 'add'
  editingPreset.value = null
  showEditModal.value = true
}

/** 打开编辑预设弹窗 */
function openEditModal(preset: PromptPreset) {
  editMode.value = 'edit'
  editingPreset.value = preset
  showEditModal.value = true
}

/** 处理子弹窗保存后的回调 */
function handleModalSaved() {
  emit('config-changed')
}

/** 设置当前激活的预设 */
function setActivePreset(presetId: string) {
  promptStore.setActivePreset(presetId)
  emit('config-changed')
}

/** 复制选中的预设 */
function duplicatePreset(presetId: string) {
  promptStore.duplicatePromptPreset(presetId)
  emit('config-changed')
}

/** 删除选中的预设 */
function deletePreset(presetId: string) {
  promptStore.removePromptPreset(presetId)
  emit('config-changed')
}

/** 判断预设是否处于激活状态 */
function isActivePreset(presetId: string): boolean {
  return aiPromptSettings.value.activePresetId === presetId
}

/** 导入预设后的回调 */
function handleImportPresetAdded() {
  emit('config-changed')
}
</script>

<template>
  <div class="space-y-6">
    <!-- 系统提示词标题和操作按钮 -->
    <div class="flex items-center justify-between">
      <h4 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-document-text" class="h-4 w-4 text-amber-500" />
        {{ t('settings.aiPrompt.presets.title') }}
      </h4>
      <div class="flex items-center gap-2">
        <UButton variant="ghost" color="gray" size="xs" @click="openAddModal">
          <UIcon name="i-heroicons-plus" class="mr-1 h-3.5 w-3.5" />
          {{ t('settings.aiPrompt.presets.add') }}
        </UButton>
        <UButton variant="soft" color="primary" size="xs" @click="showImportModal = true">
          <UIcon name="i-heroicons-cloud-arrow-down" class="mr-1 h-3.5 w-3.5" />
          {{ t('settings.aiPrompt.presets.import') }}
        </UButton>
      </div>
    </div>

    <!-- 预设列表 -->
    <div class="space-y-2">
      <div
        v-for="preset in allPromptPresets"
        :key="preset.id"
        class="group flex cursor-pointer items-center justify-between rounded-lg border p-2.5 transition-colors"
        :class="[
          isActivePreset(preset.id)
            ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
            : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800',
        ]"
        @click="setActivePreset(preset.id)"
      >
        <!-- 预设信息 -->
        <div class="flex items-center gap-2">
          <div
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            :class="[
              isActivePreset(preset.id)
                ? 'bg-primary-500 text-white'
                : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
            ]"
          >
            <UIcon
              :name="isActivePreset(preset.id) ? 'i-heroicons-check' : 'i-heroicons-document-text'"
              class="h-3 w-3"
            />
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-medium text-gray-900 dark:text-white">{{ preset.name }}</span>
            <UBadge v-if="preset.isBuiltIn" color="gray" variant="soft" size="xs">
              {{ t('settings.aiPrompt.preset.builtIn') }}
            </UBadge>
            <!-- 适用场景标签（仅非通用预设显示） -->
            <UBadge
              v-if="!preset.isBuiltIn && preset.applicableTo && preset.applicableTo !== 'common'"
              :color="preset.applicableTo === 'group' ? 'violet' : 'blue'"
              variant="soft"
              size="xs"
            >
              {{
                preset.applicableTo === 'group'
                  ? t('settings.aiPrompt.preset.groupOnly')
                  : t('settings.aiPrompt.preset.privateOnly')
              }}
            </UBadge>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            :icon="preset.isBuiltIn ? 'i-heroicons-eye' : 'i-heroicons-pencil-square'"
            @click="openEditModal(preset)"
          />
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-heroicons-document-duplicate"
            @click="duplicatePreset(preset.id)"
          />
          <UButton
            v-if="!preset.isBuiltIn"
            color="error"
            variant="ghost"
            size="xs"
            icon="i-heroicons-trash"
            @click="deletePreset(preset.id)"
          />
        </div>
      </div>
    </div>

    <!-- 说明文字 -->
    <p class="text-xs text-gray-500 dark:text-gray-400">
      {{ t('settings.aiPrompt.presets.description') }}
    </p>
  </div>

  <!-- 编辑/添加弹窗 -->
  <AIPromptEditModal v-model:open="showEditModal" :mode="editMode" :preset="editingPreset" @saved="handleModalSaved" />

  <!-- 导入预设弹窗 -->
  <ImportPresetModal v-model:open="showImportModal" @preset-added="handleImportPresetAdded" />
</template>
