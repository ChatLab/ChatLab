<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * 轻量级子标签页组件
 * 适用于页面内部的二级导航,使用原生样式
 * 支持通过 persistKey 将选中状态同步到 URL 查询参数
 * 支持水平和垂直两种方向
 */
interface TabItem {
  id: string
  label: string
  icon?: string
}

interface Props {
  modelValue: string
  items: TabItem[]
  /** 持久化 key，设置后会将当前 tab 状态同步到 URL 查询参数 */
  persistKey?: string
  /** 方向：horizontal（水平）或 vertical（垂直） */
  orientation?: 'horizontal' | 'vertical'
}

interface Emits {
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
}

const props = withDefaults(defineProps<Props>(), {
  orientation: 'horizontal',
})
const emit = defineEmits<Emits>()

const route = useRoute()
const router = useRouter()

// 是否为垂直模式
const isVertical = computed(() => props.orientation === 'vertical')

// Tab 按钮引用
const tabRefs = ref<Record<string, HTMLElement | null>>({})
const containerRef = ref<HTMLElement | null>(null)

// 激活指示器的样式
const indicatorStyle = ref<Record<string, string>>({})

// 计算内部值
const activeTab = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
    emit('change', value)
  },
})

// 更新指示器位置
function updateIndicator() {
  const activeButton = tabRefs.value[activeTab.value]
  if (activeButton && containerRef.value) {
    const containerRect = containerRef.value.getBoundingClientRect()
    const buttonRect = activeButton.getBoundingClientRect()

    if (isVertical.value) {
      // 垂直模式：指示器在右侧
      indicatorStyle.value = {
        top: `${buttonRect.top - containerRect.top}px`,
        height: `${buttonRect.height}px`,
        right: '0px',
        width: '2px',
      }
    } else {
      // 水平模式：指示器在底部
      indicatorStyle.value = {
        left: `${buttonRect.left - containerRect.left}px`,
        width: `${buttonRect.width}px`,
        bottom: '0px',
        height: '2px',
      }
    }
  }
}

// 点击标签
const handleTabClick = (tabId: string) => {
  activeTab.value = tabId
}

// 设置 tab 引用
function setTabRef(id: string, el: HTMLElement | null) {
  tabRefs.value[id] = el
}

// 从 URL 查询参数恢复 tab 状态
onMounted(() => {
  if (props.persistKey) {
    const savedTab = route.query[props.persistKey] as string
    // 验证 savedTab 是否在 items 中存在
    if (savedTab && props.items.some((item) => item.id === savedTab)) {
      activeTab.value = savedTab
    }
  }
  // 初始更新指示器位置
  nextTick(() => {
    updateIndicator()
  })
})

// 监听 tab 变化，同步到 URL 查询参数并更新指示器
watch(
  () => props.modelValue,
  (newValue) => {
    if (props.persistKey && newValue) {
      // 使用 replace 而不是 push，避免产生大量历史记录
      router.replace({
        query: {
          ...route.query,
          [props.persistKey]: newValue,
        },
      })
    }
    // 更新指示器位置
    nextTick(() => {
      updateIndicator()
    })
  }
)

// 监听 items 变化，更新指示器位置
watch(
  () => props.items,
  () => {
    nextTick(() => {
      updateIndicator()
    })
  },
  { deep: true }
)
</script>

<template>
  <div
    :class="[
      isVertical
        ? 'h-full border-r border-gray-200/50 dark:border-gray-700/50'
        : 'flex items-center justify-between border-b border-gray-200/50 px-6 dark:border-gray-800/50',
    ]"
  >
    <div ref="containerRef" class="relative" :class="[isVertical ? 'flex flex-col gap-1' : 'flex gap-1']">
      <button
        v-for="tab in items"
        :key="tab.id"
        :ref="(el) => setTabRef(tab.id, el as HTMLElement)"
        class="flex items-center gap-2 text-sm font-medium transition-colors"
        :class="[
          isVertical ? 'justify-start px-3 py-2' : 'px-4 py-3',
          activeTab === tab.id
            ? 'text-primary-600 dark:text-primary-400'
            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
        ]"
        @click="handleTabClick(tab.id)"
      >
        <UIcon v-if="tab.icon" :name="tab.icon" class="h-4 w-4" />
        {{ tab.label }}
      </button>
      <!-- 滑动指示器 -->
      <div class="absolute bg-primary-500 transition-all duration-300 ease-out" :style="indicatorStyle" />
    </div>
    <!-- 右侧插槽（水平模式可用） -->
    <slot v-if="!isVertical" name="right" />
  </div>
</template>
