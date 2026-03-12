<script setup lang="ts">
/**
 * 会话索引管理区块
 * 配置会话索引阈值和批量生成功能
 */
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// 会话索引状态
interface SessionIndexStatus {
  id: string
  name: string
  hasIndex: boolean
  sessionCount: number
}

// 会话索引配置
const DEFAULT_GAP_MINUTES = 30 // 默认30分钟
const sessionGapMinutes = ref(DEFAULT_GAP_MINUTES)

// 批量生成相关状态
const allSessionsStatus = ref<SessionIndexStatus[]>([])
const isLoadingSessionStatus = ref(false)
const isBatchGenerating = ref(false)
const batchProgress = ref({ current: 0, total: 0, currentName: '' })

// 计算统计信息
const sessionIndexStats = computed(() => {
  const total = allSessionsStatus.value.length
  const generated = allSessionsStatus.value.filter((s) => s.hasIndex).length
  const notGenerated = total - generated
  return { total, generated, notGenerated }
})

// 进度百分比
const batchProgressPercent = computed(() => {
  if (batchProgress.value.total === 0) return 0
  return Math.round((batchProgress.value.current / batchProgress.value.total) * 100)
})

// 保存会话阈值（这里只是保存到本地存储，实际每个 session 的阈值在生成时传入）
function saveSessionThreshold() {
  if (sessionGapMinutes.value < 1) sessionGapMinutes.value = 1
  if (sessionGapMinutes.value > 1440) sessionGapMinutes.value = 1440
  // 保存到 localStorage 作为全局默认值
  localStorage.setItem('sessionGapThreshold', String(sessionGapMinutes.value * 60))
}

// 加载会话阈值
function loadSessionThreshold() {
  const saved = localStorage.getItem('sessionGapThreshold')
  if (saved) {
    sessionGapMinutes.value = Math.round(parseInt(saved, 10) / 60)
  }
}

// 加载所有会话的索引状态
async function loadSessionIndexStatus() {
  isLoadingSessionStatus.value = true
  try {
    // 获取所有会话
    const sessions = await window.chatApi.getSessions()

    // 获取每个会话的索引状态
    const statusList: SessionIndexStatus[] = []
    for (const session of sessions) {
      try {
        const stats = await window.sessionApi.getStats(session.id)
        statusList.push({
          id: session.id,
          name: session.name,
          hasIndex: stats.hasIndex,
          sessionCount: stats.sessionCount,
        })
      } catch {
        statusList.push({
          id: session.id,
          name: session.name,
          hasIndex: false,
          sessionCount: 0,
        })
      }
    }

    allSessionsStatus.value = statusList
  } catch (error) {
    console.error('加载会话索引状态失败:', error)
  } finally {
    isLoadingSessionStatus.value = false
  }
}

// 批量生成所有未生成索引的会话
async function batchGenerateIndex() {
  const notGeneratedSessions = allSessionsStatus.value.filter((s) => !s.hasIndex)
  if (notGeneratedSessions.length === 0) return

  isBatchGenerating.value = true
  batchProgress.value = { current: 0, total: notGeneratedSessions.length, currentName: '' }

  // 获取阈值
  const gapThreshold = sessionGapMinutes.value * 60

  for (let i = 0; i < notGeneratedSessions.length; i++) {
    const session = notGeneratedSessions[i]
    batchProgress.value = {
      current: i,
      total: notGeneratedSessions.length,
      currentName: session.name,
    }

    try {
      const count = await window.sessionApi.generate(session.id, gapThreshold)
      // 更新状态
      const statusItem = allSessionsStatus.value.find((s) => s.id === session.id)
      if (statusItem) {
        statusItem.hasIndex = true
        statusItem.sessionCount = count
      }
    } catch (error) {
      console.error(`生成会话 ${session.name} 索引失败:`, error)
    }
  }

  batchProgress.value = {
    current: notGeneratedSessions.length,
    total: notGeneratedSessions.length,
    currentName: '',
  }
  isBatchGenerating.value = false
}

// 批量重新生成所有会话的索引
async function batchRegenerateAll() {
  if (allSessionsStatus.value.length === 0) return

  isBatchGenerating.value = true
  batchProgress.value = { current: 0, total: allSessionsStatus.value.length, currentName: '' }

  // 获取阈值
  const gapThreshold = sessionGapMinutes.value * 60

  for (let i = 0; i < allSessionsStatus.value.length; i++) {
    const session = allSessionsStatus.value[i]
    batchProgress.value = {
      current: i,
      total: allSessionsStatus.value.length,
      currentName: session.name,
    }

    try {
      const count = await window.sessionApi.generate(session.id, gapThreshold)
      // 更新状态
      session.hasIndex = true
      session.sessionCount = count
    } catch (error) {
      console.error(`生成会话 ${session.name} 索引失败:`, error)
    }
  }

  batchProgress.value = {
    current: allSessionsStatus.value.length,
    total: allSessionsStatus.value.length,
    currentName: '',
  }
  isBatchGenerating.value = false
}

// 组件挂载时加载数据
onMounted(() => {
  loadSessionThreshold()
  loadSessionIndexStatus()
})
</script>

<template>
  <div class="space-y-6">
    <!-- 会话索引配置 -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <UIcon name="i-heroicons-clock" class="h-4 w-4 text-blue-500" />
            {{ t('settings.storage.session.title') }}
          </h3>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.storage.session.description') }}
          </p>
        </div>
        <!-- 刷新按钮 -->
        <UButton
          icon="i-heroicons-arrow-path"
          variant="ghost"
          size="xs"
          :loading="isLoadingSessionStatus"
          @click="loadSessionIndexStatus"
        />
      </div>

      <!-- 默认阈值设置 -->
      <div
        class="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50"
      >
        <div>
          <span class="text-sm text-gray-700 dark:text-gray-300">
            {{ t('settings.storage.session.defaultThreshold') }}
          </span>
          <p class="text-xs text-gray-400">
            {{ t('settings.storage.session.thresholdHelp') }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UInput
            v-model.number="sessionGapMinutes"
            type="number"
            :min="1"
            :max="1440"
            size="xs"
            class="w-20"
            @blur="saveSessionThreshold"
          />
          <span class="text-xs text-gray-500">{{ t('settings.storage.session.thresholdUnit') }}</span>
        </div>
      </div>

      <!-- 会话索引统计 -->
      <div class="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm text-gray-700 dark:text-gray-300">
              {{ t('settings.storage.session.batchTitle') }}
            </span>
            <div v-if="!isLoadingSessionStatus" class="mt-1 flex items-center gap-3 text-xs">
              <span class="text-gray-500">
                {{ t('settings.storage.session.totalSessions', { count: sessionIndexStats.total }) }}
              </span>
              <span class="text-green-600 dark:text-green-400">
                {{ t('settings.storage.session.generatedCount', { count: sessionIndexStats.generated }) }}
              </span>
              <span v-if="sessionIndexStats.notGenerated > 0" class="text-amber-600 dark:text-amber-400">
                {{ t('settings.storage.session.notGeneratedCount', { count: sessionIndexStats.notGenerated }) }}
              </span>
            </div>
            <div v-else class="mt-1 flex items-center gap-1 text-xs text-gray-400">
              <UIcon name="i-heroicons-arrow-path" class="h-3 w-3 animate-spin" />
              {{ t('settings.storage.session.loadingStatus') }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              v-if="sessionIndexStats.notGenerated > 0"
              size="xs"
              color="primary"
              :loading="isBatchGenerating"
              :disabled="isLoadingSessionStatus"
              @click="batchGenerateIndex"
            >
              <UIcon v-if="!isBatchGenerating" name="i-heroicons-sparkles" class="mr-1 h-3 w-3" />
              {{ t('settings.storage.session.batchGenerate') }}
            </UButton>
            <UButton
              size="xs"
              variant="soft"
              :loading="isBatchGenerating"
              :disabled="isLoadingSessionStatus || sessionIndexStats.total === 0"
              @click="batchRegenerateAll"
            >
              <UIcon v-if="!isBatchGenerating" name="i-heroicons-arrow-path" class="mr-1 h-3 w-3" />
              {{ t('settings.storage.session.batchRegenerate') }}
            </UButton>
          </div>
        </div>

        <!-- 批量生成进度 -->
        <div v-if="isBatchGenerating" class="mt-3 space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="text-gray-500">
              {{ t('settings.storage.session.generating') }} {{ batchProgress.currentName }}
            </span>
            <span class="font-medium text-gray-700 dark:text-gray-300">
              {{ batchProgress.current }}/{{ batchProgress.total }} ({{ batchProgressPercent }}%)
            </span>
          </div>
          <UProgress :value="batchProgressPercent" size="sm" />
        </div>
      </div>
    </div>
  </div>
</template>
