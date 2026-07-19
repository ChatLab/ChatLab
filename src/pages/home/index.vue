<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '@/stores/session'
import { getChatlabSiteLocalePath } from '@/utils/chatlabSiteLocale'
import logoSvg from '@/assets/images/logo.svg'
import LanguageSelectModal from '@/components/home/LanguageSelectModal.vue'
import AgreementModal from '@/components/home/AgreementModal.vue'
import MigrationModal from './components/MigrationModal.vue'
import ImportArea from '@/components/import/ImportArea.vue'
import ImportTabSelector from './components/import/ImportTabSelector.vue'
import ApiImportCard from './components/import/ApiImportCard.vue'
import CliImportCard from './components/import/CliImportCard.vue'
import ChangelogModal from '@/components/home/ChangelogModal.vue'
import HomeFooter from '@/components/home/HomeFooter.vue'
import DemoImportButton from './components/DemoImportButton.vue'

const { t, locale } = useI18n()
const sessionStore = useSessionStore()

// 导入方式选中的 Tab 状态
const activeTab = ref<'file' | 'api' | 'cli'>('file')

// 首页入场动效：挂载后通过 requestAnimationFrame 触发，确保初始透明态已完成渲染
const isMounted = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    isMounted.value = true
  })
})

// 弹窗引用
const changelogModalRef = ref<InstanceType<typeof ChangelogModal> | null>(null)
const agreementModalRef = ref<InstanceType<typeof AgreementModal> | null>(null)

// 语言选择完成后，检查是否需要显示协议弹窗
function onLanguageSelectDone() {
  if (agreementModalRef.value?.needsAgreement()) {
    agreementModalRef.value.open()
  }
}

// 打开版本日志弹窗（手动点击时调用）
async function openChangelog() {
  changelogModalRef.value?.open()
}

// 打开使用条款弹窗
function openTerms() {
  agreementModalRef.value?.open()
}

// 三个导入 Tab 共用的底部入口按钮
const showDemoButton = computed(() => sessionStore.sessions.length === 0)

const tutorialExportUrl = computed(() => {
  const localePath = getChatlabSiteLocalePath(locale.value)
  const langPath = localePath === 'cn' || localePath === 'tw' ? `/${localePath}/` : '/'
  return `https://docs.chatlab.fun${langPath}`
})
</script>

<template>
  <div class="relative flex h-full w-full overflow-hidden pt-4">
    <!-- 顶部窗口拖拽区域，固定 50px，覆盖应用最上方 -->
    <div class="absolute left-0 right-0 top-0 z-10 h-[50px]" style="-webkit-app-region: drag" />
    <!-- Content Container -->
    <div class="relative h-full w-full overflow-y-auto">
      <div class="flex min-h-full w-full flex-col items-center justify-center px-4 py-12">
        <!-- Hero Section -->
        <div
          class="relative xl:mb-6 mb-4 flex items-center justify-center gap-4 select-none transition-all duration-700 ease-out"
          :class="isMounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'"
        >
          <img :src="logoSvg" alt="ChatLab" class="h-10 w-10 select-none pointer-events-none" />
          <h1 class="text-3xl font-bold tracking-tight text-gray-900 dark:text-white leading-none">
            {{ t('home.tagline') }}
          </h1>
        </div>

        <!-- 导入方式切换栏 -->
        <div
          class="mb-6 transition-all duration-700 ease-out delay-100"
          :class="isMounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'"
        >
          <ImportTabSelector v-model="activeTab" />
        </div>

        <!-- 内容区域：根据 Tab 条件渲染，整体包裹在入场动效容器中 -->
        <div
          class="w-full transition-all duration-700 ease-out delay-200"
          :class="isMounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'"
        >
          <!-- 文件导入区域 -->
          <ImportArea v-if="activeTab === 'file'" :backend-features="true" />

          <!-- API 导入区域：统一承载自动拉取与 API 推送 -->
          <ApiImportCard v-else-if="activeTab === 'api'" />

          <!-- CLI 导入区域：Agent Skill 与手动 CLI -->
          <CliImportCard v-else-if="activeTab === 'cli'" />
        </div>

        <div
          class="mt-6 flex items-center gap-3 transition-all duration-700 ease-out delay-300"
          :class="isMounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'"
        >
          <DemoImportButton v-if="showDemoButton" />
          <UButton :href="tutorialExportUrl" target="_blank" trailing-icon="i-heroicons-chevron-right-20-solid">
            {{ t('home.quickStart.export') }}
          </UButton>
        </div>
      </div>

      <!-- Footer - 固定在底部 -->
      <HomeFooter :remote-config-enabled="true" @open-changelog="openChangelog" @open-terms="openTerms" />
    </div>

    <!-- 新用户语言选择弹窗 -->
    <LanguageSelectModal @done="onLanguageSelectDone" />

    <!-- 用户协议弹窗 -->
    <AgreementModal ref="agreementModalRef" />

    <!-- 数据库迁移弹窗 -->
    <MigrationModal />

    <!-- 版本日志弹窗 -->
    <ChangelogModal ref="changelogModalRef" />
  </div>
</template>
