<script setup lang="ts">
/**
 * 数据和存储设置 Tab
 * 包含存储管理和会话管理两个子 Tab
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import StorageManageSection from './DataStorage/StorageManageSection.vue'
import SessionIndexSection from './DataStorage/SessionIndexSection.vue'
import SubTabs from '@/components/UI/SubTabs.vue'
import { useSubTabsScroll } from '@/composables/useSubTabsScroll'

const { t } = useI18n()

// 导航配置
const navItems = computed(() => [
  { id: 'storage', label: t('settings.tabs.storageManage') },
  { id: 'session', label: t('settings.tabs.sessionManage') },
])

// 使用二级导航滚动联动 composable
const { activeNav, scrollContainerRef, setSectionRef, handleNavChange } = useSubTabsScroll(navItems)
void scrollContainerRef // 在模板中通过 ref="scrollContainerRef" 使用

// Template refs
const storageManageRef = ref<InstanceType<typeof StorageManageSection> | null>(null)

// 暴露刷新方法
defineExpose({
  refresh: () => storageManageRef.value?.refresh(),
})
</script>

<template>
  <div class="flex h-full gap-6">
    <!-- 左侧锚点导航 -->
    <div class="w-28 shrink-0">
      <SubTabs v-model="activeNav" :items="navItems" orientation="vertical" @change="handleNavChange" />
    </div>

    <!-- 右侧内容区域 -->
    <div ref="scrollContainerRef" class="min-w-0 flex-1 overflow-y-auto">
      <div class="space-y-8">
        <!-- 存储管理 -->
        <div :ref="(el) => setSectionRef('storage', el as HTMLElement)">
          <StorageManageSection ref="storageManageRef" />
        </div>

        <!-- 分隔线 -->
        <div class="border-t border-gray-200 dark:border-gray-700" />

        <!-- 会话管理 -->
        <div :ref="(el) => setSectionRef('session', el as HTMLElement)">
          <SessionIndexSection />
        </div>
      </div>
    </div>
  </div>
</template>
