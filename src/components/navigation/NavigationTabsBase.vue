<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { NavigationTabItem } from './types'

interface Props {
  modelValue: string
  items: NavigationTabItem[]
  persistKey?: string
  orientation?: 'horizontal' | 'vertical'
  size?: 'sm' | 'md'
  bordered?: boolean
  mode: 'section' | 'compact'
}

interface Emits {
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
}

const props = withDefaults(defineProps<Props>(), {
  orientation: 'horizontal',
  size: 'md',
})
const emit = defineEmits<Emits>()

const route = useRoute()
const router = useRouter()
const isVertical = computed(() => props.orientation === 'vertical')
const tabRefs = ref<Record<string, HTMLElement | null>>({})
const containerRef = ref<HTMLElement | null>(null)
const indicatorStyle = ref<Record<string, string>>({})

const activeTab = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
    emit('change', value)
  },
})

function updateIndicator() {
  const activeButton = tabRefs.value[activeTab.value]
  if (!activeButton || !containerRef.value) return

  const containerRect = containerRef.value.getBoundingClientRect()
  const buttonRect = activeButton.getBoundingClientRect()
  indicatorStyle.value = isVertical.value
    ? {
        top: `${buttonRect.top - containerRect.top}px`,
        height: `${buttonRect.height}px`,
        right: '0px',
        width: '2px',
      }
    : {
        left: `${buttonRect.left - containerRect.left}px`,
        width: `${buttonRect.width}px`,
        bottom: '0px',
        height: '2px',
      }
}

function setTabRef(id: string, el: HTMLElement | null) {
  tabRefs.value[id] = el
}

onMounted(() => {
  if (props.persistKey) {
    const savedTab = route.query[props.persistKey] as string
    if (savedTab && props.items.some((item) => item.id === savedTab)) {
      activeTab.value = savedTab
    }
  }
  nextTick(updateIndicator)
})

watch(
  () => props.modelValue,
  (newValue) => {
    if (props.persistKey && newValue) {
      router.replace({
        query: {
          ...route.query,
          [props.persistKey]: newValue,
        },
      })
    }
    nextTick(updateIndicator)
  }
)

watch(
  () => props.items,
  () => nextTick(updateIndicator),
  { deep: true }
)
</script>

<template>
  <div
    :class="[
      isVertical
        ? ['h-full', bordered !== false ? 'border-r border-gray-200/50 dark:border-gray-700/50' : '']
        : [
            'flex justify-between overflow-x-auto',
            bordered !== false ? 'border-b border-gray-200/50 dark:border-gray-800/50' : '',
            mode === 'section'
              ? 'flex-col items-stretch gap-2 pl-7 pr-6 pt-3 xl:flex-row xl:items-center'
              : ['items-center', size === 'sm' ? 'px-3' : 'px-6'],
          ],
    ]"
  >
    <div ref="containerRef" class="relative" :class="[isVertical ? 'flex flex-col gap-1' : 'flex gap-4 pb-1']">
      <button
        v-for="tab in items"
        :key="tab.id"
        :ref="(el) => setTabRef(tab.id, el as HTMLElement)"
        type="button"
        class="flex shrink-0 items-center whitespace-nowrap font-medium transition-colors"
        :class="[
          isVertical
            ? 'justify-start gap-2 px-3 py-2 text-sm'
            : size === 'sm'
              ? 'gap-1.5 px-1 py-1.5 text-xs'
              : 'gap-2 px-1 py-3 text-sm',
          activeTab === tab.id
            ? 'text-primary-600 dark:text-primary-400'
            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
        ]"
        @click="activeTab = tab.id"
      >
        <UIcon v-if="tab.icon" :name="tab.icon" :class="size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'" />
        {{ tab.label }}
      </button>
      <div class="absolute bg-primary-500 transition-all duration-300 ease-out" :style="indicatorStyle" />
    </div>

    <template v-if="!isVertical && $slots.right">
      <div v-if="mode === 'section'" class="flex w-full min-w-0 items-center xl:w-auto xl:justify-end">
        <slot name="right" />
      </div>
      <slot v-else name="right" />
    </template>
  </div>
</template>
