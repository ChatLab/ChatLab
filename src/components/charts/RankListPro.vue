<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import RankList from './RankList.vue'
import type { RankItem } from './RankList.vue'
import ExpandableListCard from './ExpandableListCard.vue'

const { t } = useI18n()

interface Props {
  /** 完整的排行数据 */
  members: RankItem[]
  /** 标题 */
  title: string
  /** 描述（可选） */
  description?: string
  /** 默认显示数量，默认 10 */
  topN?: number
  /** 单位名称 */
  unit?: string
}

const props = withDefaults(defineProps<Props>(), {
  topN: 10,
})

// Top N 数据
const topNData = computed(() => {
  return props.members.slice(0, props.topN)
})

// 是否显示"查看完整"按钮
const showViewAll = computed(() => {
  return props.members.length > props.topN
})
</script>

<template>
  <ExpandableListCard
    :title="title"
    :description="description"
    :show-view-all="showViewAll"
    :view-all-label="t('views.charts.rankListPro.fullRanking')"
    :count-label="t('views.charts.rankListPro.memberCount', { count: members.length })"
  >
    <template #full>
      <RankList :members="members" :unit="unit" />
    </template>

    <RankList :members="topNData" :unit="unit" />
  </ExpandableListCard>
</template>
