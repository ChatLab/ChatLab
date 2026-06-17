<script setup lang="ts">
/**
 * 语义索引对话选择弹窗（批量启用/停用）
 *
 * 勾选 = 启用该对话语义索引；取消勾选 = 停用（已有索引数据保留，待清理）。
 * 保存不自动建立索引，后续由「建立待处理索引」或当前对话弹窗触发。
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDataService, useSemanticIndexService } from '@/services'
import type { SemanticIndexSessionStatus } from '@/services'

const props = defineProps<{ modelValue: boolean; apiMode: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>()

const { t } = useI18n()
const dataService = useDataService()
const service = useSemanticIndexService()

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

interface Row {
  id: string
  name: string
  type: 'group' | 'private'
  messageCount: number
  status: SemanticIndexSessionStatus | null
}

const rows = ref<Row[]>([])
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const typeFilter = ref<'all' | 'group' | 'private'>('all')
const selected = ref<Set<string>>(new Set())
const originalEnabled = ref<Set<string>>(new Set())
const showConfirm = ref(false)

const typeItems = computed(() => [
  { label: t('settings.ai.semanticIndex.picker.all'), value: 'all' },
  { label: t('settings.ai.semanticIndex.picker.group'), value: 'group' },
  { label: t('settings.ai.semanticIndex.picker.private'), value: 'private' },
])

const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (typeFilter.value !== 'all' && r.type !== typeFilter.value) return false
    if (q && !r.name.toLowerCase().includes(q)) return false
    return true
  })
})

const selectedSummary = computed(() => {
  let messages = 0
  for (const r of rows.value) if (selected.value.has(r.id)) messages += r.messageCount
  return { count: selected.value.size, messages }
})

// 取消勾选已有索引数据的对话需要二次确认
const sessionsNeedingConfirm = computed(() =>
  rows.value.filter((r) => {
    if (!originalEnabled.value.has(r.id) || selected.value.has(r.id)) return false
    const s = r.status
    if (!s) return false
    return s.indexStatus === 'completed' || s.running || s.queued || (s.indexStatus === 'failed' && s.chunkCount > 0)
  })
)

async function load() {
  loading.value = true
  try {
    const sessions = await dataService.getSessions()
    const statuses = await service.statusForSessions(sessions.map((s) => s.id))
    const statusMap = new Map(statuses.map((s) => [s.sessionId, s]))
    rows.value = sessions.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type === 'private' ? 'private' : 'group',
      messageCount: s.messageCount,
      status: statusMap.get(s.id) ?? null,
    }))
    const enabled = new Set(statuses.filter((s) => s.enabled).map((s) => s.sessionId))
    originalEnabled.value = new Set(enabled)
    selected.value = new Set(enabled)
  } catch (error) {
    console.error('[semantic-index] picker load failed:', error)
  } finally {
    loading.value = false
  }
}

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function requestSave() {
  if (sessionsNeedingConfirm.value.length > 0) {
    showConfirm.value = true
    return
  }
  void doSave()
}

async function doSave() {
  showConfirm.value = false
  saving.value = true
  try {
    const toEnable = [...selected.value].filter((id) => !originalEnabled.value.has(id))
    const toDisable = [...originalEnabled.value].filter((id) => !selected.value.has(id))
    for (const id of toEnable) await service.enable(id)
    for (const id of toDisable) await service.disable(id)
    emit('saved')
    open.value = false
  } catch (error) {
    console.error('[semantic-index] picker save failed:', error)
  } finally {
    saving.value = false
  }
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) load()
  }
)
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'z-[101] max-w-2xl', overlay: 'z-[100]' }">
    <template #content>
      <div class="flex max-h-[80vh] flex-col p-5">
        <h3 class="mb-3 text-base font-semibold text-gray-900 dark:text-white">
          {{ t('settings.ai.semanticIndex.picker.title') }}
        </h3>

        <div class="mb-3 flex items-center gap-2">
          <UInput
            v-model="search"
            icon="i-heroicons-magnifying-glass"
            size="sm"
            class="flex-1"
            :placeholder="t('settings.ai.semanticIndex.picker.searchPlaceholder')"
          />
          <USelect v-model="typeFilter" :items="typeItems" size="sm" class="w-28" />
        </div>

        <p
          v-if="apiMode"
          class="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-400"
        >
          {{ t('settings.ai.semanticIndex.apiCostWarning') }}
        </p>

        <div v-if="loading" class="flex items-center gap-2 py-8 text-sm text-gray-400">
          <UIcon name="i-heroicons-arrow-path" class="h-4 w-4 animate-spin" />
          {{ t('common.loading') }}
        </div>

        <div v-else class="min-h-0 flex-1 space-y-1 overflow-y-auto">
          <label
            v-for="r in filteredRows"
            :key="r.id"
            class="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50"
          >
            <UCheckbox :model-value="selected.has(r.id)" @update:model-value="toggle(r.id)" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm text-gray-800 dark:text-gray-200">{{ r.name }}</div>
              <div class="flex items-center gap-2 text-xs text-gray-400">
                <span>
                  {{
                    r.type === 'group'
                      ? t('settings.ai.semanticIndex.picker.group')
                      : t('settings.ai.semanticIndex.picker.private')
                  }}
                </span>
                <span>{{ t('settings.ai.semanticIndex.picker.messages', { count: r.messageCount }) }}</span>
                <span v-if="r.status?.enabled" class="text-blue-500">
                  {{ t('settings.ai.semanticIndex.picker.enabled') }}
                </span>
              </div>
            </div>
          </label>
        </div>

        <div class="mt-3 flex items-center justify-between border-t border-gray-200 pt-3 dark:border-gray-700">
          <span class="text-xs text-gray-500">
            {{
              t('settings.ai.semanticIndex.picker.selectedSummary', {
                count: selectedSummary.count,
                messages: selectedSummary.messages,
              })
            }}
          </span>
          <div class="flex gap-2">
            <UButton variant="ghost" @click="open = false">{{ t('common.cancel') }}</UButton>
            <UButton color="primary" :loading="saving" @click="requestSave">{{ t('common.save') }}</UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>

  <!-- 停用二次确认 -->
  <UModal v-model:open="showConfirm" :ui="{ content: 'z-[103]', overlay: 'z-[102]' }">
    <template #content>
      <div class="p-5">
        <h3 class="mb-3 text-base font-semibold text-gray-900 dark:text-white">
          {{ t('settings.ai.semanticIndex.picker.confirmDisableTitle') }}
        </h3>
        <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
          {{ t('settings.ai.semanticIndex.picker.confirmDisableMessage') }}
        </p>
        <ul
          class="mb-4 max-h-32 overflow-y-auto rounded border border-gray-200 p-2 text-xs text-gray-500 dark:border-gray-700"
        >
          <li v-for="s in sessionsNeedingConfirm" :key="s.id" class="truncate">{{ s.name }}</li>
        </ul>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="showConfirm = false">{{ t('common.cancel') }}</UButton>
          <UButton color="error" :loading="saving" @click="doSave">{{ t('common.confirm') }}</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
