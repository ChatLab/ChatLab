<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePromptStore, type RemotePresetData } from '@/stores/prompt'

const { t, locale } = useI18n()
const promptStore = usePromptStore()

// Props
const props = defineProps<{
  open: boolean
}>()

// Emits
const emit = defineEmits<{
  'update:open': [value: boolean]
  'preset-added': []
}>()

// 状态
const isLoading = ref(false)
const error = ref('')
const remotePresets = ref<RemotePresetData[]>([])

// 预览状态
const previewPreset = ref<RemotePresetData | null>(null)
const isPreviewLoading = ref(false)
const previewError = ref('')

// 添加状态（跟踪正在添加的预设 ID）
const addingPresetId = ref<string | null>(null)

// 预设分组配置
const presetGroups = computed(() => [
  {
    key: 'common',
    icon: 'i-heroicons-squares-2x2',
    iconColor: 'text-emerald-500',
    titleKey: 'settings.aiPrompt.importPreset.commonPresets',
    presets: remotePresets.value.filter((p) => p.chatType === 'common' || !p.chatType),
  },
  {
    key: 'group',
    icon: 'i-heroicons-chat-bubble-left-right',
    iconColor: 'text-violet-500',
    titleKey: 'settings.aiPrompt.importPreset.groupPresets',
    presets: remotePresets.value.filter((p) => p.chatType === 'group'),
  },
  {
    key: 'private',
    icon: 'i-heroicons-user',
    iconColor: 'text-blue-500',
    titleKey: 'settings.aiPrompt.importPreset.privatePresets',
    presets: remotePresets.value.filter((p) => p.chatType === 'private'),
  },
])

// 加载远程预设索引（不下载内容）
async function loadRemotePresets() {
  isLoading.value = true
  error.value = ''

  try {
    const presets = await promptStore.fetchRemotePresets(locale.value)
    remotePresets.value = presets

    if (presets.length === 0) {
      error.value = t('settings.aiPrompt.importPreset.noPresets')
    }
  } catch (e) {
    error.value = t('settings.aiPrompt.importPreset.loadError')
  } finally {
    isLoading.value = false
  }
}

// 预览预设（按需下载内容）
async function handlePreview(preset: RemotePresetData) {
  previewError.value = ''

  if (preset.systemPrompt) {
    previewPreset.value = preset
    return
  }

  isPreviewLoading.value = true
  previewPreset.value = preset // 先显示基本信息

  const fullPreset = await promptStore.fetchPresetContent(preset)
  if (fullPreset) {
    previewPreset.value = fullPreset
    // 更新列表中的缓存
    const index = remotePresets.value.findIndex((p) => p.id === preset.id)
    if (index !== -1) {
      remotePresets.value[index] = fullPreset
    }
  } else {
    previewError.value = t('settings.aiPrompt.importPreset.fetchError')
  }

  isPreviewLoading.value = false
}

// 关闭预览
function closePreview() {
  previewPreset.value = null
  previewError.value = ''
}

// 添加预设（按需下载后再添加）
async function handleAddPreset(preset: RemotePresetData) {
  addingPresetId.value = preset.id

  let fullPreset = preset
  if (!preset.systemPrompt) {
    const fetched = await promptStore.fetchPresetContent(preset)
    if (!fetched) {
      addingPresetId.value = null
      return
    }
    fullPreset = fetched
    // 更新列表中的缓存
    const index = remotePresets.value.findIndex((p) => p.id === preset.id)
    if (index !== -1) {
      remotePresets.value[index] = fullPreset
    }
  }

  const success = promptStore.addRemotePreset(fullPreset)
  if (success) {
    emit('preset-added')
  }
  addingPresetId.value = null
}

// 从预览弹窗添加预设（添加后自动关闭预览）
async function handleAddPresetFromPreview() {
  if (!previewPreset.value) return
  await handleAddPreset(previewPreset.value)
  closePreview()
}

// 关闭弹窗
function closeModal() {
  emit('update:open', false)
  closePreview()
}

// 监听打开状态，打开时加载数据
watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      loadRemotePresets()
    } else {
      closePreview()
    }
  }
)
</script>

<template>
  <UModal :open="open" :ui="{ content: 'md:w-full max-w-lg' }" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6">
        <!-- Header -->
        <div class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-cloud-arrow-down" class="h-5 w-5 text-primary-500" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('settings.aiPrompt.importPreset.title') }}
            </h2>
          </div>
          <UButton icon="i-heroicons-x-mark" variant="ghost" size="sm" @click="closeModal" />
        </div>

        <!-- 描述 -->
        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {{ t('settings.aiPrompt.importPreset.description') }}
        </p>

        <!-- 内容区域 -->
        <div class="max-h-[400px] overflow-y-auto">
          <!-- 加载中 -->
          <div v-if="isLoading" class="flex flex-col items-center justify-center py-12">
            <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-primary-500" />
            <p class="mt-2 text-sm text-gray-500">{{ t('settings.aiPrompt.importPreset.loading') }}</p>
          </div>

          <!-- 错误状态 -->
          <div v-else-if="error" class="flex flex-col items-center justify-center py-12">
            <UIcon name="i-heroicons-exclamation-circle" class="h-8 w-8 text-red-500" />
            <p class="mt-2 text-sm text-gray-500">{{ error }}</p>
            <UButton variant="soft" size="sm" class="mt-4" @click="loadRemotePresets">
              {{ t('common.retry') }}
            </UButton>
          </div>

          <!-- 预设列表 -->
          <div v-else class="space-y-4">
            <!-- 预设分组 -->
            <div v-for="group in presetGroups" :key="group.key">
              <div v-if="group.presets.length > 0">
                <h4 class="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <UIcon :name="group.icon" class="h-4 w-4" :class="group.iconColor" />
                  {{ t(group.titleKey) }}
                </h4>
                <div class="space-y-2">
                  <div
                    v-for="preset in group.presets"
                    :key="preset.id"
                    class="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-gray-900 dark:text-white">{{ preset.name }}</p>
                      <p class="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                        {{ preset.description || t('settings.aiPrompt.importPreset.noDescription') }}
                      </p>
                    </div>
                    <div class="flex items-center gap-1.5 ml-2 shrink-0">
                      <!-- 预览按钮 -->
                      <UButton color="gray" size="xs" @click="handlePreview(preset)">
                        <UIcon name="i-heroicons-eye" class="mr-1 h-3.5 w-3.5" />
                        {{ t('settings.aiPrompt.importPreset.preview') }}
                      </UButton>
                      <!-- 添加按钮 -->
                      <UButton
                        v-if="promptStore.isRemotePresetAdded(preset.id)"
                        variant="soft"
                        color="gray"
                        size="xs"
                        disabled
                      >
                        <UIcon name="i-heroicons-check" class="mr-1 h-3.5 w-3.5" />
                        {{ t('settings.aiPrompt.importPreset.added') }}
                      </UButton>
                      <UButton
                        v-else
                        variant="soft"
                        color="primary"
                        size="xs"
                        :loading="addingPresetId === preset.id"
                        @click="handleAddPreset(preset)"
                      >
                        <UIcon v-if="addingPresetId !== preset.id" name="i-heroicons-plus" class="mr-1 h-3.5 w-3.5" />
                        {{ t('settings.aiPrompt.importPreset.add') }}
                      </UButton>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UModal>

  <!-- 预览弹窗 -->
  <UModal :open="!!previewPreset" :ui="{ content: 'md:w-full max-w-2xl' }" @update:open="closePreview">
    <template #content>
      <div class="p-6">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ previewPreset?.name }}
          </h3>
          <UButton icon="i-heroicons-x-mark" variant="ghost" size="sm" @click="closePreview" />
        </div>

        <!-- 加载中 -->
        <div v-if="isPreviewLoading" class="flex items-center justify-center py-8">
          <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-primary-500" />
          <span class="ml-2 text-sm text-gray-500">{{ t('settings.aiPrompt.importPreset.fetchingContent') }}</span>
        </div>

        <!-- 错误 -->
        <div v-else-if="previewError" class="text-center py-8">
          <UIcon name="i-heroicons-exclamation-circle" class="h-8 w-8 text-red-500 mx-auto" />
          <p class="mt-2 text-sm text-gray-500">{{ previewError }}</p>
        </div>

        <!-- 内容 -->
        <div v-else-if="previewPreset?.systemPrompt" class="max-h-[60vh] overflow-y-auto space-y-4">
          <div>
            <p class="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
              {{ t('settings.aiPrompt.importPreset.systemPrompt') }}
            </p>
            <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
              <p class="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">
                {{ previewPreset.systemPrompt }}
              </p>
            </div>
          </div>
        </div>

        <!-- 底部按钮 -->
        <div
          v-if="previewPreset && !isPreviewLoading && !previewError"
          class="mt-4 flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700"
        >
          <UButton variant="ghost" color="gray" @click="closePreview">
            {{ t('common.close') }}
          </UButton>
          <UButton
            v-if="!promptStore.isRemotePresetAdded(previewPreset.id)"
            color="primary"
            :loading="addingPresetId === previewPreset.id"
            @click="handleAddPresetFromPreview"
          >
            <UIcon v-if="addingPresetId !== previewPreset.id" name="i-heroicons-plus" class="mr-1 h-4 w-4" />
            {{ t('settings.aiPrompt.importPreset.add') }}
          </UButton>
          <UButton v-else variant="soft" color="gray" disabled>
            <UIcon name="i-heroicons-check" class="mr-1 h-4 w-4" />
            {{ t('settings.aiPrompt.importPreset.added') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
