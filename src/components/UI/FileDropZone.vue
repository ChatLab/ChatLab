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
  /** 是否为目录选择模式（webkitdirectory） */
  directory?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  multiple: false,
  disabled: false,
  accept: () => ['*'],
  directory: false,
})

const emit = defineEmits<{
  /** 选择文件后触发，返回文件列表和路径列表 */
  files: [payload: { files: File[]; paths: string[] }]
  /** 拖入文件夹时触发 (Electron: dirPath, Web: File[]) */
  'directory-drop': [payload: { files: File[]; dirPath: string | null }]
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
async function handleDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false

  if (props.disabled) return

  const dataTransfer = e.dataTransfer
  if (!dataTransfer) return

  // Check if a directory was dropped (via DataTransferItem API)
  const items = dataTransfer.items
  if (items?.length === 1) {
    const entry = items[0].webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      await handleDirectoryDrop(entry as FileSystemDirectoryEntry, dataTransfer.files)
      return
    }
  }

  if (dataTransfer.files.length === 0) return

  let files = Array.from(dataTransfer.files)

  if (!props.multiple) {
    files = [files[0]]
  }

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

async function handleDirectoryDrop(dirEntry: FileSystemDirectoryEntry, fileList: FileList) {
  // Electron: try to get directory path
  if (fileList.length > 0) {
    try {
      // @ts-expect-error Electron webUtils
      const dirPath = window.electron?.webUtils?.getPathForFile?.(fileList[0])
      if (dirPath) {
        emit('directory-drop', { files: [], dirPath })
        return
      }
    } catch {
      // Not Electron
    }
  }

  // Web: recursively read directory entries into File objects
  const files = await readDirectoryEntries(dirEntry, dirEntry.name)
  if (files.length > 0) {
    emit('directory-drop', { files, dirPath: null })
  }
}

async function readDirectoryEntries(dirEntry: FileSystemDirectoryEntry, basePath: string): Promise<File[]> {
  const reader = dirEntry.createReader()
  const files: File[] = []

  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject))

  let entries: FileSystemEntry[]
  do {
    entries = await readBatch()
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
          ;(entry as FileSystemFileEntry).file(resolve, reject)
        })
        // Attach webkitRelativePath-like info via property
        Object.defineProperty(file, 'webkitRelativePath', {
          value: `${basePath}/${entry.name}`,
          writable: false,
        })
        files.push(file)
      } else if (entry.isDirectory) {
        const subFiles = await readDirectoryEntries(entry as FileSystemDirectoryEntry, `${basePath}/${entry.name}`)
        files.push(...subFiles)
      }
    }
  } while (entries.length > 0)

  return files
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
      :accept="directory ? undefined : acceptAttr"
      class="hidden"
      v-bind="directory ? { webkitdirectory: '', directory: '' } : {}"
      @change="handleFileSelect"
    />

    <!-- 插槽内容 -->
    <slot :is-drag-over="isDragOver" :open-file-dialog="openFileDialog" :disabled="disabled" />
  </div>
</template>
