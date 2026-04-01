<script setup lang="ts">
import { ref, onMounted } from 'vue'

// 当前平台
const isMac = ref(false)
const isMaximized = ref(false)

// 检测平台
const isWindows = ref(false)

onMounted(() => {
  isMac.value = navigator.platform.toLowerCase().includes('mac')
  isWindows.value = navigator.platform.toLowerCase().includes('win')

  // 监听窗口状态变化
  window.electron?.ipcRenderer?.on('windowState', (_: unknown, maximized: boolean) => {
    isMaximized.value = maximized
  })
})

// 窗口控制
function minimize() {
  window.electron?.ipcRenderer?.send('window-min')
}

function maximize() {
  window.electron?.ipcRenderer?.send('window-maxOrRestore')
}

function close() {
  window.electron?.ipcRenderer?.send('window-close')
}
</script>

<template>
  <div class="title-bar">
    <!-- 左侧区域 - macOS 给红绿灯预留空间 -->
    <div v-if="isMac" class="traffic-light-spacer" />

    <!-- 中间拖拽区域 - 填充剩余空间 -->
    <div class="drag-region" />

    <!-- Windows: 使用原生窗口按钮（通过 titleBarOverlay），只需预留空间 -->
    <!-- Linux: 使用自定义窗口按钮 -->
    <div v-if="!isMac && !isWindows" class="window-controls">
      <!-- 最小化 -->
      <button class="control-btn" @click="minimize">
        <svg width="10" height="1" viewBox="0 0 10 1">
          <path d="M0 0h10v1H0z" fill="currentColor" />
        </svg>
      </button>

      <!-- 最大化/还原 -->
      <button class="control-btn" @click="maximize">
        <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 0v10h10V0H0zm1 1h8v8H1V1z" fill="currentColor" />
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10">
          <path d="M2 0v2H0v8h8V8h2V0H2zm1 3h5v5H1V3h2z" fill="currentColor" />
        </svg>
      </button>

      <!-- 关闭 -->
      <button class="control-btn control-btn-close" @click="close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path
            d="M1.41 0L0 1.41 3.59 5 0 8.59 1.41 10 5 6.41 8.59 10 10 8.59 6.41 5 10 1.41 8.59 0 5 3.59z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  display: flex;
  align-items: center;
  z-index: 9999;
  -webkit-app-region: drag;
}

/* macOS 红绿灯预留空间 */
.traffic-light-spacer {
  width: 70px;
  height: 100%;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

/* 拖拽区域 - 填充剩余空间 */
.drag-region {
  flex: 1;
  height: 100%;
}

/* Windows 窗口控制按钮容器 */
.window-controls {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}

/* 窗口控制按钮 */
.control-btn {
  width: 46px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--color-gray-600);
  cursor: pointer;
  transition: background-color 0.15s;
}

.control-btn:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

/* 深色模式 */
:global(.dark) .control-btn {
  color: var(--color-gray-400);
}

:global(.dark) .control-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

/* 关闭按钮特殊样式 */
.control-btn-close:hover {
  background-color: #e81123;
  color: white;
}

:global(.dark) .control-btn-close:hover {
  background-color: #e81123;
  color: white;
}
</style>
