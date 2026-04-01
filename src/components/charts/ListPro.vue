<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CaptureButton from '@/components/common/CaptureButton.vue'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    /** 完整数据列表 */
    items: any[]
    /** 标题 */
    title: string
    /** 描述（可选） */
    description?: string
    /** 默认显示数量，默认 10 */
    topN?: number
    /** 弹窗中的总数描述模板，如 "共 {count} 位成员" */
    countTemplate?: string
  }>(),
  {
    topN: 10,
  }
)

// 控制弹窗
const isOpen = ref(false)

// 截屏相关 ref
const cardRef = ref<HTMLElement | null>(null)
const modalBodyRef = ref<HTMLElement | null>(null)

// Top N 数据
const topNData = computed(() => props.items.slice(0, props.topN))

// 是否显示"查看完整"按钮
const showViewAll = computed(() => props.items.length > props.topN)

// 格式化总数描述
const formattedCount = computed(() => {
  const template = props.countTemplate || t('views.charts.listPro.countTemplate')
  return template.replace('{count}', String(props.items.length))
})
</script>

<template>
  <div ref="cardRef" class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
    <div class="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-800">
      <div>
        <h3 class="font-semibold text-gray-900 whitespace-nowrap dark:text-white">{{ title }}</h3>
        <p v-if="description" class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ description }}</p>
      </div>

      <div class="no-capture flex items-center gap-2">
        <!-- 自定义头部右侧内容 -->
        <slot name="headerRight" />

        <!-- 卡片截屏按钮 -->
        <CaptureButton size="xs" type="element" :target-element="cardRef" />

        <!-- 完整列表弹窗 -->
        <UModal v-model:open="isOpen" :ui="{ content: 'md:w-full max-w-3xl' }">
          <UButton v-if="showViewAll" icon="i-heroicons-list-bullet" variant="ghost">
            {{ t('views.charts.listPro.fullRanking') }}
          </UButton>
          <template #content>
            <div ref="modalBodyRef" class="section-content flex flex-col">
              <!-- Header -->
              <div
                class="flex w-full items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700"
              >
                <div class="flex items-center gap-2">
                  <h3 class="text-lg font-semibold text-gray-900 whitespace-nowrap dark:text-white">{{ title }}</h3>
                  <span class="text-sm text-gray-500">（{{ formattedCount }}）</span>
                </div>
                <CaptureButton size="xs" type="element" :target-element="modalBodyRef" />
              </div>
              <!-- Body -->
              <div class="max-h-[60vh] p-4 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
                <div v-for="(item, index) in items" :key="index" class="px-5 py-3">
                  <slot name="item" :item="item" :index="index" />
                </div>
              </div>
            </div>
          </template>
        </UModal>
      </div>
    </div>

    <!-- 配置区（可选） -->
    <slot name="config" />

    <!-- 默认显示 Top N -->
    <div class="divide-y divide-gray-100 dark:divide-gray-800">
      <div v-for="(item, index) in topNData" :key="index" class="px-5 py-3">
        <slot name="item" :item="item" :index="index" />
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="items.length === 0">
      <slot name="empty">
        <div class="px-5 py-8 text-center text-sm text-gray-400">{{ t('views.charts.listPro.empty') }}</div>
      </slot>
    </div>
  </div>
</template>
