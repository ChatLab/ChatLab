<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AIModelConfigTab from './AI/AIModelConfigTab.vue'
import AIDefaultModelTab from './AI/AIDefaultModelTab.vue'
import AIPromptConfigTab from './AI/AIPromptConfigTab.vue'
import AIPreprocessTab from './AI/AIPreprocessTab.vue'
import AIExportSettingsTab from './AI/AIExportSettingsTab.vue'
import SessionIndexSection from './AI/SessionIndexSection.vue'
import SemanticIndexSection from './AI/SemanticIndexSection.vue'
import SubTabs from '@/components/UI/SubTabs.vue'
import { useSubTabsScroll } from '@/composables/useSubTabsScroll'

const { t } = useI18n()

// Emits
const emit = defineEmits<{
  'config-changed': []
}>()

// 导航配置
const navItems = computed(() => [
  { id: 'model', label: t('settings.tabs.aiConfig') },
  { id: 'defaultModel', label: t('settings.tabs.aiDefaultModel') },
  { id: 'semanticIndex', label: t('settings.tabs.semanticIndex') },
  { id: 'skill', label: t('settings.tabs.chatPreferences') },
  { id: 'chat', label: t('settings.aiPrompt.chatSettings.title') },
  { id: 'compression', label: t('settings.tabs.compression') },
  { id: 'preprocess', label: t('settings.tabs.aiPreprocess') },
  { id: 'sessionIndex', label: t('settings.tabs.sessionManage') },
  { id: 'export', label: t('settings.aiPrompt.exportSettings.title') },
])

// 使用二级导航滚动联动 composable
const { activeNav, scrollContainerRef, setSectionRef, handleNavChange, scrollToId } = useSubTabsScroll(navItems)
void scrollContainerRef // 在模板中通过 ref="scrollContainerRef" 使用

// AI 配置变更回调
function handleAIConfigChanged() {
  emit('config-changed')
}

/**
 * 滚动到指定 section（供外部调用）
 */
function scrollToSection(sectionId: string) {
  scrollToId(sectionId)
}

// 暴露方法供父组件调用
defineExpose({
  scrollToSection,
})

// Template refs
const aiModelConfigRef = ref<InstanceType<typeof AIModelConfigTab> | null>(null)
void aiModelConfigRef.value
</script>

<template>
  <div class="flex h-full gap-6">
    <!-- 左侧锚点导航 -->
    <div class="w-36 shrink-0">
      <SubTabs v-model="activeNav" :items="navItems" orientation="vertical" @change="handleNavChange" />
    </div>

    <!-- 右侧内容区域 -->
    <div ref="scrollContainerRef" class="min-w-0 flex-1 overflow-y-auto">
      <div class="space-y-8">
        <!-- 模型配置 -->
        <div :ref="(el) => setSectionRef('model', el as HTMLElement)">
          <AIModelConfigTab ref="aiModelConfigRef" @config-changed="handleAIConfigChanged" />
        </div>

        <!-- 默认模型 -->
        <div :ref="(el) => setSectionRef('defaultModel', el as HTMLElement)">
          <AIDefaultModelTab @config-changed="handleAIConfigChanged" />
        </div>

        <!-- 语义索引 -->
        <div :ref="(el) => setSectionRef('semanticIndex', el as HTMLElement)">
          <SemanticIndexSection />
        </div>

        <!-- 工具设置 -->
        <AIPromptConfigTab :set-section-ref="setSectionRef" @config-changed="handleAIConfigChanged" />

        <!-- 预处理配置 -->
        <div :ref="(el) => setSectionRef('preprocess', el as HTMLElement)">
          <AIPreprocessTab />
        </div>

        <!-- 会话索引 -->
        <div :ref="(el) => setSectionRef('sessionIndex', el as HTMLElement)">
          <SessionIndexSection />
        </div>

        <!-- 导出设置 -->
        <div :ref="(el) => setSectionRef('export', el as HTMLElement)">
          <AIExportSettingsTab @config-changed="handleAIConfigChanged" />
        </div>
      </div>
    </div>
  </div>
</template>
