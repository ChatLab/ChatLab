<script setup lang="ts">
/**
 * FileDropZone - 纯行为的文件拖拽/选择组件
 * 不提供默认样式，通过插槽完全自定义 UI
 */

import { ref, computed } from 'vue'

interface Props {
  /** 是否支持多文件选择 */
  multiple?: boolean
  /** 是否禁用 */
  disabled?: boolean
  /** 接受的文件扩展名，如 ['.json', '.txt'] */
  accept?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  multiple: false,
  disabled: false,
  accept: () => ['*'],
})

const emit = defineEmits<{
  /** 选择文件后触发，返回文件列表和路径列表 */
  files: [payload: { files: File[]; paths: string[] }]
}>()

// 拖拽状态
const isDragOver = ref(false)

// 隐藏的文件输入框引用
const fileInputRef = ref<HTMLInputElement | null>(null)

// 计算 accept 属性值
const acceptAttr = computed(() => {
  if (props.accept.includes('*')) return '*'
  return props.accept.join(',')
})

// 打开文件选择对话框
function openFileDialog() {
  if (props.disabled) return
  fileInputRef.value?.click()
}

// 处理文件选择
function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return

  processFiles(Array.from(input.files))

  // 清空 input 以便再次选择同一文件
  input.value = ''
}

// 处理拖拽进入
function handleDragEnter(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (props.disabled) return
  isDragOver.value = true
}

// 处理拖拽悬停
function handleDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (props.disabled) return
  isDragOver.value = true
}

// 处理拖拽离开
function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false
}

// 处理拖拽放下
function handleDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false

  if (props.disabled) return

  const dataTransfer = e.dataTransfer
  if (!dataTransfer?.files || dataTransfer.files.length === 0) return

  let files = Array.from(dataTransfer.files)

  // 如果不支持多选，只取第一个
  if (!props.multiple) {
    files = [files[0]]
  }

  // 过滤文件类型
  if (!props.accept.includes('*')) {
    files = files.filter((file) => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase()
      return props.accept.some((a) => a.toLowerCase() === ext)
    })
  }

  if (files.length > 0) {
    processFiles(files)
  }
}

// 处理文件并发送事件
function processFiles(files: File[]) {
  const paths: string[] = []

  // 尝试获取文件路径（Electron 环境）
  for (const file of files) {
    try {
      // @ts-ignore - Electron webUtils
      const path = window.electron?.webUtils?.getPathForFile?.(file)
      if (path) {
        paths.push(path)
      }
    } catch {
      // 非 Electron 环境或获取失败
    }
  }

  emit('files', { files, paths })
}

// 暴露给插槽的属性
defineExpose({
  openFileDialog,
})
</script>

<template>
  <div @dragenter="handleDragEnter" @dragover="handleDragOver" @dragleave="handleDragLeave" @drop="handleDrop">
    <!-- 隐藏的文件输入框 -->
    <input
      ref="fileInputRef"
      type="file"
      :multiple="multiple"
      :accept="acceptAttr"
      class="hidden"
      @change="handleFileSelect"
    />

    <!-- 插槽内容 -->
    <slot :is-drag-over="isDragOver" :open-file-dialog="openFileDialog" :disabled="disabled" />
  </div>
</template>
