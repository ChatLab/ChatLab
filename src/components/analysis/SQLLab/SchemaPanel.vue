<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TableSchema } from './types'
import { getTableLabel, getColumnLabel } from './types'
import type { LocaleType } from '@/i18n/types'

const { t, locale } = useI18n()

// Props
const props = defineProps<{
  sessionId: string
}>()

// Emits
const emit = defineEmits<{
  insertColumn: [tableName: string, columnName: string]
}>()

// 状态
const isCollapsed = ref(false)
const schema = ref<TableSchema[]>([])
const expandedTables = ref<Set<string>>(new Set())

// 加载 Schema
async function loadSchema() {
  try {
    schema.value = await window.chatApi.getSchema(props.sessionId)
    // 默认展开所有表
    schema.value.forEach((table) => expandedTables.value.add(table.name))
  } catch (err) {
    console.error('加载 Schema 失败:', err)
  }
}

// 切换表展开状态
function toggleTable(tableName: string) {
  if (expandedTables.value.has(tableName)) {
    expandedTables.value.delete(tableName)
  } else {
    expandedTables.value.add(tableName)
  }
}

// 展开表（从折叠状态点击时使用）
function expandTable(tableName: string) {
  isCollapsed.value = false
  expandedTables.value.add(tableName)
}

// 处理双击插入列名
function handleInsertColumn(tableName: string, columnName: string) {
  emit('insertColumn', tableName, columnName)
}

// 暴露方法供父组件调用
defineExpose({
  loadSchema,
  schema,
})

onMounted(() => {
  loadSchema()
})
</script>

<template>
  <div
    class="flex flex-col border-r border-gray-200 bg-white transition-all dark:border-gray-800 dark:bg-gray-900"
    :class="isCollapsed ? 'w-10' : 'w-56'"
  >
    <!-- 面板头部 -->
    <div class="flex items-center justify-between border-b border-gray-200 p-2 dark:border-gray-800">
      <span v-if="!isCollapsed" class="text-xs font-medium text-gray-500 dark:text-gray-400">
        {{ t('ai.sqlLab.schema.tables') }}
      </span>
      <button
        class="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        @click="isCollapsed = !isCollapsed"
      >
        <UIcon :name="isCollapsed ? 'i-heroicons-chevron-right' : 'i-heroicons-chevron-left'" class="h-4 w-4" />
      </button>
    </div>

    <!-- Schema 列表 -->
    <div v-if="!isCollapsed" class="flex-1 overflow-y-auto p-2">
      <div v-for="table in schema" :key="table.name" class="mb-2">
        <!-- 表名 -->
        <button
          class="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          @click="toggleTable(table.name)"
        >
          <UIcon
            :name="expandedTables.has(table.name) ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
            class="h-3 w-3 shrink-0 text-gray-400"
          />
          <UIcon name="i-heroicons-table-cells" class="h-4 w-4 shrink-0 text-pink-500" />
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ table.name }}</span>
          <span class="flex-1 truncate text-right text-xs text-gray-400">
            {{ getTableLabel(table.name, locale as LocaleType) }}
          </span>
        </button>

        <!-- 列列表 -->
        <div v-if="expandedTables.has(table.name)" class="ml-4 mt-1 space-y-0.5">
          <button
            v-for="column in table.columns"
            :key="column.name"
            class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            :title="t('ai.sqlLab.schema.doubleClickToInsert')"
            @dblclick="handleInsertColumn(table.name, column.name)"
          >
            <UIcon
              v-if="column.pk"
              name="i-heroicons-key"
              class="h-3 w-3 shrink-0 text-yellow-500"
              :title="t('ai.sqlLab.schema.primaryKey')"
            />
            <span class="font-mono text-gray-700 dark:text-gray-300">{{ column.name }}</span>
            <span class="flex-1 truncate text-right text-[10px] text-gray-400">
              {{ getColumnLabel(table.name, column.name, locale as LocaleType) }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- 折叠时显示图标列表 -->
    <div v-else class="flex flex-1 flex-col items-center gap-2 overflow-y-auto py-2">
      <button
        v-for="table in schema"
        :key="table.name"
        class="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-pink-500 dark:hover:bg-gray-800"
        :title="`${getTableLabel(table.name, locale as LocaleType)} (${table.name})`"
        @click="expandTable(table.name)"
      >
        <UIcon name="i-heroicons-table-cells" class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
