<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
}>()

interface ToolCatalogEntry {
  name: string
  category: 'core' | 'analysis'
  description: string
  parameters: Record<string, unknown>
}

interface ParamField {
  name: string
  type: string
  description: string
  required: boolean
  defaultValue?: unknown
  enumValues?: string[]
  isArray?: boolean
  arrayItemType?: string
}

const catalog = ref<ToolCatalogEntry[]>([])
const selectedToolName = ref('')
const paramValues = ref<Record<string, string>>({})
const isExecuting = ref(false)
const currentTestId = ref<string | null>(null)
const resultJson = ref<string | null>(null)
const resultError = ref<string | null>(null)
const resultTruncated = ref(false)
const elapsed = ref<number | null>(null)

function toolLabel(name: string): string {
  const key = `ai.chat.message.tools.${name}`
  const translated = t(key)
  return translated !== key ? translated : name
}

const coreTools = computed(() => catalog.value.filter((t) => t.category === 'core'))
const analysisTools = computed(() => catalog.value.filter((t) => t.category === 'analysis'))
const selectedTool = computed(() => catalog.value.find((t) => t.name === selectedToolName.value))

const paramFields = computed<ParamField[]>(() => {
  const tool = selectedTool.value
  if (!tool?.parameters) return []

  const params = tool.parameters as {
    properties?: Record<string, Record<string, unknown>>
    required?: string[]
  }
  if (!params.properties) return []

  const requiredSet = new Set(params.required ?? [])
  return Object.entries(params.properties).map(([name, schema]) => {
    const field: ParamField = {
      name,
      type: (schema.type as string) ?? 'string',
      description: (schema.description as string) ?? '',
      required: requiredSet.has(name),
      defaultValue: schema.default,
    }
    if (schema.enum) {
      field.enumValues = schema.enum as string[]
    }
    if (schema.type === 'array') {
      field.isArray = true
      const items = schema.items as Record<string, unknown> | undefined
      field.arrayItemType = (items?.type as string) ?? 'string'
    }
    return field
  })
})

watch(selectedToolName, () => {
  paramValues.value = {}
  resultJson.value = null
  resultError.value = null
  elapsed.value = null
})

onMounted(async () => {
  try {
    catalog.value = await window.aiApi.getToolCatalog()
    if (catalog.value.length > 0) {
      selectedToolName.value = catalog.value[0].name
    }
  } catch (e) {
    console.error('Failed to load tool catalog:', e)
  }
})

function buildParams(): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const field of paramFields.value) {
    const raw = paramValues.value[field.name]
    if (raw === undefined || raw === '') continue

    if (field.type === 'number') {
      const num = Number(raw)
      if (!isNaN(num)) result[field.name] = num
    } else if (field.isArray) {
      result[field.name] = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else {
      result[field.name] = raw
    }
  }
  return result
}

async function execute() {
  if (!selectedToolName.value || isExecuting.value) return
  isExecuting.value = true
  resultJson.value = null
  resultError.value = null
  resultTruncated.value = false
  elapsed.value = null

  const testId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  currentTestId.value = testId

  try {
    const params = buildParams()
    const res = await window.aiApi.executeTool(testId, selectedToolName.value, params, props.sessionId)
    if (res.error === 'cancelled') return
    if (res.success) {
      elapsed.value = res.elapsed ?? null
      resultTruncated.value = !!res.truncated
      resultJson.value = res.truncated
        ? (((res.details as Record<string, unknown>)?._preview as string) ?? '')
        : JSON.stringify(res.details ?? res.content, null, 2)
    } else {
      resultError.value = res.error ?? 'Unknown error'
    }
  } catch (e) {
    resultError.value = String(e)
  } finally {
    isExecuting.value = false
    currentTestId.value = null
  }
}

async function cancel() {
  if (currentTestId.value) {
    await window.aiApi.cancelToolTest(currentTestId.value)
    isExecuting.value = false
    currentTestId.value = null
  }
}
</script>

<template>
  <div class="flex h-full">
    <!-- Left Sidebar: Tool List -->
    <div
      class="w-56 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/50"
    >
      <!-- Core Tools Group -->
      <div v-if="coreTools.length > 0" class="py-2">
        <div class="px-3 py-1.5 text-[11px] font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
          {{ t('ai.lab.toolTest.coreTools') }}
        </div>
        <button
          v-for="tool in coreTools"
          :key="tool.name"
          class="flex w-full flex-col px-3 py-1.5 text-left transition-colors"
          :class="[
            selectedToolName === tool.name
              ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50',
          ]"
          :title="tool.description"
          @click="selectedToolName = tool.name"
        >
          <span class="truncate text-xs font-medium">{{ toolLabel(tool.name) }}</span>
          <span class="truncate text-[10px] opacity-50">{{ tool.name }}</span>
        </button>
      </div>

      <!-- Analysis Tools Group -->
      <div v-if="analysisTools.length > 0" class="border-t border-gray-200 py-2 dark:border-gray-700">
        <div class="px-3 py-1.5 text-[11px] font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
          {{ t('ai.lab.toolTest.analysisTools') }}
        </div>
        <button
          v-for="tool in analysisTools"
          :key="tool.name"
          class="flex w-full flex-col px-3 py-1.5 text-left transition-colors"
          :class="[
            selectedToolName === tool.name
              ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50',
          ]"
          :title="tool.description"
          @click="selectedToolName = tool.name"
        >
          <span class="truncate text-xs font-medium">{{ toolLabel(tool.name) }}</span>
          <span class="truncate text-[10px] opacity-50">{{ tool.name }}</span>
        </button>
      </div>
    </div>

    <!-- Right Content: Parameters + Result -->
    <div class="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <!-- Tool Description -->
      <div
        v-if="selectedTool"
        class="rounded-lg border border-primary-200 bg-primary-50/50 px-4 py-3 dark:border-primary-800 dark:bg-primary-900/20"
      >
        <div class="text-sm font-medium text-primary-700 dark:text-primary-300">
          {{ toolLabel(selectedTool.name) }}
        </div>
        <div class="mt-1 text-xs text-primary-600/70 dark:text-primary-400/70">
          {{ selectedTool.description }}
        </div>
      </div>

      <!-- Parameters Form -->
      <div v-if="paramFields.length > 0" class="flex flex-col gap-3">
        <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('ai.lab.toolTest.parameters') }}
        </h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="field in paramFields" :key="field.name" class="flex flex-col gap-1">
            <label class="text-xs font-medium text-gray-600 dark:text-gray-400">
              {{ field.name }}
              <span v-if="field.required" class="text-red-500">*</span>
              <span v-if="field.type === 'number'" class="ml-1 text-gray-400">(number)</span>
              <span v-if="field.isArray" class="ml-1 text-gray-400">({{ field.arrayItemType }}[])</span>
            </label>
            <USelectMenu
              v-if="field.enumValues"
              v-model="paramValues[field.name]"
              :items="field.enumValues"
              :placeholder="field.description"
              size="sm"
            />
            <UInput
              v-else
              v-model="paramValues[field.name]"
              :placeholder="
                field.isArray
                  ? t('ai.lab.toolTest.arrayPlaceholder')
                  : field.defaultValue !== undefined
                    ? String(field.defaultValue)
                    : field.description
              "
              :type="field.type === 'number' ? 'number' : 'text'"
              size="sm"
            />
          </div>
        </div>
      </div>

      <!-- Execute / Cancel Button -->
      <div class="flex items-center gap-3">
        <UButton
          v-if="!isExecuting"
          color="primary"
          :disabled="!selectedToolName"
          icon="i-heroicons-play"
          @click="execute"
        >
          {{ t('ai.lab.toolTest.execute') }}
        </UButton>
        <UButton v-else color="error" icon="i-heroicons-stop" @click="cancel">
          {{ t('ai.lab.toolTest.cancel') }}
        </UButton>
        <UIcon v-if="isExecuting" name="i-heroicons-arrow-path" class="h-4 w-4 animate-spin text-gray-400" />
        <span v-if="elapsed !== null" class="text-xs text-gray-500 dark:text-gray-400">
          {{ t('ai.lab.toolTest.elapsed', { ms: elapsed }) }}
        </span>
      </div>

      <!-- Result -->
      <div v-if="resultJson || resultError" class="flex-1 min-h-0">
        <h3 class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('ai.lab.toolTest.result') }}
        </h3>
        <div
          v-if="resultError"
          class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          {{ resultError }}
        </div>
        <template v-else>
          <div
            v-if="resultTruncated"
            class="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
          >
            {{ t('ai.lab.toolTest.truncated') }}
          </div>
          <pre
            class="max-h-[60vh] overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >{{ resultJson }}</pre
          >
        </template>
      </div>
    </div>
  </div>
</template>
