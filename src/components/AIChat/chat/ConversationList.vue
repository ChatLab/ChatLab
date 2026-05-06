<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'

const { t } = useI18n()

interface Conversation {
  id: string
  sessionId: string
  title: string | null
  createdAt: number
  updatedAt: number
}

interface ConversationGroup {
  label: string
  conversations: Conversation[]
}

// Props
const props = defineProps<{
  sessionId: string
  activeId: string | null
  /** 仅禁用新建、重命名、删除等会改写状态的操作，仍允许只读切换查看其他对话。 */
  disabled?: boolean
}>()

// Emits
const emit = defineEmits<{
  select: [id: string]
  create: []
  delete: [id: string]
}>()

// State
const conversations = ref<Conversation[]>([])
const isLoading = ref(false)
const editingId = ref<string | null>(null)
const editingTitle = ref('')
const isCollapsed = ref(false)
const menuOpenId = ref<string | null>(null)

// 加载对话列表
async function loadConversations() {
  isLoading.value = true
  try {
    conversations.value = await window.aiApi.getConversations(props.sessionId)
  } catch (error) {
    console.error('加载对话列表失败：', error)
  } finally {
    isLoading.value = false
  }
}

// 按时间分组
const groupedConversations = computed<ConversationGroup[]>(() => {
  if (conversations.value.length === 0) return []

  const now = dayjs()
  const day7 = now.subtract(7, 'day').startOf('day')
  const day30 = now.subtract(30, 'day').startOf('day')

  const last7: Conversation[] = []
  const last30: Conversation[] = []
  const monthBuckets = new Map<string, Conversation[]>()

  for (const conv of conversations.value) {
    const date = dayjs(conv.updatedAt * 1000)
    if (date.isAfter(day7)) {
      last7.push(conv)
    } else if (date.isAfter(day30)) {
      last30.push(conv)
    } else {
      const key = date.format('YYYY-MM')
      if (!monthBuckets.has(key)) monthBuckets.set(key, [])
      monthBuckets.get(key)!.push(conv)
    }
  }

  const groups: ConversationGroup[] = []
  if (last7.length > 0) {
    groups.push({ label: t('ai.chat.conversation.group.last7Days'), conversations: last7 })
  }
  if (last30.length > 0) {
    groups.push({ label: t('ai.chat.conversation.group.last30Days'), conversations: last30 })
  }

  const sortedMonths = [...monthBuckets.keys()].sort((a, b) => b.localeCompare(a))
  for (const month of sortedMonths) {
    const d = dayjs(month + '-01')
    groups.push({
      label: d.format(d.year() === now.year() ? 'M月' : 'YYYY年M月'),
      conversations: monthBuckets.get(month)!,
    })
  }

  return groups
})

// 获取对话标题
function getTitle(conv: Conversation): string {
  return conv.title || t('ai.chat.conversation.newChat')
}

// 开始编辑标题
function startEditing(conv: Conversation) {
  if (props.disabled) return
  editingId.value = conv.id
  editingTitle.value = conv.title || ''
}

// 保存标题
async function saveTitle(convId: string) {
  if (props.disabled) return
  if (editingTitle.value.trim()) {
    try {
      await window.aiApi.updateConversationTitle(convId, editingTitle.value.trim())
      const conv = conversations.value.find((c) => c.id === convId)
      if (conv) {
        conv.title = editingTitle.value.trim()
      }
    } catch (error) {
      console.error('更新标题失败：', error)
    }
  }
  editingId.value = null
}

function handleMenuRename(conv: Conversation) {
  menuOpenId.value = null
  startEditing(conv)
}

function handleMenuDelete(convId: string) {
  menuOpenId.value = null
  handleDelete(convId)
}

// 删除对话
async function handleDelete(convId: string) {
  if (props.disabled) return
  try {
    await window.aiApi.deleteConversation(convId)
    conversations.value = conversations.value.filter((c) => c.id !== convId)
    emit('delete', convId)
  } catch (error) {
    console.error('删除对话失败：', error)
  }
}

// 初始化
onMounted(() => {
  loadConversations()
})

// 监听 sessionId 变化
watch(
  () => props.sessionId,
  () => {
    loadConversations()
  }
)

// 暴露刷新方法
defineExpose({
  refresh: loadConversations,
})
</script>

<template>
  <div
    class="flex flex-col border-r border-gray-200 bg-white transition-all dark:border-gray-800 dark:bg-gray-900"
    :class="isCollapsed ? 'w-10' : 'w-64'"
  >
    <!-- 头部 -->
    <div
      class="flex items-center border-b border-gray-200 dark:border-gray-800"
      :class="isCollapsed ? 'justify-center px-0 py-2' : 'justify-between pl-3 pr-2 py-2'"
    >
      <template v-if="!isCollapsed">
        <button
          class="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          :disabled="disabled"
          :class="{ 'cursor-not-allowed opacity-50': disabled }"
          @click="!disabled && emit('create')"
        >
          <UIcon name="i-heroicons-plus" class="h-3.5 w-3.5" />
          <span>{{ t('ai.chat.conversation.newConversation') }}</span>
        </button>
        <button
          class="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          @click="isCollapsed = !isCollapsed"
        >
          <UIcon name="i-heroicons-chevron-left" class="h-4 w-4" />
        </button>
      </template>
      <template v-else>
        <button
          class="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          @click="isCollapsed = !isCollapsed"
        >
          <UIcon name="i-heroicons-chevron-right" class="h-4 w-4" />
        </button>
      </template>
    </div>

    <!-- 展开状态列表 -->
    <div v-if="!isCollapsed" class="flex-1 overflow-y-auto p-2">
      <!-- 加载中 -->
      <div v-if="isLoading" class="flex items-center justify-center py-8">
        <UIcon name="i-heroicons-arrow-path" class="h-5 w-5 animate-spin text-gray-400" />
      </div>

      <!-- 空状态 -->
      <div v-else-if="conversations.length === 0" class="flex flex-col items-center justify-center py-12 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50 dark:bg-gray-800">
          <UIcon name="i-heroicons-chat-bubble-left" class="h-6 w-6 text-gray-300 dark:text-gray-600" />
        </div>
        <p class="mt-3 text-xs text-gray-400">{{ t('ai.chat.conversation.empty') }}</p>
        <UButton
          class="mt-2"
          size="xs"
          variant="link"
          color="primary"
          :disabled="disabled"
          @click="!disabled && emit('create')"
        >
          {{ t('ai.chat.conversation.startNew') }}
        </UButton>
      </div>

      <!-- 分组对话列表 -->
      <div v-else class="space-y-3">
        <div v-for="group in groupedConversations" :key="group.label">
          <!-- 分组标题 -->
          <div class="px-2 pb-1 pt-1.5 text-[10px] font-medium tracking-wide text-gray-400 dark:text-gray-500">
            {{ group.label }}
          </div>

          <!-- 对话项 -->
          <div class="space-y-0.5">
            <div
              v-for="conv in group.conversations"
              :key="conv.id"
              class="group relative rounded-lg px-3 py-2 transition-all"
              :class="[
                'cursor-pointer',
                activeId === conv.id
                  ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                  : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50',
              ]"
              @click="emit('select', conv.id)"
            >
              <!-- 编辑模式 -->
              <template v-if="editingId === conv.id">
                <input
                  v-model="editingTitle"
                  class="w-full rounded border-none bg-white px-2 py-1 text-sm shadow-sm outline-none ring-1 ring-gray-200 focus:ring-2 focus:ring-primary-500 dark:bg-gray-900 dark:ring-gray-700"
                  :placeholder="t('ai.chat.conversation.titlePlaceholder')"
                  autoFocus
                  @blur="saveTitle(conv.id)"
                  @keyup.enter="saveTitle(conv.id)"
                  @click.stop
                />
              </template>

              <!-- 正常模式 -->
              <template v-else>
                <div class="flex items-center">
                  <p class="line-clamp-1 min-w-0 flex-1 text-sm leading-snug">
                    {{ getTitle(conv) }}
                  </p>

                  <!-- 三点菜单 -->
                  <div
                    class="ml-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    :class="{ 'opacity-100': activeId === conv.id || menuOpenId === conv.id }"
                    @click.stop
                  >
                    <UPopover
                      :open="menuOpenId === conv.id"
                      :ui="{ content: 'z-50 p-0' }"
                      @update:open="(val: boolean) => (menuOpenId = val ? conv.id : null)"
                    >
                      <button
                        class="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                      >
                        <UIcon name="i-heroicons-ellipsis-horizontal" class="h-4 w-4" />
                      </button>
                      <template #content>
                        <div class="w-28 p-1">
                          <button
                            class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                            :disabled="disabled"
                            @click="handleMenuRename(conv)"
                          >
                            <UIcon name="i-heroicons-pencil" class="h-3.5 w-3.5" />
                            {{ t('ai.chat.conversation.rename') }}
                          </button>
                          <button
                            class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs text-red-500 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                            :disabled="disabled"
                            @click="handleMenuDelete(conv.id)"
                          >
                            <UIcon name="i-heroicons-trash" class="h-3.5 w-3.5" />
                            {{ t('ai.chat.conversation.delete') }}
                          </button>
                        </div>
                      </template>
                    </UPopover>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 折叠状态列表 -->
    <div v-else class="flex flex-1 flex-col items-center gap-2 overflow-y-auto py-2">
      <button
        class="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-pink-500 dark:hover:bg-gray-800"
        :title="t('ai.chat.conversation.newConversation')"
        :disabled="disabled"
        :class="{ 'cursor-not-allowed opacity-50': disabled }"
        @click="!disabled && emit('create')"
      >
        <UIcon name="i-heroicons-plus" class="h-4 w-4" />
      </button>

      <div class="h-px w-6 bg-gray-200 dark:bg-gray-800"></div>

      <button
        v-for="conv in conversations"
        :key="conv.id"
        class="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
        :class="[activeId === conv.id ? 'text-pink-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300']"
        :title="getTitle(conv)"
        @click="emit('select', conv.id)"
      >
        <UIcon name="i-heroicons-chat-bubble-left" class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
