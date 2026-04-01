<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '@/stores/session'

const { t } = useI18n()
const sessionStore = useSessionStore()
const { migrationCount, pendingMigrations, isMigrating } = storeToRefs(sessionStore)

// 弹窗状态
const showModal = ref(false)
const migrationError = ref<string | null>(null)
const migrationPartialSuccess = ref(false) // 部分成功（有些数据库迁移失败）

// 是否允许关闭弹窗（有错误时允许）
const canClose = computed(() => migrationError.value !== null)

// 执行迁移
async function handleMigration() {
  migrationError.value = null
  migrationPartialSuccess.value = false
  const result = await sessionStore.runMigration()
  if (result.success) {
    showModal.value = false
    // 迁移完成后重新加载会话列表
    await sessionStore.loadSessions()
  } else {
    migrationError.value = result.error || t('home.migration.failed')
    // 如果有部分成功迁移的数据库，标记为部分成功
    migrationPartialSuccess.value = true
    // 重新加载会话列表（成功迁移的会话可以正常使用）
    await sessionStore.loadSessions()
  }
}

// 关闭弹窗（仅在有错误时可用）
function handleClose() {
  if (canClose.value) {
    showModal.value = false
  }
}

// 组件挂载时检查是否需要迁移
onMounted(async () => {
  const result = await sessionStore.checkMigration()
  if (result.needsMigration) {
    showModal.value = true
  }
})
</script>

<template>
  <UModal :open="showModal" :ui="{ content: 'max-w-md' }" :prevent-close="!canClose">
    <template #content>
      <div class="p-6 text-center">
        <div
          class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
          :class="migrationError ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-blue-100 dark:bg-blue-900/30'"
        >
          <UIcon
            :name="migrationError ? 'i-heroicons-exclamation-triangle' : 'i-heroicons-arrow-up-circle'"
            :class="migrationError ? 'h-7 w-7 text-amber-500' : 'h-7 w-7 text-blue-500'"
          />
        </div>
        <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
          {{ migrationError ? t('home.migration.partialFailed') : t('home.migration.title') }}
        </h3>
        <p v-if="!migrationError" class="mb-3 text-sm text-gray-500 dark:text-gray-400">
          {{ t('home.migration.description', { count: migrationCount }) }}
          <br />
          {{ t('home.migration.note') }}
        </p>

        <!-- 升级内容列表 -->
        <div
          v-if="pendingMigrations.length > 0 && !migrationError"
          class="mb-4 rounded-lg bg-gray-50 p-3 text-left dark:bg-gray-800"
        >
          <p class="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            {{ t('home.migration.upgradeContent') }}
          </p>
          <ul class="space-y-2">
            <li v-for="migration in pendingMigrations" :key="migration.version" class="flex items-start gap-2">
              <UIcon name="i-heroicons-check-circle" class="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
              <div>
                <p class="text-sm text-gray-700 dark:text-gray-300">{{ migration.userMessage }}</p>
                <p class="text-xs text-gray-400 dark:text-gray-500">{{ migration.description }}</p>
              </div>
            </li>
          </ul>
        </div>

        <!-- 错误提示 -->
        <div
          v-if="migrationError"
          class="mb-4 rounded-lg bg-red-50 p-3 text-left text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400"
        >
          <div class="flex flex-col gap-2">
            <div class="flex items-start gap-2">
              <UIcon name="i-heroicons-exclamation-circle" class="mt-0.5 h-4 w-4 shrink-0" />
              <span>{{ migrationError }}</span>
            </div>
            <p class="text-xs text-red-500 dark:text-red-400">
              {{ t('home.migration.errorHint') }}
            </p>
          </div>
        </div>

        <!-- 按钮区域 -->
        <div class="flex gap-3">
          <!-- 有错误时显示关闭按钮 -->
          <UButton v-if="canClose" color="neutral" variant="outline" size="lg" class="flex-1" @click="handleClose">
            {{ t('home.migration.close') }}
          </UButton>

          <!-- 升级/重试按钮 -->
          <UButton
            color="primary"
            size="lg"
            :loading="isMigrating"
            :class="canClose ? 'flex-1' : 'w-full'"
            @click="handleMigration"
          >
            {{
              isMigrating
                ? t('home.migration.upgrading')
                : migrationError
                  ? t('home.migration.retry')
                  : t('home.migration.upgradeNow')
            }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
