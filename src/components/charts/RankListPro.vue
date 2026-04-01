<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import RankList from './RankList.vue'
import type { RankItem } from './RankList.vue'
import CaptureButton from '@/components/common/CaptureButton.vue'

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

// 控制弹窗
const isOpen = ref(false)

// 截屏相关 ref
const cardRef = ref<HTMLElement | null>(null)
const modalBodyRef = ref<HTMLElement | null>(null)

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
  <div ref="cardRef" class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
    <div class="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-800">
      <div>
        <h3 class="font-semibold text-gray-900 whitespace-nowrap dark:text-white">{{ title }}</h3>
        <p v-if="description" class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ description }}</p>
      </div>

      <div class="no-capture flex items-center gap-1">
        <!-- 卡片截屏按钮 -->
        <CaptureButton size="xs" type="element" :target-element="cardRef" />

        <!-- 完整排行榜 Dialog -->
        <UModal v-model:open="isOpen" :ui="{ content: 'md:w-full max-w-3xl' }">
          <UButton v-if="showViewAll" icon="i-heroicons-list-bullet" variant="ghost">
            {{ t('views.charts.rankListPro.fullRanking') }}
          </UButton>
          <template #content>
            <div ref="modalBodyRef" class="section-content flex flex-col">
              <!-- Header -->
              <div
                class="flex w-full items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700"
              >
                <div class="flex items-center gap-2">
                  <h3 class="text-lg font-semibold text-gray-900 whitespace-nowrap dark:text-white">{{ title }}</h3>
                  <span class="text-sm text-gray-500">
                    （{{ t('views.charts.rankListPro.memberCount', { count: members.length }) }}）
                  </span>
                </div>
                <CaptureButton size="xs" type="element" :target-element="modalBodyRef" />
              </div>
              <!-- Body -->
              <div class="max-h-[60vh] p-4 overflow-y-auto">
                <RankList :members="members" :unit="unit" />
              </div>
            </div>
          </template>
        </UModal>
      </div>
    </div>

    <RankList :members="topNData" :unit="unit" />
  </div>
</template>
