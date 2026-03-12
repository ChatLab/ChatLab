<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AIModelConfigTab from './AI/AIModelConfigTab.vue'
import AIPromptConfigTab from './AI/AIPromptConfigTab.vue'
import AIPromptPresetTab from './AI/AIPromptPresetTab.vue'
import AIPreprocessTab from './AI/AIPreprocessTab.vue'
// TODO: 向量模型暂时隐藏，待功能完善后恢复
// import RAGConfigTab from './AI/RAGConfigTab.vue'
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
  // TODO: 向量模型暂时隐藏，待功能完善后恢复
  // { id: 'rag', label: t('settings.tabs.aiRAG') },
  { id: 'chat', label: t('settings.tabs.aiPrompt') },
  { id: 'preprocess', label: t('settings.tabs.aiPreprocess') },
  { id: 'preset', label: t('settings.tabs.aiPreset') },
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
    <div class="w-28 shrink-0">
      <SubTabs v-model="activeNav" :items="navItems" orientation="vertical" @change="handleNavChange" />
    </div>

    <!-- 右侧内容区域 -->
    <div ref="scrollContainerRef" class="min-w-0 flex-1 overflow-y-auto">
      <div class="space-y-8">
        <!-- 模型配置 -->
        <div :ref="(el) => setSectionRef('model', el as HTMLElement)">
          <AIModelConfigTab ref="aiModelConfigRef" @config-changed="handleAIConfigChanged" />
        </div>

        <!-- TODO: 向量模型暂时隐藏，待功能完善后恢复 -->
        <!--
        <div class="border-t border-gray-200 dark:border-gray-700" />
        <div :ref="(el) => setSectionRef('rag', el as HTMLElement)">
          <RAGConfigTab @config-changed="handleAIConfigChanged" />
        </div>
        -->

        <!-- 分隔线 -->
        <div class="border-t border-gray-200 dark:border-gray-700" />

        <!-- 对话配置 -->
        <div :ref="(el) => setSectionRef('chat', el as HTMLElement)">
          <AIPromptConfigTab @config-changed="handleAIConfigChanged" />
        </div>

        <!-- 分隔线 -->
        <div class="border-t border-gray-200 dark:border-gray-700" />

        <!-- 预处理配置 -->
        <div :ref="(el) => setSectionRef('preprocess', el as HTMLElement)">
          <AIPreprocessTab />
        </div>

        <!-- 分隔线 -->
        <div class="border-t border-gray-200 dark:border-gray-700" />

        <!-- 提示词配置 -->
        <div :ref="(el) => setSectionRef('preset', el as HTMLElement)">
          <AIPromptPresetTab @config-changed="handleAIConfigChanged" />
        </div>
      </div>
    </div>
  </div>
</template>
