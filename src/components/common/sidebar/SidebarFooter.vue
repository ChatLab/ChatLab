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
  <div class="py-2 dark:border-gray-800 space-y-2 mb-2" :class="[isCollapsed ? 'px-3' : 'px-4']">
    <!-- 设置 -->
    <SidebarButton
      icon="i-heroicons-cog-6-tooth"
      :title="t('layout.footer.settings')"
      :active="showSettings"
      :tooltip="t('layout.footer.settings')"
      @click="layoutStore.openSettings()"
    />
  </div>
</template>
