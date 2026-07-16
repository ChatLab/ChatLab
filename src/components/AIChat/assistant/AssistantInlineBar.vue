<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { getDefaultGeneralAssistantId } from '@openchatlab/shared-types'
import { useAssistantStore, type AssistantSummary } from '@/stores/assistant'

const props = defineProps<{
  chatType: 'group' | 'private'
  locale: string
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
  market: []
}>()

// 控制溢出菜单的展开收起
const overflowPopoverOpen = ref(false)
const overflowMenuRef = ref<HTMLElement | null>(null)

// 选中溢出助手后，立即关闭菜单，让用户看到滑动环跳过去
function selectOverflow(id: string) {
  emit('select', id)
  overflowPopoverOpen.value = false
}

function toggleOverflowMenu() {
  if (overflowAssistants.value.length === 0) return
  overflowPopoverOpen.value = !overflowPopoverOpen.value
}

function handleDocumentMouseDown(event: MouseEvent) {
  if (!overflowPopoverOpen.value || !overflowMenuRef.value) return

  const target = event.target
  if (target instanceof Node && !overflowMenuRef.value.contains(target)) {
    overflowPopoverOpen.value = false
  }
}

const assistantStore = useAssistantStore()
const { filteredAssistants, isLoaded } = storeToRefs(assistantStore)

const sortedAssistants = computed<AssistantSummary[]>(() => {
  const preferredGeneralId = getDefaultGeneralAssistantId(props.locale)
  return [...filteredAssistants.value].sort((a, b) => {
    if (a.id === preferredGeneralId) return -1
    if (b.id === preferredGeneralId) return 1
    return 0
  })
})

const VISIBLE_COUNT = 4

const displayedAssistants = computed<AssistantSummary[]>(() => {
  const all = sortedAssistants.value
  if (all.length <= VISIBLE_COUNT) return all

  const selectedIndex = all.findIndex((a) => a.id === props.selectedId)
  if (selectedIndex !== -1 && selectedIndex >= VISIBLE_COUNT - 1) {
    const firstFew = all.slice(0, VISIBLE_COUNT - 1)
    const selected = all[selectedIndex]
    return [...firstFew, selected]
  }
  return all.slice(0, VISIBLE_COUNT)
})

const overflowAssistants = computed<AssistantSummary[]>(() => {
  const displayedIds = new Set(displayedAssistants.value.map((a) => a.id))
  return sortedAssistants.value.filter((a) => !displayedIds.has(a.id))
})

watch(
  () => [props.chatType, props.locale],
  ([chatType, locale]) => {
    assistantStore.setFilterContext(chatType as 'group' | 'private', locale as string)
  },
  { immediate: true }
)

// ---------- 滑动胶囊环逻辑 ----------
const buttonRefs = ref<HTMLElement[]>([])
const containerRef = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null

const ringStyle = ref({
  width: '0px',
  transform: 'translateX(0px)',
  opacity: 0,
})

const updateRing = async () => {
  await nextTick()
  const index = displayedAssistants.value.findIndex((a) => a.id === props.selectedId)
  if (index !== -1 && buttonRefs.value[index]) {
    const el = buttonRefs.value[index]
    ringStyle.value = {
      // 往外扩张3px，宽度 +6，往左偏 -3px
      width: `${el.offsetWidth + 6}px`,
      transform: `translateX(${el.offsetLeft - 3}px)`,
      opacity: 1,
    }
  } else {
    // 落败隐藏（极小可能）
    ringStyle.value.opacity = 0
  }
}

watch(
  () => [props.selectedId, displayedAssistants.value],
  () => {
    updateRing()
  },
  { deep: true }
)

onMounted(async () => {
  if (!isLoaded.value) {
    await assistantStore.loadAssistants()
  }
  updateRing()
  document.addEventListener('mousedown', handleDocumentMouseDown)

  // 监听容器大小变动以应对外部屏幕 Resize 等导致元素间距变动的情况
  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateRing()
    })
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown)
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})
</script>

<template>
  <div class="assistant-bar-wrapper flex justify-center">
    <!-- 主胶囊容器：p-[3px] 来保留上下 3px 扩张空间，加 gap-1.5 避免相邻背景重叠 -->
    <div
      ref="containerRef"
      class="assistant-bar-grid relative flex items-center justify-center gap-1.5 rounded-full bg-gray-50/60 p-[3px] shadow-inner ring-1 ring-inset ring-gray-900/5 backdrop-blur-md dark:bg-gray-800/40 dark:ring-white/10 z-0 overflow-hidden sm:overflow-visible"
    >
      <!-- 滑动选中焦点层：基于 CSS Transform 平滑移动 -->
      <div
        class="absolute left-0 inset-y-0 -z-10 rounded-full bg-white ring-[1.5px] ring-primary-500 shadow-sm transition-all duration-350 ease-out dark:bg-primary-700/15 dark:ring-primary-500"
        :style="ringStyle"
      ></div>

      <button
        v-for="(assistant, index) in displayedAssistants"
        :key="assistant.id"
        :ref="
          (el) => {
            if (el) buttonRefs[index] = el as HTMLElement
          }
        "
        class="relative z-10 flex h-[32px] items-center justify-center whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors duration-200"
        :class="[
          selectedId === assistant.id
            ? 'text-primary-600 dark:text-primary-400'
            : 'text-gray-500 hover:bg-gray-200/50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-gray-200',
        ]"
        @click="emit('select', assistant.id)"
      >
        {{ assistant.name }}
      </button>

      <!-- 溢出菜单：改为组件内自管面板，避免空状态 Hero 区域里 Popover 内容可见但无法稳定点击 -->
      <div v-if="overflowAssistants.length > 0" ref="overflowMenuRef" class="relative z-20">
        <button
          type="button"
          class="relative z-10 flex h-[32px] w-[32px] ml-0.5 items-center justify-center rounded-full text-gray-500 transition-colors duration-200 hover:bg-gray-200/50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-gray-200"
          @click="toggleOverflowMenu"
        >
          <UIcon name="i-heroicons-ellipsis-horizontal" class="h-5 w-5" />
        </button>

        <div
          v-if="overflowPopoverOpen"
          class="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200/80 bg-white/95 p-1 shadow-overlay backdrop-blur-md dark:border-gray-700 dark:bg-page-dark/95"
        >
          <div class="custom-scrollbar max-h-60 space-y-0.5 overflow-y-auto">
            <p class="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              更多助手
            </p>
            <button
              v-for="assistant in overflowAssistants"
              :key="assistant.id"
              type="button"
              class="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors"
              :class="[
                selectedId === assistant.id
                  ? 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
              ]"
              @click="selectOverflow(assistant.id)"
            >
              <span class="truncate font-medium">{{ assistant.name }}</span>
              <UIcon v-if="selectedId === assistant.id" name="i-heroicons-check" class="h-4 w-4 shrink-0" />
            </button>
          </div>
        </div>
      </div>

      <!-- 添加助手按钮 (置于胶囊内) -->
      <button
        type="button"
        class="relative z-10 flex h-[32px] w-[32px] items-center justify-center rounded-full text-gray-500 transition-colors duration-200 hover:bg-gray-200/50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-gray-200"
        @click="emit('market')"
      >
        <UIcon name="i-heroicons-plus" class="h-[18px] w-[18px]" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 隐藏下拉菜单滚动条 */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background-color: rgba(156, 163, 175, 0.3);
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.15);
}
</style>
