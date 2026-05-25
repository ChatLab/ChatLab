<script setup lang="ts">
import { ref } from 'vue'
import StorageManageSection from './DataStorage/StorageManageSection.vue'

// Template refs
const storageManageRef = ref<InstanceType<typeof StorageManageSection> | null>(null)

// 暴露刷新方法
defineExpose({
  refresh: () => storageManageRef.value?.refresh(),
})
</script>

<template>
  <div class="h-full overflow-y-auto">
    <StorageManageSection ref="storageManageRef" />
  </div>
</template>
