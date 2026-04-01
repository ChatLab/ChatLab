<script setup lang="ts">
/**
 * 通用聊天选择器弹窗
 * 用于包含多个聊天的导出文件（如 Telegram 官方导出），
 * 让用户选择要导入的聊天。
 *
 * 自治组件：传入 filePath 后自动扫描聊天列表，
 * 内部管理 loading / error / retry 状态。
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

/** 聊天信息通用结构 */
export interface ChatInfo {
  /** 在源文件中的索引 */
  index: number
  /** 聊天名称 */
  name: string
  /** 聊天类型（平台特定的原始类型字符串） */
  type: string
  /** 聊天 ID */
  id: number
  /** 消息数量 */
  messageCount: number
}

const props = defineProps<{
  open: boolean
  /** 要扫描的文件路径 */
  filePath: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  select: [chats: ChatInfo[]]
}>()

const { t } = useI18n()

// 双向绑定 open
const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
})

// 内部状态
const chats = ref<ChatInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const selectedIndexes = ref<Set<number>>(new Set())

// 已选数量
const selectedCount = computed(() => selectedIndexes.value.size)

// 是否全选
const isAllSelected = computed(() => chats.value.length > 0 && selectedIndexes.value.size === chats.value.length)

// ==================== 图标逻辑 ====================

/** 根据类型字符串的关键词自动匹配图标 */
function getChatTypeIcon(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('personal') || t.includes('private_chat') || t.includes('bot') || t.includes('saved')) {
    return 'i-heroicons-user'
  }
  if (t.includes('group') || t.includes('supergroup') || t.includes('channel')) {
    return 'i-heroicons-user-group'
  }
  return 'i-heroicons-chat-bubble-left-right'
}

/** 格式化类型标签：去下划线、首字母大写 */
function formatTypeLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// ==================== 扫描逻辑 ====================

async function scan() {
  loading.value = true
  error.value = null
  chats.value = []
  selectedIndexes.value = new Set()

  try {
    const result = await window.chatApi.scanMultiChatFile(props.filePath)
    if (result.success) {
      chats.value = result.chats
    } else {
      error.value = result.error || t('home.chatSelector.scanFailed')
    }
  } catch (err) {
    error.value = String(err)
  } finally {
    loading.value = false
  }
}

// 打开弹窗时自动扫描
watch(
  () => props.open,
  (val) => {
    if (val && props.filePath) {
      scan()
    }
  }
)

// ==================== 选择逻辑 ====================

function toggleSelect(index: number) {
  const newSet = new Set(selectedIndexes.value)
  if (newSet.has(index)) {
    newSet.delete(index)
  } else {
    newSet.add(index)
  }
  selectedIndexes.value = newSet
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIndexes.value = new Set()
  } else {
    selectedIndexes.value = new Set(chats.value.map((c) => c.index))
  }
}

function confirmSelection() {
  const selected = chats.value.filter((c) => selectedIndexes.value.has(c.index))
  isOpen.value = false
  emit('select', selected)
}

function handleClose() {
  isOpen.value = false
}
</script>

<template>
  <UModal v-model:open="isOpen" :title="t('home.chatSelector.title')">
    <template #body>
      <div class="min-h-[200px]">
        <!-- 加载中 -->
        <div v-if="loading" class="flex flex-col items-center justify-center py-12">
          <UIcon name="i-heroicons-arrow-path" class="mb-4 h-8 w-8 animate-spin text-pink-500" />
          <p class="text-gray-500 dark:text-gray-400">{{ t('home.chatSelector.scanning') }}</p>
        </div>

        <!-- 加载错误 -->
        <div v-else-if="error" class="flex flex-col items-center justify-center py-12">
          <UIcon name="i-heroicons-exclamation-circle" class="mb-4 h-8 w-8 text-red-500" />
          <p class="text-red-600 dark:text-red-400">{{ error }}</p>
          <UButton class="mt-4" size="sm" variant="soft" @click="scan">
            {{ t('home.chatSelector.retry') }}
          </UButton>
        </div>

        <!-- 聊天列表 -->
        <div v-else-if="chats.length > 0">
          <!-- 全选和统计 -->
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UCheckbox
                :model-value="isAllSelected"
                :label="t('home.chatSelector.selectAll')"
                size="sm"
                @update:model-value="toggleSelectAll"
              />
              <span class="text-xs text-gray-400">
                ({{ t('home.chatSelector.chatCount', { count: chats.length }) }})
              </span>
            </div>
            <span v-if="selectedCount > 0" class="text-sm font-medium text-pink-600 dark:text-pink-400">
              {{ t('home.chatSelector.selected', { count: selectedCount }) }}
            </span>
          </div>

          <!-- 聊天列表 -->
          <div class="max-h-[420px] space-y-0.5 overflow-y-auto pr-1">
            <div
              v-for="chat in chats"
              :key="chat.index"
              class="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
              :class="
                selectedIndexes.has(chat.index)
                  ? 'bg-pink-50 dark:bg-pink-500/10'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800'
              "
              @click="toggleSelect(chat.index)"
            >
              <UCheckbox :model-value="selectedIndexes.has(chat.index)" size="sm" @click.stop />
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                :class="
                  selectedIndexes.has(chat.index) ? 'bg-pink-100 dark:bg-pink-500/20' : 'bg-gray-100 dark:bg-gray-700'
                "
              >
                <UIcon
                  :name="getChatTypeIcon(chat.type)"
                  class="h-3.5 w-3.5"
                  :class="
                    selectedIndexes.has(chat.index)
                      ? 'text-pink-600 dark:text-pink-400'
                      : 'text-gray-500 dark:text-gray-400'
                  "
                />
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-gray-900 dark:text-white">
                  {{ chat.name || `Chat ${chat.id}` }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ formatTypeLabel(chat.type) }} ·
                  {{ t('home.chatSelector.messageCount', { count: chat.messageCount.toLocaleString() }) }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- 无聊天 -->
        <div v-else class="flex flex-col items-center justify-center py-12">
          <UIcon name="i-heroicons-chat-bubble-left-right" class="mb-4 h-8 w-8 text-gray-400" />
          <p class="text-gray-500 dark:text-gray-400">{{ t('home.chatSelector.noChats') }}</p>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton variant="ghost" color="neutral" @click="handleClose">
          {{ t('common.cancel') }}
        </UButton>
        <UButton :disabled="selectedCount === 0" @click="confirmSelection">
          {{ t('home.chatSelector.import', { count: selectedCount }) }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
