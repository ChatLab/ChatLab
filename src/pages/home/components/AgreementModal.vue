<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import MarkdownIt from 'markdown-it'
import { useSettingsStore } from '@/stores/settings'
import { availableLocales, type LocaleType } from '@/i18n'
import agreementZh from '@/assets/docs/agreement_zh.md?raw'
import agreementEn from '@/assets/docs/agreement_en.md?raw'
import agreementZhTw from '@/assets/docs/agreement_zh_tw.md?raw'
import agreementJa from '@/assets/docs/agreement_ja.md?raw'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const { locale } = storeToRefs(settingsStore)

// 语言选项
const languageOptions = computed(() =>
  availableLocales.map((l) => ({
    label: l.nativeName,
    value: l.code,
  }))
)

// 语言切换
const currentLocale = computed({
  get: () => locale.value,
  set: (val: LocaleType) => settingsStore.setLocale(val),
})

// 协议版本号（更新协议时修改此版本号）
const AGREEMENT_VERSION = '1.1'
const AGREEMENT_KEY = 'chatlab_agreement_version'

// 弹窗显示状态（内部管理）
const isOpen = ref(false)
// 是否为版本更新导致的重新阅读
const isVersionUpdated = ref(false)

// 组件挂载时检查是否需要显示
onMounted(() => {
  const acceptedVersion = localStorage.getItem(AGREEMENT_KEY)
  // 版本号不匹配时需要重新同意
  if (acceptedVersion !== AGREEMENT_VERSION) {
    isOpen.value = true
    // 如果之前有同意过旧版本，则是版本更新
    if (acceptedVersion) {
      isVersionUpdated.value = true
    }
  }
})

// 创建 markdown-it 实例
const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
})

// 自定义链接渲染：所有链接在新窗口打开
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, idx, options)
}

const agreementMap: Record<string, string> = {
  'zh-CN': agreementZh,
  'zh-TW': agreementZhTw,
  'en-US': agreementEn,
  'ja-JP': agreementJa,
}

const agreementText = computed(() => {
  return agreementMap[locale.value] ?? agreementEn
})

// 渲染后的 HTML
const renderedContent = computed(() => md.render(agreementText.value))

// 同意协议
function handleAgree() {
  localStorage.setItem(AGREEMENT_KEY, AGREEMENT_VERSION)
  // 标记用户已确认语言设置（无论是否手动切换）
  localStorage.setItem('chatlab_locale_set_by_user', 'true')
  isOpen.value = false
}

// 不同意协议，退出应用
function handleDisagree() {
  // 不同意时清除已存的协议版本
  localStorage.removeItem(AGREEMENT_KEY)
  window.api.send('window-close')
}

// 手动打开弹窗（供外部调用）
function open() {
  isOpen.value = true
}

defineExpose({ open })
</script>

<template>
  <UModal
    :open="isOpen"
    prevent-close
    :ui="{
      content: 'md:w-full max-w-2xl',
      overlay: 'backdrop-blur-sm',
    }"
  >
    <template #content>
      <!-- 弹窗区域禁止拖拽，避免顶部点击被拖拽区域抢占 -->
      <div class="agreement-modal flex max-h-[85vh] flex-col p-6">
        <!-- Header -->
        <div class="mb-4 flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div
              class="flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br from-pink-100 to-rose-100 dark:from-pink-900/30 dark:to-rose-900/30"
            >
              <UIcon name="i-heroicons-document-text" class="h-6 w-6 text-pink-600 dark:text-pink-400" />
            </div>
            <div>
              <h2 class="text-xl font-bold text-gray-900 dark:text-white">{{ t('common.agreement.title') }}</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('common.agreement.subtitle') }}</p>
            </div>
          </div>
          <!-- 语言切换 -->
          <div class="w-36 shrink-0">
            <UTabs v-model="currentLocale" size="sm" class="gap-0" :items="languageOptions" />
          </div>
        </div>

        <!-- 版本更新提示条 -->
        <UAlert
          v-if="isVersionUpdated"
          icon="i-heroicons-exclamation-triangle"
          :title="t('common.agreement.updateNotice')"
          class="mb-4 pt-2"
        />

        <!-- 协议内容滚动区域 -->
        <div class="mb-6 flex-1 overflow-y-auto pr-4">
          <div class="agreement-content" v-html="renderedContent" />
        </div>

        <!-- 底部按钮 -->
        <div class="flex items-center justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <UButton variant="ghost" color="neutral" size="lg" @click="handleDisagree">
            {{ t('common.agreement.disagree') }}
          </UButton>
          <UButton
            color="primary"
            size="lg"
            class="bg-pink-500 hover:bg-pink-600 dark:bg-pink-600 dark:hover:bg-pink-700"
            @click="handleAgree"
          >
            {{ t('common.agreement.agree') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
/* 弹窗内禁用窗口拖拽 */
.agreement-modal {
  -webkit-app-region: no-drag;
}

/* 用户协议 markdown 样式优化 */
.agreement-content {
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--color-gray-600);
}

/* 暗色模式 */
:root.dark .agreement-content {
  color: var(--color-gray-300);
}

/* 标题样式 */
.agreement-content :deep(h2) {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-gray-900);
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid var(--color-gray-200);
}

:root.dark .agreement-content :deep(h2) {
  color: var(--color-gray-100);
  border-bottom-color: var(--color-gray-700);
}

/* 第一个标题不需要上边距 */
.agreement-content :deep(h2:first-child) {
  margin-top: 0;
}

/* 列表样式 */
.agreement-content :deep(ul) {
  margin: 0.5rem 0;
  padding-left: 1.25rem;
  list-style: none;
}

.agreement-content :deep(li) {
  position: relative;
  margin-bottom: 0.375rem;
  padding-left: 0.5rem;
}

.agreement-content :deep(li::before) {
  content: '•';
  position: absolute;
  left: -0.75rem;
  color: var(--color-pink-500);
  font-weight: bold;
}

/* 加粗文字 */
.agreement-content :deep(strong) {
  font-weight: 600;
  color: var(--color-gray-800);
}

:root.dark .agreement-content :deep(strong) {
  color: var(--color-gray-200);
}

/* 段落间距 */
.agreement-content :deep(p) {
  margin: 0.5rem 0;
}

/* 链接样式 */
.agreement-content :deep(a) {
  color: var(--color-pink-500);
  text-decoration: none;
}

.agreement-content :deep(a:hover) {
  text-decoration: underline;
}
</style>
