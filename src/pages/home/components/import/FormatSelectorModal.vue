<script setup lang="ts">
/**
 * 格式选择器弹窗
 * 当自动检测无法识别文件格式时，让用户手动选择对应的聊天记录格式。
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useImportService } from '@/services'
import type { FormatInfo } from '@/services'

const props = defineProps<{
  open: boolean
  /** 导入失败的文件路径（用于显示） */
  filePath?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  select: [formatId: string]
}>()

const { t } = useI18n()

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
})

const formats = ref<FormatInfo[]>([])
const loading = ref(false)
const selectedFormatId = ref<string | null>(null)

/** 只展示可手动选择的平台（避免用户面对过多无关格式） */
const MANUAL_SELECTABLE_PLATFORMS = new Set(['whatsapp', 'line', 'unknown'])

/** 按平台分组（仅展示可手动选择的格式） */
const groupedFormats = computed(() => {
  const map = new Map<string, FormatInfo[]>()
  for (const f of formats.value) {
    if (!MANUAL_SELECTABLE_PLATFORMS.has(f.platform)) continue
    const group = map.get(f.platform) ?? []
    group.push(f)
    map.set(f.platform, group)
  }
  return map
})

/** 平台图标映射 */
function getPlatformIcon(platform: string): string {
  const p = platform.toLowerCase()
  if (p.includes('whatsapp')) return 'i-simple-icons-whatsapp'
  if (p.includes('telegram')) return 'i-simple-icons-telegram'
  if (p.includes('line')) return 'i-simple-icons-line'
  if (p.includes('qq')) return 'i-simple-icons-tencentqq'
  if (p.includes('wechat') || p.includes('weixin')) return 'i-simple-icons-wechat'
  if (p.includes('discord')) return 'i-simple-icons-discord'
  if (p.includes('instagram')) return 'i-simple-icons-instagram'
  if (p.includes('chatlab')) return 'i-heroicons-chat-bubble-left-right'
  return 'i-heroicons-chat-bubble-left-right'
}

async function loadFormats() {
  loading.value = true
  try {
    const result = await useImportService().getSupportedFormats()
    formats.value = result
  } catch {
    formats.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (val) => {
    if (val) {
      selectedFormatId.value = null
      loadFormats()
    }
  }
)

function confirmSelection() {
  if (selectedFormatId.value) {
    isOpen.value = false
    emit('select', selectedFormatId.value)
  }
}

function handleClose() {
  isOpen.value = false
}
</script>

<template>
  <UModal v-model:open="isOpen" :title="t('home.formatSelector.title')">
    <template #body>
      <div class="min-h-[200px]">
        <!-- 提示 -->
        <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
          {{ t('home.formatSelector.hint') }}
        </p>

        <!-- 加载中 -->
        <div v-if="loading" class="flex items-center justify-center py-12">
          <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-pink-500" />
        </div>

        <!-- 格式列表（按平台分组） -->
        <div v-else class="max-h-[400px] space-y-3 overflow-y-auto pr-1">
          <div v-for="[platform, items] in groupedFormats" :key="platform">
            <div class="mb-1 flex items-center gap-1.5 px-1">
              <UIcon :name="getPlatformIcon(platform)" class="h-3.5 w-3.5 text-gray-400" />
              <span class="text-xs font-medium text-gray-400 uppercase">{{ platform }}</span>
            </div>
            <div class="space-y-0.5">
              <div
                v-for="format in items"
                :key="format.id"
                class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors"
                :class="
                  selectedFormatId === format.id
                    ? 'bg-pink-50 ring-1 ring-pink-200 dark:bg-pink-500/10 dark:ring-pink-500/30'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                "
                @click="selectedFormatId = format.id"
              >
                <div
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
                  :class="
                    selectedFormatId === format.id
                      ? 'border-pink-500 bg-pink-500'
                      : 'border-gray-300 dark:border-gray-600'
                  "
                >
                  <UIcon
                    v-if="selectedFormatId === format.id"
                    name="i-heroicons-check-20-solid"
                    class="h-3 w-3 text-white"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-gray-900 dark:text-white">
                    {{ format.name }}
                  </p>
                  <p class="text-xs text-gray-400">
                    {{ format.extensions.join(', ') }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton variant="ghost" color="neutral" @click="handleClose">
          {{ t('common.cancel') }}
        </UButton>
        <UButton :disabled="!selectedFormatId" @click="confirmSelection">
          {{ t('home.formatSelector.confirm') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
