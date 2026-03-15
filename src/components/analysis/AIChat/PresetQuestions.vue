<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  questions: string[]
  disabled?: boolean
  leadingActionLabel?: string
}>()

const emit = defineEmits<{
  select: [question: string]
  leadingAction: []
}>()

type PresetItem =
  | {
      key: string
      label: string
      type: 'leadingAction'
    }
  | {
      key: string
      label: string
      type: 'question'
      question: string
    }

const hasItems = computed(() => props.questions.length > 0 || Boolean(props.leadingActionLabel))
const containerRef = ref<HTMLElement | null>(null)
const measureRef = ref<HTMLElement | null>(null)
const showMoreMenu = ref(false)
const visibleCount = ref(0)
let resizeObserver: ResizeObserver | null = null

const chipClass =
  'rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] leading-4 text-gray-600 transition-all hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-primary-600 dark:hover:bg-primary-950/30 dark:hover:text-primary-400'

const items = computed<PresetItem[]>(() => {
  const result: PresetItem[] = []

  if (props.leadingActionLabel) {
    result.push({
      key: 'leading-action',
      label: props.leadingActionLabel,
      type: 'leadingAction',
    })
  }

  props.questions.forEach((question, index) => {
    result.push({
      key: `question-${index}`,
      label: question,
      type: 'question',
      question,
    })
  })

  return result
})

const hiddenCount = computed(() => Math.max(items.value.length - visibleCount.value, 0))
const visibleItems = computed(() => items.value.slice(0, visibleCount.value))
const hiddenItems = computed(() => items.value.slice(visibleCount.value))
const measureMoreLabel = computed(() => `${t('ai.chat.input.presetMore')}...`)
const toggleLabel = computed(() => `${t('ai.chat.input.presetMore')}...`)

function handleItemClick(item: PresetItem) {
  showMoreMenu.value = false

  if (item.type === 'leadingAction') {
    emit('leadingAction')
    return
  }

  emit('select', item.question)
}

function toggleMoreMenu() {
  if (props.disabled || hiddenCount.value === 0) return
  showMoreMenu.value = !showMoreMenu.value
}

function handleDocumentMouseDown(event: MouseEvent) {
  if (!showMoreMenu.value || !containerRef.value) return

  const target = event.target
  if (target instanceof Node && !containerRef.value.contains(target)) {
    showMoreMenu.value = false
  }
}

function measureVisibleItems() {
  if (!containerRef.value) return

  const chips = Array.from(measureRef.value?.querySelectorAll<HTMLElement>('[data-measure-chip]') ?? [])
  if (chips.length === 0) {
    visibleCount.value = 0
    return
  }

  const availableWidth = containerRef.value.clientWidth
  if (!availableWidth) {
    visibleCount.value = chips.length
    return
  }

  const moreButton = measureRef.value?.querySelector<HTMLElement>('[data-measure-more]')
  const chipWidths = chips.map((chip) => chip.offsetWidth)
  const moreWidth = moreButton?.offsetWidth ?? 0
  const gap = 8

  let usedWidth = 0
  let nextVisibleCount = 0

  for (let index = 0; index < chipWidths.length; index += 1) {
    const width = chipWidths[index]
    const nextWidth = nextVisibleCount === 0 ? width : usedWidth + gap + width
    const hasRemaining = index < chipWidths.length - 1
    const reserveWidth = hasRemaining ? gap + moreWidth : 0

    if (nextWidth + reserveWidth > availableWidth) {
      break
    }

    usedWidth = nextWidth
    nextVisibleCount += 1
  }

  // 至少展示一个标签，避免窄窗口下直接只剩“更多”。
  visibleCount.value = Math.max(1, nextVisibleCount)
}

async function syncCollapsedLayout() {
  if (!hasItems.value) return

  await nextTick()
  measureVisibleItems()
}

watch(
  items,
  async () => {
    showMoreMenu.value = false
    await syncCollapsedLayout()
  },
  { deep: true, immediate: true }
)

watch(hiddenCount, (count) => {
  if (count === 0) {
    showMoreMenu.value = false
  }
})

onMounted(async () => {
  await syncCollapsedLayout()
  document.addEventListener('mousedown', handleDocumentMouseDown)

  if (typeof ResizeObserver === 'undefined' || !containerRef.value) return

  resizeObserver = new ResizeObserver(() => {
    showMoreMenu.value = false
    measureVisibleItems()
  })
  resizeObserver.observe(containerRef.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  document.removeEventListener('mousedown', handleDocumentMouseDown)
})
</script>

<template>
  <div v-if="hasItems" ref="containerRef" class="relative">
    <div class="pointer-events-none absolute left-0 top-0 -z-10 h-0 overflow-hidden opacity-0" aria-hidden="true">
      <div ref="measureRef" class="flex whitespace-nowrap gap-2">
        <span v-for="item in items" :key="item.key" :class="chipClass" data-measure-chip>
          {{ item.label }}
        </span>
        <span :class="chipClass" data-measure-more>
          {{ measureMoreLabel }}
        </span>
      </div>
    </div>

    <!-- 主行保持单行展示，但不裁掉“更多”的上浮面板。 -->
    <div class="relative z-10 flex flex-nowrap gap-2">
      <button
        v-for="item in visibleItems"
        :key="item.key"
        :class="chipClass"
        :disabled="props.disabled"
        @click="handleItemClick(item)"
      >
        {{ item.label }}
      </button>

      <div v-if="hiddenCount > 0" class="relative shrink-0">
        <button :class="chipClass" :disabled="props.disabled" @click="toggleMoreMenu">
          {{ toggleLabel }}
        </button>

        <!-- 隐藏标签直接向上展开，并与主行保持同一套胶囊样式。 -->
        <div
          v-if="showMoreMenu"
          class="absolute right-0 bottom-full z-20 mb-2 flex w-[320px] max-w-[calc(100vw-3rem)] flex-wrap justify-end gap-2"
        >
          <button
            v-for="item in hiddenItems"
            :key="item.key"
            :class="chipClass"
            :disabled="props.disabled"
            @click="handleItemClick(item)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
