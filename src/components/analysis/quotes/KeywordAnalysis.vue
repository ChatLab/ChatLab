<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LaughAnalysis, KeywordTemplate as BaseKeywordTemplate } from '@/types/analysis'
import { ListPro } from '@/components/charts'
import type { RankItem } from '@/components/charts'
import { LoadingState } from '@/components/UI'
import { getRankBadgeClass } from '@/utils'
import { usePromptStore } from '@/stores/prompt'

const { t } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

// 扩展基础模板类型，添加组件内使用的字段
interface KeywordTemplate extends BaseKeywordTemplate {
  description?: string
  isCustom?: boolean
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

// 使用提示词配置 store 管理关键词模板
const promptStore = usePromptStore()

// 颜色模式：false = 单色，true = 多色
const isMultiColor = ref(false)

// 单色模式颜色
const SINGLE_COLOR = {
  bg: 'bg-pink-400',
  text: 'text-pink-700',
  badge: 'pink' as const,
  wrapBg: 'bg-pink-50 dark:bg-pink-900/20',
}

// 多色模式颜色池（使用完整类名以支持 Tailwind 扫描）
const KEYWORD_COLORS = [
  { bg: 'bg-amber-400', text: 'text-amber-700', badge: 'amber' as const, wrapBg: 'bg-amber-50 dark:bg-amber-900/20' },
  { bg: 'bg-pink-400', text: 'text-pink-700', badge: 'pink' as const, wrapBg: 'bg-pink-50 dark:bg-pink-900/20' },
  { bg: 'bg-blue-400', text: 'text-blue-700', badge: 'blue' as const, wrapBg: 'bg-blue-50 dark:bg-blue-900/20' },
  { bg: 'bg-green-400', text: 'text-green-700', badge: 'green' as const, wrapBg: 'bg-green-50 dark:bg-green-900/20' },
  {
    bg: 'bg-purple-400',
    text: 'text-purple-700',
    badge: 'purple' as const,
    wrapBg: 'bg-purple-50 dark:bg-purple-900/20',
  },
  { bg: 'bg-red-400', text: 'text-red-700', badge: 'red' as const, wrapBg: 'bg-red-50 dark:bg-red-900/20' },
  { bg: 'bg-cyan-400', text: 'text-cyan-700', badge: 'cyan' as const, wrapBg: 'bg-cyan-50 dark:bg-cyan-900/20' },
  {
    bg: 'bg-orange-400',
    text: 'text-orange-700',
    badge: 'orange' as const,
    wrapBg: 'bg-orange-50 dark:bg-orange-900/20',
  },
]

// 获取关键词对应的颜色
function getKeywordColor(keyword: string) {
  if (!isMultiColor.value) {
    return SINGLE_COLOR
  }
  const index = currentKeywords.value.indexOf(keyword)
  return KEYWORD_COLORS[index % KEYWORD_COLORS.length]
}

// 预设模板（使用计算属性以支持国际化）
const PRESET_TEMPLATE_IDS = ['laugh', 'sad', 'praise', 'slacker', 'gossip', 'polite', 'curious'] as const

const PRESET_TEMPLATES = computed<KeywordTemplate[]>(() => [
  {
    id: 'laugh',
    name: t('quotes.keywords.templates.laugh.name'),
    keywords: t('quotes.keywords.templates.laugh.keywords').split(','),
    description: t('quotes.keywords.templates.laugh.description'),
  },
  {
    id: 'sad',
    name: t('quotes.keywords.templates.sad.name'),
    keywords: t('quotes.keywords.templates.sad.keywords').split(','),
    description: t('quotes.keywords.templates.sad.description'),
  },
  {
    id: 'praise',
    name: t('quotes.keywords.templates.praise.name'),
    keywords: t('quotes.keywords.templates.praise.keywords').split(','),
    description: t('quotes.keywords.templates.praise.description'),
  },
  {
    id: 'slacker',
    name: t('quotes.keywords.templates.slacker.name'),
    keywords: t('quotes.keywords.templates.slacker.keywords').split(','),
    description: t('quotes.keywords.templates.slacker.description'),
  },
  {
    id: 'gossip',
    name: t('quotes.keywords.templates.gossip.name'),
    keywords: t('quotes.keywords.templates.gossip.keywords').split(','),
    description: t('quotes.keywords.templates.gossip.description'),
  },
  {
    id: 'polite',
    name: t('quotes.keywords.templates.polite.name'),
    keywords: t('quotes.keywords.templates.polite.keywords').split(','),
    description: t('quotes.keywords.templates.polite.description'),
  },
  {
    id: 'curious',
    name: t('quotes.keywords.templates.curious.name'),
    keywords: t('quotes.keywords.templates.curious.keywords').split(','),
    description: t('quotes.keywords.templates.curious.description'),
  },
])

// 合并预设和自定义模板
const allTemplates = computed<KeywordTemplate[]>(() => {
  const custom = promptStore.customKeywordTemplates.map((tpl) => ({
    ...tpl,
    isCustom: true,
  }))
  // 过滤掉已删除的预设模板
  const activePresets = PRESET_TEMPLATES.value.filter((tpl) => !promptStore.deletedPresetTemplateIds.includes(tpl.id))
  return [...activePresets, ...custom]
})

// 当前选中的模板
const selectedTemplateId = ref<string>('laugh')

// 当前关键词（可编辑）- 初始化为空，将在 watch 中设置
const currentKeywords = ref<string[]>([])

// 初始化当前关键词（基于第一个预设模板）
watch(
  PRESET_TEMPLATES,
  (templates) => {
    if (templates.length > 0 && currentKeywords.value.length === 0) {
      currentKeywords.value = [...templates[0].keywords]
    }
  },
  { immediate: true }
)

// 获取当前模板名称
const currentTemplateName = computed(() => {
  const template = allTemplates.value.find((t) => t.id === selectedTemplateId.value)
  return template ? template.name : ''
})

// 分析结果
const analysis = ref<LaughAnalysis | null>(null)
const isLoading = ref(false)

// 模板弹窗（创建/编辑）
const showTemplateModal = ref(false)
const editingTemplateId = ref<string | null>(null)
const templateName = ref('')
const templateKeywords = ref<string[]>([])
const newTemplateKeyword = ref('')

// 是否编辑模式
const isEditMode = computed(() => editingTemplateId.value !== null)
const modalTitle = computed(() =>
  isEditMode.value ? t('quotes.keywords.modal.editTitle') : t('quotes.keywords.modal.createTitle')
)

// 打开创建模板弹窗
function openCreateModal() {
  editingTemplateId.value = null
  templateName.value = ''
  templateKeywords.value = []
  newTemplateKeyword.value = ''
  showTemplateModal.value = true
}

// 打开编辑模板弹窗
function openEditModal(template: KeywordTemplate) {
  editingTemplateId.value = template.id
  templateName.value = template.name
  templateKeywords.value = [...template.keywords]
  showTemplateModal.value = true
}

// 模板添加关键词
function addTemplateKeyword() {
  const trimmed = newTemplateKeyword.value.trim()
  if (trimmed && !templateKeywords.value.includes(trimmed)) {
    templateKeywords.value = [...templateKeywords.value, trimmed]
  }
  newTemplateKeyword.value = ''
}

// 模板删除关键词
function removeTemplateKeyword(keyword: string) {
  templateKeywords.value = templateKeywords.value.filter((k) => k !== keyword)
}

// 选择模板
function selectTemplate(template: KeywordTemplate) {
  selectedTemplateId.value = template.id
  currentKeywords.value = [...template.keywords]
  // 切换模板时先清空数据，触发 loading 状态
  analysis.value = null
  loadAnalysis()
}

// 清空所有关键词
function clearAllKeywords() {
  currentKeywords.value = []
  analysis.value = null
  selectedTemplateId.value = ''
}

// 当前关键词输入
const newKeyword = ref('')

// 添加关键词
function addKeyword() {
  const trimmed = newKeyword.value.trim()
  if (trimmed && !currentKeywords.value.includes(trimmed)) {
    currentKeywords.value = [...currentKeywords.value, trimmed]
    loadAnalysis()
  }
  newKeyword.value = ''
}

// 删除关键词
function removeKeyword(keyword: string) {
  currentKeywords.value = currentKeywords.value.filter((k) => k !== keyword)
  loadAnalysis()
}

// 判断是否为预设模板
function isPresetTemplate(templateId: string): boolean {
  return PRESET_TEMPLATE_IDS.includes(templateId as (typeof PRESET_TEMPLATE_IDS)[number])
}

// 保存模板（创建或更新）
function saveTemplate() {
  if (!templateName.value.trim()) return

  if (isEditMode.value && editingTemplateId.value) {
    if (isPresetTemplate(editingTemplateId.value)) {
      const newTemplate = {
        id: `custom_${Date.now()}`,
        name: templateName.value.trim(),
        keywords: [...templateKeywords.value],
      }
      promptStore.addCustomKeywordTemplate(newTemplate)
      selectedTemplateId.value = newTemplate.id
      currentKeywords.value = [...newTemplate.keywords]
      loadAnalysis()
    } else {
      promptStore.updateCustomKeywordTemplate(editingTemplateId.value, {
        name: templateName.value.trim(),
        keywords: [...templateKeywords.value],
      })
      if (selectedTemplateId.value === editingTemplateId.value) {
        currentKeywords.value = [...templateKeywords.value]
        loadAnalysis()
      }
    }
  } else {
    const newTemplate = {
      id: `custom_${Date.now()}`,
      name: templateName.value.trim(),
      keywords: [...templateKeywords.value],
    }
    promptStore.addCustomKeywordTemplate(newTemplate)
    selectedTemplateId.value = newTemplate.id
    currentKeywords.value = [...newTemplate.keywords]
    loadAnalysis()
  }

  showTemplateModal.value = false
}

// 删除模板（支持预设和自定义）
function deleteTemplate(templateId: string) {
  if (isPresetTemplate(templateId)) {
    promptStore.addDeletedPresetTemplateId(templateId)
  } else {
    promptStore.removeCustomKeywordTemplate(templateId)
  }

  if (selectedTemplateId.value === templateId) {
    // 如果删除的是当前选中的模板，尝试选中第一个可用模板，否则清空
    if (allTemplates.value.length > 0) {
      selectTemplate(allTemplates.value[0])
    } else {
      clearAllKeywords()
    }
  }
}

// 加载分析数据
async function loadAnalysis() {
  if (!props.sessionId || currentKeywords.value.length === 0) {
    analysis.value = null
    return
  }

  isLoading.value = true
  try {
    analysis.value = await window.chatApi.getLaughAnalysis(props.sessionId, props.timeFilter, [
      ...currentKeywords.value,
    ])
  } catch (error) {
    console.error('加载词频分析失败:', error)
    analysis.value = null
  } finally {
    isLoading.value = false
  }
}

// 扩展的排行数据类型
interface ExtendedRankItem extends RankItem {
  keywordDistribution: Array<{ keyword: string; count: number; percentage: number }>
}

// 排行榜数据（按次数排序）
const rankData = computed<ExtendedRankItem[]>(() => {
  if (!analysis.value) return []
  return analysis.value.rankByCount.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.laughCount,
    percentage: m.percentage,
    keywordDistribution: m.keywordDistribution || [],
  }))
})

// 相对百分比计算（第一名100%）
function getRelativePercentage(index: number): number {
  if (rankData.value.length === 0) return 0
  const maxValue = rankData.value[0].value
  if (maxValue === 0) return 0
  return Math.round((rankData.value[index].value / maxValue) * 100)
}

// 获取关键词分布的堆叠宽度数据
function getStackedWidths(
  member: ExtendedRankItem,
  index: number
): Array<{ keyword: string; width: number; bg: string }> {
  const relativePercent = getRelativePercentage(index)
  if (!member.keywordDistribution || member.keywordDistribution.length === 0) {
    return [{ keyword: 'default', width: relativePercent, bg: 'bg-amber-400' }]
  }
  return member.keywordDistribution.map((kd) => ({
    keyword: kd.keyword,
    width: (kd.percentage / 100) * relativePercent,
    bg: getKeywordColor(kd.keyword).bg,
  }))
}

// 监听 sessionId 和 timeFilter 变化
watch(
  () => [props.sessionId, props.timeFilter],
  () => {
    loadAnalysis()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <ListPro
    :items="rankData"
    :title="t('quotes.keywords.title')"
    :description="t('quotes.keywords.description')"
    :top-n="10"
    :count-template="t('quotes.keywords.countTemplate')"
  >
    <!-- 配置区 -->
    <template #config>
      <!-- 模板选择 + 关键词配置 -->
      <div class="border-b border-gray-100 p-4 dark:border-gray-800">
        <!-- 模板选择行 -->
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ t('quotes.keywords.templateLabel') }}</span>
          <UContextMenu
            v-for="template in allTemplates"
            :key="template.id"
            :items="[
              [
                {
                  label: t('quotes.keywords.contextMenu.edit'),
                  icon: 'i-lucide-pencil',
                  disabled: !template.isCustom,
                  onSelect: () => openEditModal(template),
                },
                {
                  label: t('quotes.keywords.contextMenu.delete'),
                  icon: 'i-lucide-trash',
                  color: 'error' as const,
                  onSelect: () => deleteTemplate(template.id),
                },
              ],
            ]"
          >
            <button
              class="rounded-md border px-2.5 py-1 text-sm transition-all"
              :class="
                selectedTemplateId === template.id
                  ? 'border-pink-500 bg-pink-50 text-pink-600 dark:border-pink-400 dark:bg-pink-900/20 dark:text-pink-400'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600'
              "
              @click="selectTemplate(template)"
            >
              {{ template.name }}
            </button>
          </UContextMenu>

          <!-- 新建/编辑模板弹窗 -->
          <UModal v-model:open="showTemplateModal">
            <button
              class="rounded-md border border-dashed border-gray-300 px-2.5 py-1 text-sm text-gray-500 transition-all hover:border-pink-400 hover:text-pink-500 dark:border-gray-600"
              @click="openCreateModal"
            >
              {{ t('quotes.keywords.newTemplate') }}
            </button>
            <template #content>
              <div class="p-4">
                <h3 class="mb-3 font-semibold text-gray-900 dark:text-white">{{ modalTitle }}</h3>
                <div class="space-y-3">
                  <div>
                    <label class="mb-1 block text-xs text-gray-500">
                      {{ t('quotes.keywords.modal.templateName') }}
                    </label>
                    <UInput v-model="templateName" :placeholder="t('quotes.keywords.modal.templateNamePlaceholder')" />
                  </div>
                  <div>
                    <label class="mb-1 block text-xs text-gray-500">{{ t('quotes.keywords.modal.keywords') }}</label>
                    <div class="flex flex-wrap items-center gap-2">
                      <UBadge
                        v-for="keyword in templateKeywords"
                        :key="keyword"
                        variant="soft"
                        class="cursor-pointer"
                        @click="removeTemplateKeyword(keyword)"
                      >
                        {{ keyword }}
                        <span class="ml-0.5 hover:text-red-500">×</span>
                      </UBadge>
                      <UInput
                        v-model="newTemplateKeyword"
                        :placeholder="t('quotes.keywords.modal.keywordPlaceholder')"
                        class="w-full"
                        @keydown.enter.prevent="addTemplateKeyword"
                      />
                    </div>
                  </div>
                </div>
                <div class="mt-4 flex justify-end gap-2">
                  <UButton variant="soft" @click="showTemplateModal = false">{{ t('common.cancel') }}</UButton>
                  <UButton
                    color="primary"
                    :disabled="!templateName.trim() || templateKeywords.length === 0"
                    @click="saveTemplate"
                  >
                    {{ isEditMode ? t('quotes.keywords.modal.update') : t('common.save') }}
                  </UButton>
                </div>
              </div>
            </template>
          </UModal>
        </div>

        <!-- 关键词编辑行 -->
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            v-for="keyword in currentKeywords"
            :key="keyword"
            class="cursor-pointer"
            @click="removeKeyword(keyword)"
          >
            {{ keyword }}
            <span class="ml-0.5 hover:text-red-500">×</span>
          </UBadge>
          <UInput
            v-model="newKeyword"
            :placeholder="t('quotes.keywords.searchPlaceholder')"
            class="w-32"
            @keydown.enter.prevent="addKeyword"
          />
          <button
            v-if="currentKeywords.length > 0"
            class="text-sm text-pink-500 hover:text-red-500"
            @click="clearAllKeywords"
          >
            {{ t('quotes.keywords.clear') }}
          </button>
        </div>
        <div class="mt-1.5 text-xs text-gray-400">{{ t('quotes.keywords.templateHint') }}</div>
      </div>

      <!-- 关键词类型分布（图例） -->
      <div
        v-if="analysis && analysis.typeDistribution.length > 0"
        class="border-b border-gray-100 px-5 py-4 dark:border-gray-800"
      >
        <div class="mb-3 flex items-center justify-between">
          <span class="text-base font-medium text-gray-700 dark:text-gray-300">
            {{
              currentTemplateName
                ? currentTemplateName
                : currentKeywords.length === 1
                  ? currentKeywords[0]
                  : t('quotes.keywords.keyword')
            }}{{ t('quotes.keywords.ranking') }}
          </span>
          <label class="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
            <span>{{ t('quotes.keywords.multiColorMode') }}</span>
            <USwitch v-model="isMultiColor" size="md" />
          </label>
        </div>
        <div class="flex flex-wrap gap-2">
          <div
            v-for="item in analysis.typeDistribution"
            :key="item.type"
            class="flex items-center gap-2 rounded-lg px-2 py-2 text-xs"
            :class="getKeywordColor(item.type).wrapBg"
          >
            <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="getKeywordColor(item.type).bg" />
            <span class="font-medium" :class="getKeywordColor(item.type).text">{{ item.type }}</span>
            <span class="text-xs text-gray-500">{{ t('quotes.keywords.times', { count: item.count }) }}</span>
            <UBadge :color="getKeywordColor(item.type).badge" variant="soft" size="xs">{{ item.percentage }}%</UBadge>
          </div>
        </div>
      </div>

      <!-- Loading 状态（无数据时） -->
      <LoadingState v-if="isLoading && rankData.length === 0" :text="t('quotes.keywords.loading')" />
    </template>

    <!-- 成员排行项 -->
    <template #item="{ item: member, index }">
      <div class="flex items-center gap-3">
        <!-- 排名 -->
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
          :class="getRankBadgeClass(index)"
        >
          {{ index + 1 }}
        </div>

        <!-- 名字 -->
        <div class="w-32 shrink-0">
          <p class="truncate font-medium text-gray-900 dark:text-white">
            {{ member.name }}
          </p>
        </div>

        <!-- 堆叠进度条 -->
        <div class="flex flex-1 items-center">
          <div class="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              v-for="segment in getStackedWidths(member, index)"
              :key="segment.keyword"
              class="h-full transition-all first:rounded-l-full last:rounded-r-full"
              :class="segment.bg"
              :style="{ width: `${segment.width}%` }"
              :title="`${segment.keyword}: ${segment.width.toFixed(1)}%`"
            />
          </div>
        </div>

        <!-- 数值和百分比 -->
        <div class="flex shrink-0 items-baseline gap-2">
          <span class="text-lg font-bold text-gray-900 dark:text-white">{{ member.value }}</span>
          <span class="text-sm text-gray-500">
            {{ t('quotes.keywords.timesWithPercent', { count: member.value, percent: member.percentage }) }}
          </span>
        </div>
      </div>
    </template>

    <!-- 自定义空状态 -->
    <template #empty>
      <div v-if="!isLoading" class="flex h-64 flex-col items-center justify-center text-gray-400">
        <UIcon name="i-heroicons-magnifying-glass" class="mb-2 h-8 w-8 opacity-50" />
        <p class="text-sm">{{ t('quotes.keywords.empty') }}</p>
      </div>
      <div v-else class="h-64" />
    </template>
  </ListPro>
</template>
