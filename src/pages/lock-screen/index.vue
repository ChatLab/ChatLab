<script setup lang="ts">
/**
 * 锁屏页面 - 路由入口
 *
 * 由主进程在独立的 BrowserWindow 中加载（hash: /lock-screen）。
 * 该页面渲染 LockScreen 组件，负责处理用户解锁交互。
 */
import LockScreen from '@/components/lock-screen/LockScreen.vue'
</script>

<template>
  <LockScreen />
</template>
