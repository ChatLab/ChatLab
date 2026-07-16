<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ExpandableListCard from './ExpandableListCard.vue'

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
    /** 已完成国际化插值的总数描述 */
    countLabel?: string
  }>(),
  {
    topN: 10,
  }
)

// Top N 数据
const topNData = computed(() => props.items.slice(0, props.topN))

// 是否显示"查看完整"按钮
const showViewAll = computed(() => props.items.length > props.topN)

// 格式化总数描述
const formattedCount = computed(() => {
  if (props.countLabel) return props.countLabel
  return t('views.charts.listPro.countTemplate', { count: props.items.length })
})
</script>

<template>
  <ExpandableListCard
    :title="title"
    :description="description"
    :show-view-all="showViewAll"
    :view-all-label="t('views.charts.listPro.fullRanking')"
    :count-label="formattedCount"
  >
    <template #headerRight>
      <slot name="headerRight" />
    </template>

    <template #full>
      <div>
        <div
          v-for="(item, index) in items"
          :key="index"
          class="group/list-row px-5 py-3.5 transition-colors hover:bg-gray-50/70 dark:hover:bg-white/5"
        >
          <slot name="item" :item="item" :index="index" />
        </div>
      </div>
    </template>

    <!-- 配置区（可选） -->
    <slot name="config" />

    <!-- 默认显示 Top N -->
    <div>
      <div
        v-for="(item, index) in topNData"
        :key="index"
        class="group/list-row px-5 py-3.5 transition-colors hover:bg-gray-50/70 dark:hover:bg-white/5"
      >
        <slot name="item" :item="item" :index="index" />
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="items.length === 0">
      <slot name="empty">
        <div class="px-5 py-8 text-center text-sm text-gray-400">{{ t('views.charts.listPro.empty') }}</div>
      </slot>
    </div>
  </ExpandableListCard>
</template>
