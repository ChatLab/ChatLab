<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useLayoutStore } from '@/stores/layout'
import SidebarButton from './SidebarButton.vue'

const { t } = useI18n()
const layoutStore = useLayoutStore()
const { showSettings, isSidebarCollapsed: isCollapsed } = storeToRefs(layoutStore)
</script>

<template>
  <div class="mb-2 space-y-2 py-2 dark:border-gray-800" :class="[isCollapsed ? 'px-2' : 'px-4']">
    <!-- 设置 -->
    <SidebarButton
      icon="i-heroicons-cog-6-tooth"
      :title="t('layout.footer.settings')"
      :active="showSettings"
      :tooltip="false"
      @click="layoutStore.openSettings()"
    />
  </div>
</template>
