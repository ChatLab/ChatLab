<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'

interface TabItem {
  label: string
  value: string | number
}

interface Props {
  modelValue: string | number
  items: TabItem[]
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

interface Emits {
  (e: 'update:modelValue', value: string | number): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// DOM 引用
const scrollContainer = ref<HTMLElement>()
const tabsRef = ref<ComponentPublicInstance>()

// 计算内部值
const selectedValue = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

// 滚动到选中标签的中心位置
const scrollToCenter = async () => {
  await nextTick()

  if (!scrollContainer.value || !tabsRef.value) return

  // 查找当前选中的标签元素
  const selectedIndex = props.items.findIndex((item) => item.value === selectedValue.value)
  if (selectedIndex < 0) return

  // 通过UTabs组件的DOM查找标签元素
  const tabsElement = tabsRef.value.$el as HTMLElement
  const allTabs = tabsElement.querySelectorAll('[role="tab"]')
  const selectedTab = allTabs[selectedIndex] as HTMLElement

  if (!selectedTab) return

  const container = scrollContainer.value
  const containerWidth = container.clientWidth

  // 获取标签相对于滚动容器的位置
  const tabLeft = selectedTab.offsetLeft
  const tabWidth = selectedTab.offsetWidth

  // 计算需要滚动到的位置（让标签居中）
  const targetScrollLeft = tabLeft + tabWidth / 2 - containerWidth / 2

  // 平滑滚动到目标位置
  container.scrollTo({
    left: Math.max(0, targetScrollLeft),
    behavior: 'smooth',
  })
}

// 监听选中值变化，自动滚动到中心
watch(
  selectedValue,
  () => {
    scrollToCenter()
  },
  { immediate: false }
)
</script>

<template>
  <div ref="scrollContainer" class="overflow-x-auto overflow-y-hidden scrollbar-hide">
    <UTabs ref="tabsRef" v-model="selectedValue" :size="size" :items="items" :content="false" class="min-w-max" />
  </div>
</template>

<style scoped>
/* 隐藏滚动条但保留滚动功能 */
.scrollbar-hide {
  -ms-overflow-style: none; /* IE and Edge */
  scrollbar-width: none; /* Firefox */
}

.scrollbar-hide::-webkit-scrollbar {
  display: none; /* Chrome, Safari and Opera */
}
</style>
