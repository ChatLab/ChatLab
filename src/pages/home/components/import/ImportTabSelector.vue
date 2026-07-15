<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue: 'file' | 'api' | 'cli'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: 'file' | 'api' | 'cli']
}>()

const { t } = useI18n()

// 定义切换栏的三个固定选项
const tabs = [
  { id: 'file', labelKey: 'home.tabs.file' },
  { id: 'cli', labelKey: 'home.tabs.cli' },
  { id: 'api', labelKey: 'home.tabs.api' },
] as const

// 缓存按钮引用以计算滑动偏移
const buttonRefs = ref<HTMLElement[]>([])
const containerRef = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null

// 滑动胶囊环的样式属性
const ringStyle = ref({
  width: '0px',
  transform: 'translateX(0px)',
  opacity: 0,
})

// 更新滑动焦点环的位置和宽度
const updateRing = async () => {
  await nextTick()
  const index = tabs.findIndex((tab) => tab.id === props.modelValue)
  if (index !== -1 && buttonRefs.value[index]) {
    const el = buttonRefs.value[index]
    ringStyle.value = {
      // 左右各外扩 3px，因此宽度增加 6px，位置向左偏移 3px
      width: `${el.offsetWidth + 6}px`,
      transform: `translateX(${el.offsetLeft - 3}px)`,
      opacity: 1,
    }
  } else {
    ringStyle.value.opacity = 0
  }
}

// 监听选中值变化，更新滑动焦点位置
watch(
  () => props.modelValue,
  () => {
    updateRing()
  }
)

onMounted(() => {
  updateRing()

  // 监听容器大小变动以应对窗口缩放等情况
  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateRing()
    })
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})
</script>

<template>
  <div class="flex justify-center select-none">
    <!-- 主胶囊容器：p-[3px] 留出上下 3px 扩张空间，gap-1.5 避免背景重叠 -->
    <div
      ref="containerRef"
      class="relative flex items-center justify-center gap-1.5 rounded-full bg-gray-50/60 p-[3px] shadow-inner ring-1 ring-inset ring-gray-900/5 backdrop-blur-md dark:bg-gray-800/40 dark:ring-white/10 z-0 overflow-visible"
    >
      <!-- 滑动选中焦点层：基于 CSS Transform 平滑移动 -->
      <div
        class="absolute left-0 inset-y-0 -z-10 rounded-full bg-white ring-[1.5px] ring-primary-500 shadow-sm transition-all duration-350 ease-out dark:bg-primary-700/15 dark:ring-primary-500"
        :style="ringStyle"
      ></div>

      <!-- 三个固定切换按钮 -->
      <button
        v-for="(tab, index) in tabs"
        :key="tab.id"
        :ref="
          (el) => {
            if (el) buttonRefs[index] = el as HTMLElement
          }
        "
        class="relative z-10 flex h-[32px] items-center justify-center whitespace-nowrap rounded-full px-5 text-[13px] font-medium transition-colors duration-200 cursor-pointer"
        :class="[
          modelValue === tab.id
            ? 'text-primary-600 dark:text-primary-400'
            : 'text-gray-500 hover:bg-gray-200/50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-gray-200',
        ]"
        @click="emit('update:modelValue', tab.id)"
      >
        {{ t(tab.labelKey) }}
      </button>
    </div>
  </div>
</template>
