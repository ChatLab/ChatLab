<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEmbeddingStore } from '@/stores/embedding'
import EmbeddingConfigEditModal from './EmbeddingConfigEditModal.vue'
import type { EmbeddingServiceConfigDisplay } from '@electron/preload/index'

const { t } = useI18n()

// Store
const embeddingStore = useEmbeddingStore()

// Emits
const emit = defineEmits<{
  'config-changed': []
}>()

// ============ 状态 ============

const showEditModal = ref(false)
const editMode = ref<'add' | 'edit'>('add')
const editingConfig = ref<EmbeddingServiceConfigDisplay | null>(null)

// ============ 计算属性 ============

const isLoading = computed(() => embeddingStore.isLoading)
const configs = computed(() => embeddingStore.configs)
const activeConfigId = computed(() => embeddingStore.activeConfigId)
const hasConfig = computed(() => embeddingStore.hasConfig)
const isMaxConfigs = computed(() => embeddingStore.isMaxConfigs)
const vectorStoreStats = computed(() => embeddingStore.vectorStoreStats)
const vectorStoreSizeFormatted = computed(() => embeddingStore.vectorStoreSizeFormatted)

// ============ 方法 ============

function openAddModal() {
  editMode.value = 'add'
  editingConfig.value = null
  showEditModal.value = true
}

function openEditModal(config: EmbeddingServiceConfigDisplay) {
  editMode.value = 'edit'
  editingConfig.value = config
  showEditModal.value = true
}

async function handleSaved() {
  await embeddingStore.refreshConfigs()
  emit('config-changed')
}

async function handleSetActive(id: string) {
  await embeddingStore.setActiveConfig(id)
  emit('config-changed')
}

async function handleDelete(config: EmbeddingServiceConfigDisplay) {
  if (!confirm(t('settings.embedding.deleteConfirm', { name: config.name }))) {
    return
  }
  await embeddingStore.deleteConfig(config.id)
  emit('config-changed')
}

async function handleClearVectorStore() {
  if (!confirm(t('settings.embedding.clearVectorStoreConfirm'))) {
    return
  }
  await embeddingStore.clearVectorStore()
}

onMounted(() => {
  embeddingStore.init()
})
</script>

<template>
  <!-- 加载中 -->
  <div v-if="isLoading && !embeddingStore.isInitialized" class="flex items-center justify-center py-12">
    <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-gray-400" />
  </div>

  <!-- 配置内容 -->
  <div v-else class="space-y-6">
    <!-- 标题 -->
    <h4 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
      <UIcon name="i-heroicons-magnifying-glass-circle" class="h-4 w-4 text-emerald-500" />
      {{ t('settings.embedding.title') }}
    </h4>

    <p class="text-xs text-gray-500 dark:text-gray-400">
      {{ t('settings.embedding.description') }}
    </p>

    <!-- Embedding 配置列表 -->
    <div class="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('settings.embedding.configList') }}
        </span>
        <UButton
          size="xs"
          color="primary"
          variant="soft"
          icon="i-heroicons-plus"
          :disabled="isMaxConfigs"
          @click="openAddModal"
        >
          {{ t('settings.embedding.addConfig') }}
        </UButton>
      </div>

      <!-- 配置列表 -->
      <div v-if="configs.length > 0" class="space-y-2">
        <div
          v-for="config in configs"
          :key="config.id"
          :class="[
            'flex items-center justify-between rounded-lg border p-3 transition-colors',
            config.id === activeConfigId
              ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-900/20'
              : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600',
          ]"
        >
          <div class="flex items-center gap-3">
            <!-- 选中指示器 -->
            <div
              :class="[
                'h-2 w-2 rounded-full',
                config.id === activeConfigId ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600',
              ]"
            />
            <div>
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ config.name }}
                </span>
                <span
                  v-if="config.id === activeConfigId"
                  class="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400"
                >
                  {{ t('settings.embedding.active') }}
                </span>
              </div>
              <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>{{ config.model }}</span>
                <span>·</span>
                <span>
                  {{
                    config.apiSource === 'reuse_llm'
                      ? t('settings.embedding.reuseLLM')
                      : t('settings.embedding.customAPI')
                  }}
                </span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1">
            <!-- 设为激活 -->
            <UButton
              v-if="config.id !== activeConfigId"
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-heroicons-check"
              :title="t('settings.embedding.setActive')"
              @click="handleSetActive(config.id)"
            />
            <!-- 编辑 -->
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-heroicons-pencil"
              :title="t('common.edit')"
              @click="openEditModal(config)"
            />
            <!-- 删除 -->
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              icon="i-heroicons-trash"
              :title="t('common.delete')"
              @click="handleDelete(config)"
            />
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {{ t('settings.embedding.noConfigs') }}
      </div>
    </div>

    <!-- 向量缓存配置 -->
    <div class="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ t('settings.embedding.vectorStore') }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.embedding.vectorStoreDesc') }}
          </p>
        </div>
      </div>

      <!-- 向量存储统计 -->
      <div
        v-if="vectorStoreStats.enabled"
        class="flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-700"
      >
        <div class="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
          <span>{{ t('settings.embedding.cached') }}: {{ vectorStoreStats.count ?? 0 }}</span>
          <span>{{ t('settings.embedding.size') }}: {{ vectorStoreSizeFormatted }}</span>
        </div>
        <UButton
          v-if="(vectorStoreStats.count ?? 0) > 0"
          size="xs"
          color="error"
          variant="soft"
          @click="handleClearVectorStore"
        >
          {{ t('settings.embedding.clear') }}
        </UButton>
      </div>
    </div>
  </div>

  <!-- 编辑弹窗 -->
  <EmbeddingConfigEditModal
    v-model:open="showEditModal"
    :mode="editMode"
    :config="editingConfig"
    @saved="handleSaved"
  />
</template>
