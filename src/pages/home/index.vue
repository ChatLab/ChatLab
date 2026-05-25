<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import { getChatlabSiteLocalePath } from '@/utils/chatlabSiteLocale'
import { useDataService, useImportService, useSessionIndexService } from '@/services'
import { getSessionGapThreshold } from '@/composables/useUiConfig'
import logoSvg from '@/assets/images/logo.svg'
import LanguageSelectModal from './components/LanguageSelectModal.vue'
import AgreementModal from './components/AgreementModal.vue'
import MigrationModal from './components/MigrationModal.vue'
import ImportArea from './components/import/ImportArea.vue'
import ImportTabSelector from './components/import/ImportTabSelector.vue'
import AutoSyncCard from './components/import/AutoSyncCard.vue'
import ApiImportCard from './components/import/ApiImportCard.vue'
import ChangelogModal from './components/ChangelogModal.vue'
import HomeFooter from './components/HomeFooter.vue'

const { t, locale } = useI18n()
const router = useRouter()
const sessionStore = useSessionStore()
const settingsStore = useSettingsStore()

// 导入方式选中的 Tab 状态
const activeTab = ref<'file' | 'api' | 'push'>('file')

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

// 是否展示 Demo 按钮（仅无任何会话时）
const showDemoButton = computed(() => sessionStore.sessions.length === 0)

// Demo 导入状态
const isDemoImporting = ref(false)
const demoStage = ref<'downloading' | 'importing'>('downloading')
const demoError = ref<string | null>(null)

async function navigateToSession(sessionId: string) {
  const session = await useDataService().getSession(sessionId)
  if (session) {
    const routeName = session.type === 'private' ? 'private-chat' : 'group-chat'
    router.push({ name: routeName, params: { id: sessionId } })
  }
}

async function handleDemoImport() {
  isDemoImporting.value = true
  demoError.value = null
  demoStage.value = 'downloading'

  try {
    const demoLocale = getChatlabSiteLocalePath(settingsStore.locale) || 'en'
    const result = await useImportService().importDemo(demoLocale, (progress) => {
      demoStage.value = progress.stage as 'downloading' | 'importing'
    })

    if (result.success && result.groupSessionId) {
      await sessionStore.loadSessions()
      sessionStore.selectSession(result.groupSessionId)

      try {
        const gapThreshold = getSessionGapThreshold()
        const sessionIndexService = useSessionIndexService()
        await sessionIndexService.generate(result.groupSessionId, gapThreshold)
        if (result.privateSessionId) {
          await sessionIndexService.generate(result.privateSessionId, gapThreshold)
        }
      } catch (e) {
        console.error('自动生成会话索引失败:', e)
      }

      await navigateToSession(result.groupSessionId)
    } else {
      demoError.value = result.error || t('home.demo.failed')
    }
  } catch (e) {
    demoError.value = String(e)
  } finally {
    isDemoImporting.value = false
  }
}

// 教程链接 URL
const tutorialExportUrl = computed(() => {
  const localePath = getChatlabSiteLocalePath(locale.value)
  const langPath = localePath ? `/${localePath}` : ''
  return `https://chatlab.fun${langPath}/usage/how-to-export?utm_source=app`
})

// 教程列表项
const tutorialItems = computed(() => {
  const items = [
    {
      key: 'export',
      icon: 'i-heroicons-arrow-up-tray',
      label: t('home.quickStart.export'),
      url: tutorialExportUrl.value,
      external: true,
    },
  ]
  return items
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
          <ImportArea v-if="activeTab === 'file'" />

          <!-- 自动同步区域 -->
          <AutoSyncCard v-else-if="activeTab === 'api'" />

          <!-- API 导入区域 -->
          <ApiImportCard v-else-if="activeTab === 'push'" />
        </div>

        <!-- Quick Start List -->
        <div
          class="mt-6 flex flex-col items-center gap-3 transition-all duration-700 ease-out delay-300"
          :class="isMounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'"
        >
          <template v-for="item in tutorialItems" :key="item.key">
            <a
              :href="item.url"
              :target="item.external ? '_blank' : undefined"
              class="group flex items-center gap-2 text-sm text-gray-500 hover:text-pink-500 transition-colors dark:text-gray-400 dark:hover:text-pink-400"
            >
              <UIcon :name="item.icon" class="h-4 w-4" />
              <span>{{ item.label }}</span>
              <UIcon
                v-if="item.external"
                name="i-heroicons-arrow-top-right-on-square"
                class="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100"
              />
            </a>
          </template>

          <!-- Demo Import (only when no sessions) -->
          <template v-if="showDemoButton">
            <button
              class="group flex items-center gap-2 text-sm text-gray-500 hover:text-pink-500 transition-colors dark:text-gray-400 dark:hover:text-pink-400"
              :disabled="isDemoImporting"
              @click="handleDemoImport"
            >
              <UIcon v-if="isDemoImporting" name="i-heroicons-arrow-path" class="h-4 w-4 animate-spin" />
              <UIcon v-else name="i-heroicons-play-circle" class="h-4 w-4" />
              <span>
                {{
                  isDemoImporting
                    ? demoStage === 'downloading'
                      ? t('home.demo.downloading')
                      : t('home.demo.importing')
                    : t('home.demo.viewExample')
                }}
              </span>
            </button>
            <p v-if="demoError" class="text-xs text-red-500 dark:text-red-400">{{ demoError }}</p>
          </template>
        </div>
      </div>

      <!-- Footer - 固定在底部 -->
      <HomeFooter @open-changelog="openChangelog" @open-terms="openTerms" />
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
