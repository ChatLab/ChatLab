<script setup lang="ts">
/**
 * 通用聊天选择器弹窗
 * 用于包含多个聊天的导入源，让用户选择要导入的聊天。
 * 扫描和 source 生命周期由父组件管理，本组件只负责展示与选择。
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createDefaultSelectedChatIds, toggleAllChatIds, toggleSelectedChatId } from './chatSelection'

/** 聊天信息通用结构 */
export interface ChatInfo {
  /** 跨扫描与导入保持稳定的聊天标识 */
  chatId: string
  /** 聊天名称 */
  name: string
  /** 聊天类型（平台特定的原始类型字符串） */
  type: string
  /** 消息数量 */
  messageCount: number
  /** 成员数量 */
  memberCount?: number
  /** Telegram 等旧多聊天格式使用的源文件索引 */
  index?: number
  /** 平台原始聊天 ID */
  id?: number | string
}

const props = defineProps<{
  open: boolean
  chats: ChatInfo[]
  loading?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  select: [chats: ChatInfo[]]
  cancel: []
}>()

const { t } = useI18n()

// 双向绑定 open
const isOpen = computed({
  get: () => props.open,
  set: (value) => {
    emit('update:open', value)
    if (!value) emit('cancel')
  },
})

const selectedChatIds = ref<Set<string>>(new Set())

// 已选数量
const selectedCount = computed(() => selectedChatIds.value.size)

// 是否全选
const isAllSelected = computed(
  () => props.chats.length > 0 && props.chats.every((chat) => selectedChatIds.value.has(chat.chatId))
)

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

watch(
  () => [props.open, props.chats] as const,
  ([open]) => {
    if (open) {
      selectedChatIds.value = createDefaultSelectedChatIds(props.chats)
    }
  },
  { deep: true }
)

// ==================== 选择逻辑 ====================

function toggleSelect(chatId: string) {
  selectedChatIds.value = toggleSelectedChatId(selectedChatIds.value, chatId)
}

function toggleSelectAll() {
  selectedChatIds.value = toggleAllChatIds(selectedChatIds.value, props.chats)
}

function confirmSelection() {
  const selected = props.chats.filter((chat) => selectedChatIds.value.has(chat.chatId))
  emit('update:open', false)
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
        <div v-if="props.loading" class="flex flex-col items-center justify-center py-12">
          <UIcon name="i-heroicons-arrow-path" class="mb-4 h-8 w-8 animate-spin text-pink-500" />
          <p class="text-gray-500 dark:text-gray-400">{{ t('home.chatSelector.scanning') }}</p>
        </div>

        <!-- 加载错误 -->
        <div v-else-if="props.error" class="flex flex-col items-center justify-center py-12">
          <UIcon name="i-heroicons-exclamation-circle" class="mb-4 h-8 w-8 text-red-500" />
          <p class="text-red-600 dark:text-red-400">{{ props.error }}</p>
        </div>

        <!-- 聊天列表 -->
        <div v-else-if="props.chats.length > 0">
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
                ({{ t('home.chatSelector.chatCount', { count: props.chats.length }) }})
              </span>
            </div>
            <span v-if="selectedCount > 0" class="text-sm font-medium text-pink-600 dark:text-pink-400">
              {{ t('home.chatSelector.selected', { count: selectedCount }) }}
            </span>
          </div>

          <!-- 聊天列表 -->
          <div class="max-h-[420px] space-y-0.5 overflow-y-auto pr-1">
            <div
              v-for="chat in props.chats"
              :key="chat.chatId"
              class="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
              :class="
                selectedChatIds.has(chat.chatId)
                  ? 'bg-pink-50 dark:bg-pink-500/10'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800'
              "
              @click="toggleSelect(chat.chatId)"
            >
              <UCheckbox :model-value="selectedChatIds.has(chat.chatId)" size="sm" @click.stop />
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                :class="
                  selectedChatIds.has(chat.chatId) ? 'bg-pink-100 dark:bg-pink-500/20' : 'bg-gray-100 dark:bg-gray-700'
                "
              >
                <UIcon
                  :name="getChatTypeIcon(chat.type)"
                  class="h-3.5 w-3.5"
                  :class="
                    selectedChatIds.has(chat.chatId)
                      ? 'text-pink-600 dark:text-pink-400'
                      : 'text-gray-500 dark:text-gray-400'
                  "
                />
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-gray-900 dark:text-white">
                  {{ chat.name || chat.chatId }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ formatTypeLabel(chat.type) }} ·
                  {{ t('home.chatSelector.messageCount', { count: chat.messageCount.toLocaleString() }) }}
                  <template v-if="chat.memberCount !== undefined">
                    · {{ t('home.chatSelector.memberCount', { count: chat.memberCount.toLocaleString() }) }}
                  </template>
                  <template v-if="chat.messageCount === 0">· {{ t('home.chatSelector.empty') }}</template>
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
