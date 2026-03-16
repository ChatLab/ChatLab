<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@nuxt/ui/runtime/composables/useToast.js'
import { useAssistantStore, type AssistantConfigFull } from '@/stores/assistant'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  assistantId: string | null
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
  created: [id: string]
}>()

const toast = useToast()
const assistantStore = useAssistantStore()

const isLoading = ref(false)
const isSaving = ref(false)
const config = ref<AssistantConfigFull | null>(null)
const isCreateMode = ref(false)
const activeTab = ref<'basic' | 'tools'>('basic')

const chatTypeOptions = computed(() => [
  { value: '', label: t('ai.assistant.config.chatTypeAll') },
  { value: 'group', label: t('ai.assistant.config.chatTypeGroup') },
  { value: 'private', label: t('ai.assistant.config.chatTypePrivate') },
])

const localeOptions = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' },
]

const BUILTIN_TS_TOOLS = computed(() =>
  assistantStore.builtinTsToolNames.map((name) => ({
    name,
    description: t(`ai.assistant.builtinToolDesc.${name}`),
  }))
)

const form = ref({
  name: '',
  systemPrompt: '',
  presetQuestions: [] as string[],
  applicableChatType: '' as string,
  supportedLocales: [] as string[],
  allowedBuiltinTools: [] as string[],
})

const newQuestion = ref('')

const toolBadgeCount = computed(() => form.value.allowedBuiltinTools.length)

onMounted(async () => {
  if (assistantStore.builtinTsToolNames.length === 0) {
    await assistantStore.loadBuiltinTsToolNames()
  }
})

watch(
  () => [props.open, props.assistantId],
  async ([visible, id]) => {
    if (!visible) return
    activeTab.value = 'basic'
    if (id) {
      isCreateMode.value = false
      await loadConfig(id as string)
    } else if (!props.readonly) {
      isCreateMode.value = true
      initEmptyForm()
    }
  },
  { immediate: true }
)

function initEmptyForm() {
  config.value = {
    id: '',
    name: '',
    systemPrompt: '',
    presetQuestions: [],
    allowedBuiltinTools: [],
    applicableChatTypes: [],
    supportedLocales: [],
  }
  form.value = {
    name: '',
    systemPrompt: '',
    presetQuestions: [],
    applicableChatType: '',
    supportedLocales: [],
    allowedBuiltinTools: [],
  }
  isLoading.value = false
}

async function loadConfig(id: string) {
  isLoading.value = true
  try {
    config.value = await assistantStore.getAssistantConfig(id)
    if (config.value) {
      form.value = {
        name: config.value.name,
        systemPrompt: config.value.systemPrompt,
        presetQuestions: [...config.value.presetQuestions],
        applicableChatType: config.value.applicableChatTypes?.[0] || '',
        supportedLocales: [...(config.value.supportedLocales || [])],
        allowedBuiltinTools: [...(config.value.allowedBuiltinTools || [])],
      }
    }
  } catch (error) {
    console.error('[AssistantConfigModal] Failed to load config:', error)
    toast.add({ title: t('ai.assistant.toast.loadFailed'), description: String(error), color: 'error' })
  } finally {
    isLoading.value = false
  }
}

async function handleSave() {
  isSaving.value = true
  try {
    const payload = {
      name: form.value.name,
      systemPrompt: form.value.systemPrompt,
      presetQuestions: [...form.value.presetQuestions],
      applicableChatTypes: form.value.applicableChatType
        ? ([form.value.applicableChatType] as ('group' | 'private')[])
        : ([] as ('group' | 'private')[]),
      supportedLocales: [...form.value.supportedLocales],
      allowedBuiltinTools: [...form.value.allowedBuiltinTools],
    }

    if (isCreateMode.value) {
      const result = await assistantStore.createAssistant(payload)
      if (result.success) {
        toast.add({ title: t('ai.assistant.toast.createSuccess'), color: 'success' })
        emit('created', result.id!)
        closeModal()
      } else {
        toast.add({
          title: t('ai.assistant.toast.createFailed'),
          description: result.error || t('ai.assistant.toast.unknownError'),
          color: 'error',
        })
      }
    } else {
      if (!props.assistantId) return
      const result = await assistantStore.updateAssistant(props.assistantId, payload)
      if (result.success) {
        toast.add({ title: t('ai.assistant.toast.saveSuccess'), color: 'success' })
        emit('saved')
        closeModal()
      } else {
        toast.add({
          title: t('ai.assistant.toast.saveFailed'),
          description: result.error || t('ai.assistant.toast.unknownError'),
          color: 'error',
        })
      }
    }
  } catch (error) {
    console.error('[AssistantConfigModal] Save failed:', error)
    toast.add({ title: t('ai.assistant.toast.saveFailed'), description: String(error), color: 'error' })
  } finally {
    isSaving.value = false
  }
}

async function handleReset() {
  if (!props.assistantId || !config.value?.builtinId) return

  isSaving.value = true
  try {
    const result = await assistantStore.resetAssistant(props.assistantId)
    if (result.success) {
      toast.add({ title: t('ai.assistant.toast.resetSuccess'), color: 'success' })
      await loadConfig(props.assistantId)
      emit('saved')
    } else {
      toast.add({
        title: t('ai.assistant.toast.resetFailed'),
        description: result.error || t('ai.assistant.toast.unknownError'),
        color: 'error',
      })
    }
  } catch (error) {
    toast.add({ title: t('ai.assistant.toast.resetFailed'), description: String(error), color: 'error' })
  } finally {
    isSaving.value = false
  }
}

function addQuestion() {
  const q = newQuestion.value.trim()
  if (q && !form.value.presetQuestions.includes(q)) {
    form.value.presetQuestions.push(q)
    newQuestion.value = ''
  }
}

function removeQuestion(index: number) {
  form.value.presetQuestions.splice(index, 1)
}

function toggleBuiltinTool(toolName: string) {
  const idx = form.value.allowedBuiltinTools.indexOf(toolName)
  if (idx >= 0) {
    form.value.allowedBuiltinTools.splice(idx, 1)
  } else {
    form.value.allowedBuiltinTools.push(toolName)
  }
}

function isToolChecked(toolName: string): boolean {
  if (form.value.allowedBuiltinTools.length === 0) return true
  return form.value.allowedBuiltinTools.includes(toolName)
}

function selectAllTools() {
  form.value.allowedBuiltinTools = BUILTIN_TS_TOOLS.value.map((t) => t.name)
}

function clearAllTools() {
  form.value.allowedBuiltinTools = []
}

function selectChatType(value: string) {
  form.value.applicableChatType = value
}

function toggleLocale(value: string) {
  const idx = form.value.supportedLocales.indexOf(value)
  if (idx >= 0) {
    form.value.supportedLocales.splice(idx, 1)
  } else {
    form.value.supportedLocales.push(value)
  }
}

function closeModal() {
  emit('update:open', false)
}
</script>

<template>
  <UModal :open="open" :ui="{ content: 'sm:max-w-2xl z-100' }" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6">
        <!-- Header -->
        <div class="mb-4 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{
                readonly
                  ? t('ai.assistant.config.viewTitle')
                  : isCreateMode
                    ? t('ai.assistant.config.createTitle')
                    : t('ai.assistant.config.editTitle')
              }}
            </h2>
            <!-- 测试阶段提示：仅在新建/编辑模式展示，查看模式不显示 -->
            <p v-if="!readonly" class="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {{ t('ai.assistant.config.betaWarning') }}
            </p>
          </div>
          <UButton icon="i-heroicons-x-mark" variant="ghost" size="sm" class="shrink-0" @click="closeModal" />
        </div>

        <!-- Loading -->
        <div v-if="isLoading" class="flex items-center justify-center py-12">
          <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-gray-400" />
        </div>

        <!-- Tabs + Content -->
        <template v-else-if="config">
          <!-- Tab 切换 -->
          <div class="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            <button
              class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              :class="
                activeTab === 'basic'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
              "
              @click="activeTab = 'basic'"
            >
              {{ t('ai.assistant.config.tabs.basic') }}
            </button>
            <button
              class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              :class="
                activeTab === 'tools'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
              "
              @click="activeTab = 'tools'"
            >
              {{ t('ai.assistant.config.tabs.tools') }}
              <span
                v-if="toolBadgeCount > 0"
                class="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-100 px-1 text-[10px] text-primary-600 dark:bg-primary-900/30 dark:text-primary-400"
              >
                {{ toolBadgeCount }}
              </span>
            </button>
          </div>

          <div class="max-h-[500px] overflow-y-auto pr-1">
            <!-- 基础配置 Tab -->
            <div v-show="activeTab === 'basic'" class="space-y-5">
              <div>
                <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('ai.assistant.config.name') }}
                </label>
                <UInput v-model="form.name" class="w-full" :disabled="readonly" />
              </div>

              <div>
                <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('ai.assistant.config.systemPrompt') }}
                </label>
                <UTextarea
                  v-model="form.systemPrompt"
                  :rows="5"
                  autoresize
                  class="w-full font-mono text-sm"
                  :disabled="readonly"
                />
              </div>

              <div>
                <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('ai.assistant.config.chatType') }}
                </label>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="opt in chatTypeOptions"
                    :key="opt.value"
                    type="button"
                    class="rounded-lg border px-3 py-1.5 text-xs transition-colors"
                    :class="
                      form.applicableChatType === opt.value
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-950/30 dark:text-primary-300'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400'
                    "
                    :disabled="readonly"
                    @click="selectChatType(opt.value)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>

              <div>
                <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('ai.assistant.config.locale') }}
                </label>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="opt in localeOptions"
                    :key="opt.value"
                    type="button"
                    class="rounded-lg border px-3 py-1.5 text-xs transition-colors"
                    :class="
                      form.supportedLocales.includes(opt.value)
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-950/30 dark:text-primary-300'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400'
                    "
                    :disabled="readonly"
                    @click="toggleLocale(opt.value)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
                <p class="mt-1 text-[10px] text-gray-400">{{ t('ai.assistant.config.localeHint') }}</p>
              </div>

              <div>
                <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('ai.assistant.config.presetQuestions') }}
                </label>
                <div class="space-y-2">
                  <div v-for="(q, index) in form.presetQuestions" :key="index" class="flex items-center gap-2">
                    <UInput
                      v-model="form.presetQuestions[index]"
                      class="min-w-0 flex-1"
                      size="sm"
                      :disabled="readonly"
                    />
                    <UButton
                      v-if="!readonly"
                      color="error"
                      variant="ghost"
                      icon="i-heroicons-trash"
                      size="xs"
                      class="shrink-0"
                      @click="removeQuestion(index)"
                    />
                  </div>
                  <div v-if="!readonly" class="flex items-center gap-2">
                    <UInput
                      v-model="newQuestion"
                      :placeholder="t('ai.assistant.config.addQuestion')"
                      class="min-w-0 flex-1"
                      size="sm"
                      @keyup.enter="addQuestion"
                    />
                    <UButton
                      color="primary"
                      variant="soft"
                      icon="i-heroicons-plus"
                      size="xs"
                      class="shrink-0"
                      @click="addQuestion"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- 工具管理 Tab -->
            <div v-show="activeTab === 'tools'" class="space-y-6">
              <!-- 内置工具勾选区 -->
              <div>
                <div class="mb-2 flex items-center justify-between">
                  <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {{ t('ai.assistant.config.builtinTools') }}
                  </h3>
                  <div v-if="!readonly" class="flex gap-2">
                    <button class="text-[10px] text-primary-500 hover:text-primary-600" @click="selectAllTools">
                      {{ t('ai.assistant.config.selectAll') }}
                    </button>
                    <span class="text-[10px] text-gray-300 dark:text-gray-600">|</span>
                    <button class="text-[10px] text-primary-500 hover:text-primary-600" @click="clearAllTools">
                      {{ t('ai.assistant.config.deselectAll') }}
                    </button>
                  </div>
                </div>
                <p class="mb-3 text-[10px] text-gray-400">
                  {{ t('ai.assistant.config.builtinToolsHint') }}
                </p>
                <div class="grid grid-cols-2 gap-1.5">
                  <label
                    v-for="tool in BUILTIN_TS_TOOLS"
                    :key="tool.name"
                    class="flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 transition-colors"
                    :class="
                      isToolChecked(tool.name)
                        ? 'border-primary-200 bg-primary-50/50 dark:border-primary-800 dark:bg-primary-950/20'
                        : 'border-gray-200 dark:border-gray-700'
                    "
                  >
                    <input
                      type="checkbox"
                      :checked="form.allowedBuiltinTools.includes(tool.name)"
                      :disabled="readonly"
                      class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      @change="toggleBuiltinTool(tool.name)"
                    />
                    <div class="min-w-0">
                      <div class="truncate text-xs font-medium text-gray-800 dark:text-gray-200">{{ tool.name }}</div>
                      <div class="truncate text-[10px] text-gray-500 dark:text-gray-400">{{ tool.description }}</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="mt-6 flex items-center justify-between">
            <div>
              <UButton
                v-if="!readonly && !isCreateMode && config?.builtinId"
                variant="outline"
                color="warning"
                :loading="isSaving"
                @click="handleReset"
              >
                {{ t('ai.assistant.config.resetDefault') }}
              </UButton>
            </div>
            <div class="flex gap-2">
              <UButton variant="ghost" @click="closeModal">
                {{ readonly ? t('common.close') : t('common.cancel') }}
              </UButton>
              <UButton v-if="!readonly" color="primary" :loading="isSaving" @click="handleSave">
                {{ isCreateMode ? t('ai.assistant.config.create') : t('common.save') }}
              </UButton>
            </div>
          </div>
        </template>
      </div>
    </template>
  </UModal>
</template>
