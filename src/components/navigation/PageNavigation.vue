<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { RouterLink, useRoute, useRouter, type RouteLocationRaw } from 'vue-router'

interface PageNavItem {
  id: string
  label: string
  icon?: string
  to?: RouteLocationRaw
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    items: PageNavItem[]
    level: 'primary' | 'secondary'
    variant?: 'segmented' | 'pills'
    persistKey?: string
    bordered?: boolean
    ariaLabel?: string
  }>(),
  {
    bordered: false,
    variant: 'segmented',
    persistKey: undefined,
    ariaLabel: undefined,
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const route = useRoute()
const router = useRouter()

function selectItem(item: PageNavItem): void {
  if (item.to || item.id === props.modelValue) return
  emit('update:modelValue', item.id)
  emit('change', item.id)
}

function restorePersistedValue(value: unknown): void {
  if (typeof value !== 'string' || value === props.modelValue) return
  if (!props.items.some((item) => !item.to && item.id === value)) return
  emit('update:modelValue', value)
  emit('change', value)
}

onMounted(() => {
  if (props.persistKey) restorePersistedValue(route.query[props.persistKey])
})

watch(
  () => (props.persistKey ? route.query[props.persistKey] : undefined),
  (value) => restorePersistedValue(value)
)

watch(
  () => props.modelValue,
  (value) => {
    if (!props.persistKey || route.query[props.persistKey] === value) return
    void router.replace({
      query: {
        ...route.query,
        [props.persistKey]: value,
      },
    })
  }
)
</script>

<template>
  <div
    class="flex min-w-0 flex-col xl:flex-row xl:items-center xl:justify-between"
    :class="[
      level === 'secondary' ? 'gap-2 px-6 xl:gap-4' : 'gap-3',
      bordered ? 'border-b border-gray-200/50 dark:border-gray-800/50' : '',
    ]"
  >
    <nav class="min-w-0 overflow-x-auto scrollbar-hide" :aria-label="ariaLabel">
      <div
        class="flex w-max items-center"
        :class="[
          level === 'secondary' ? 'gap-1' : '',
          level === 'primary' && variant === 'segmented'
            ? 'gap-0.5 rounded-lg bg-gray-100/90 p-1 dark:bg-white/[0.06]'
            : '',
          level === 'primary' && variant === 'pills' ? 'gap-0.5' : '',
        ]"
      >
        <template v-for="item in items" :key="item.id">
          <RouterLink
            v-if="item.to"
            :to="item.to"
            class="flex shrink-0 items-center whitespace-nowrap transition-colors"
            :class="[
              level === 'primary'
                ? variant === 'pills'
                  ? 'gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold'
                  : 'h-8 gap-1.5 rounded-md px-3 text-xs font-semibold'
                : 'relative h-9 gap-1.5 px-2.5 text-xs font-medium',
              modelValue === item.id
                ? level === 'primary'
                  ? variant === 'pills'
                    ? 'bg-primary-500 text-white dark:bg-primary-900/30 dark:text-primary-300'
                    : 'bg-white text-primary-600 shadow-sm ring-1 ring-gray-900/5 dark:bg-white/10 dark:text-primary-400 dark:ring-white/10'
                  : 'text-gray-900 dark:text-white'
                : level === 'primary'
                  ? variant === 'pills'
                    ? 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                    : 'text-gray-500 hover:bg-white/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.07] dark:hover:text-white'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200',
            ]"
          >
            <UIcon v-if="item.icon" :name="item.icon" :class="level === 'primary' ? 'h-3.5 w-3.5' : 'h-4 w-4'" />
            <span>{{ item.label }}</span>
            <span
              v-if="level === 'secondary' && modelValue === item.id"
              class="absolute bottom-0 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-primary-500"
            />
          </RouterLink>

          <button
            v-else
            type="button"
            class="flex shrink-0 items-center whitespace-nowrap transition-colors"
            :class="[
              level === 'primary'
                ? variant === 'pills'
                  ? 'gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold'
                  : 'h-8 gap-1.5 rounded-md px-3 text-xs font-semibold'
                : 'relative h-9 gap-1.5 px-2.5 text-xs font-medium',
              modelValue === item.id
                ? level === 'primary'
                  ? variant === 'pills'
                    ? 'bg-primary-500 text-white dark:bg-primary-900/30 dark:text-primary-300'
                    : 'bg-white text-primary-600 shadow-sm ring-1 ring-gray-900/5 dark:bg-white/10 dark:text-primary-400 dark:ring-white/10'
                  : 'text-gray-900 dark:text-white'
                : level === 'primary'
                  ? variant === 'pills'
                    ? 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                    : 'text-gray-500 hover:bg-white/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.07] dark:hover:text-white'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200',
            ]"
            :aria-pressed="modelValue === item.id"
            @click="selectItem(item)"
          >
            <UIcon v-if="item.icon" :name="item.icon" :class="level === 'primary' ? 'h-3.5 w-3.5' : 'h-4 w-4'" />
            <span>{{ item.label }}</span>
            <span
              v-if="level === 'secondary' && modelValue === item.id"
              class="absolute bottom-0 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-primary-500"
            />
          </button>
        </template>
      </div>
    </nav>

    <div v-if="$slots.right" class="flex w-full min-w-0 shrink-0 flex-wrap items-center xl:w-auto xl:justify-end">
      <slot name="right" />
    </div>
  </div>
</template>
