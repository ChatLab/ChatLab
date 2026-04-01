<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AgreementModal from './components/AgreementModal.vue'
import MigrationModal from './components/MigrationModal.vue'
import ImportArea from './components/ImportArea.vue'
import ChangelogModal from './components/ChangelogModal.vue'
import HomeFooter from './components/HomeFooter.vue'

const { t } = useI18n()

// 弹窗引用
const changelogModalRef = ref<InstanceType<typeof ChangelogModal> | null>(null)
const agreementModalRef = ref<InstanceType<typeof AgreementModal> | null>(null)

// 打开版本日志弹窗（手动点击时调用）
async function openChangelog() {
  changelogModalRef.value?.open()
}

// 打开使用条款弹窗
function openTerms() {
  agreementModalRef.value?.open()
}

const features = computed(() => [
  {
    title: t('home.features.privacy.title'),
    color: 'text-pink-500',
  },
  {
    title: t('home.features.analysis.title'),
    color: 'text-pink-500',
  },
  {
    title: t('home.features.ai.title'),
    color: 'text-pink-500',
  },
])
</script>

<template>
  <div class="relative flex h-full w-full overflow-hidden pt-4">
    <!-- Content Container -->
    <div class="relative h-full w-full overflow-y-auto">
      <div class="flex min-h-full w-full flex-col items-center justify-center px-4 py-12">
        <!-- Hero Section -->
        <div class="relative xl:mb-6 mb-4 w-full text-center">
          <!-- 标题上方可拖拽区域，向上扩展覆盖空隙 -->
          <div class="absolute -top-32 left-0 right-0 h-32" style="-webkit-app-region: drag" />
          <!-- Title -->
          <h1 class="mb-4 select-none text-5xl sm:text-5xl lg:text-6xl font-black tracking-tight text-pink-500">
            {{ t('home.title') }}
          </h1>
          <!-- Description -->
          <div class="relative select-none inline-block mb-8">
            <p class="text-lg sm:text-5xl text-gray-700 dark:text-gray-400 font-medium">{{ t('home.subtitle') }}</p>
          </div>
        </div>

        <!-- Feature Text -->
        <div class="xl:mb-16 mb-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 px-4">
          <template v-for="feature in features" :key="feature.title">
            <div class="group flex items-center gap-2 cursor-default">
              <UIcon
                name="i-heroicons-check-circle"
                class="h-5 w-5 transition-all duration-500 group-hover:scale-110 group-hover:drop-shadow-md"
                :class="feature.color"
              />
              <span
                class="text-sm sm:text-base font-medium tracking-tight text-gray-600 dark:text-gray-300 transition-colors duration-300 group-hover:text-gray-900 dark:group-hover:text-white"
              >
                {{ feature.title }}
              </span>
            </div>
          </template>
        </div>

        <!-- Import Area -->
        <ImportArea />
      </div>

      <!-- Footer - 固定在底部 -->
      <HomeFooter @open-changelog="openChangelog" @open-terms="openTerms" />
    </div>

    <!-- 用户协议弹窗 -->
    <AgreementModal ref="agreementModalRef" />

    <!-- 数据库迁移弹窗 -->
    <MigrationModal />

    <!-- 版本日志弹窗 -->
    <ChangelogModal ref="changelogModalRef" />
  </div>
</template>
