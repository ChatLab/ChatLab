<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { SchemaPanel, AIGenerateModal, AIHistoryModal, ResultTable } from './SQLLab'
import type { AIHistory, SQLResult, TableSchema } from './SQLLab'

const { t } = useI18n()

// Props
const props = defineProps<{
  sessionId: string
}>()

// 组件引用
const schemaPanelRef = ref<InstanceType<typeof SchemaPanel> | null>(null)
const resultTableRef = ref<InstanceType<typeof ResultTable> | null>(null)

// 状态
const sql = ref('SELECT * FROM message LIMIT 10')
const isExecuting = ref(false)
const error = ref<string | null>(null)
const result = ref<SQLResult | null>(null)
const lastPrompt = ref('') // 记录最后使用的 AI 提示词

// 弹窗状态
const showAIModal = ref(false)
const showHistoryModal = ref(false)

// AI 历史记录
const aiHistory = ref<AIHistory[]>([])

// 加载历史记录
function loadHistory() {
  try {
    const key = `sql-lab-history-${props.sessionId}`
    const data = localStorage.getItem(key)
    if (data) {
      aiHistory.value = JSON.parse(data)
    }
  } catch (err) {
    console.error('加载历史记录失败:', err)
  }
}

// 保存历史记录
function saveHistory() {
  try {
    const key = `sql-lab-history-${props.sessionId}`
    localStorage.setItem(key, JSON.stringify(aiHistory.value))
  } catch (err) {
    console.error('保存历史记录失败:', err)
  }
}

// 添加到历史记录
function addToHistory(prompt: string, sqlStr: string, explanation: string) {
  const record: AIHistory = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    prompt,
    sql: sqlStr,
    explanation,
    timestamp: Date.now(),
  }
  aiHistory.value.unshift(record)
  if (aiHistory.value.length > 50) {
    aiHistory.value = aiHistory.value.slice(0, 50)
  }
  saveHistory()
}

// 删除历史记录
function deleteHistory(id: string) {
  aiHistory.value = aiHistory.value.filter((r) => r.id !== id)
  saveHistory()
}

// 执行 SQL
async function executeSQL() {
  if (!sql.value.trim()) {
    error.value = t('ai.sqlLab.editor.errorEmptySQL')
    return
  }

  isExecuting.value = true
  error.value = null
  result.value = null
  resultTableRef.value?.resetSort()

  try {
    result.value = await window.chatApi.executeSQL(props.sessionId, sql.value)
  } catch (err: any) {
    error.value = err.message || String(err)
  } finally {
    isExecuting.value = false
  }
}

// 处理快捷键
function handleKeyDown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    executeSQL()
  }
}

// 处理列名插入
function handleInsertColumn(tableName: string, columnName: string) {
  sql.value += `${tableName}.${columnName}`
}

// 处理 AI 生成成功
function handleAIGenerated(generatedSql: string, explanation: string, prompt: string) {
  addToHistory(prompt, generatedSql, explanation)
  lastPrompt.value = prompt // 记录提示词
}

// 处理使用 SQL
function handleUseSQL(generatedSql: string) {
  sql.value = generatedSql
}

// 处理运行 SQL
async function handleRunSQL(generatedSql: string) {
  sql.value = generatedSql
  await executeSQL()
}

// 从历史记录执行
async function executeFromHistory(record: AIHistory) {
  sql.value = record.sql
  lastPrompt.value = record.prompt // 记录历史的提示词
  showHistoryModal.value = false
  await executeSQL()
}

// 获取 schema
const schema = ref<TableSchema[]>([])

// 监听 schema 加载完成
function onSchemaLoaded() {
  if (schemaPanelRef.value) {
    schema.value = schemaPanelRef.value.schema
  }
}

onMounted(() => {
  loadHistory()
  // 延迟获取 schema
  setTimeout(onSchemaLoaded, 500)
})
</script>

<template>
  <div class="main-content flex h-full">
    <!-- Schema 面板 -->
    <SchemaPanel ref="schemaPanelRef" :session-id="sessionId" @insert-column="handleInsertColumn" />

    <!-- 主内容区 -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <!-- SQL 编辑器区域 -->
      <div class="flex flex-col border-b border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
        <div class="mx-auto w-full max-w-3xl">
          <!-- 编辑器 -->
          <textarea
            v-model="sql"
            class="h-32 w-full resize-none rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm text-gray-800 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            :placeholder="t('ai.sqlLab.editor.placeholder')"
            spellcheck="false"
            @keydown="handleKeyDown"
          />

          <!-- 工具栏 -->
          <div class="mt-3 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-400">{{ t('ai.sqlLab.editor.tip') }}</span>
            </div>
            <div class="flex items-center gap-2">
              <UButton variant="ghost" size="sm" :disabled="aiHistory.length === 0" @click="showHistoryModal = true">
                <UIcon name="i-heroicons-clock" class="mr-1 h-4 w-4" />
                {{ t('ai.sqlLab.editor.history') }}
                <span v-if="aiHistory.length > 0" class="ml-1 text-xs text-gray-400">({{ aiHistory.length }})</span>
              </UButton>
              <UButton variant="outline" size="sm" @click="showAIModal = true">
                <UIcon name="i-heroicons-sparkles" class="mr-1 h-4 w-4" />
                {{ t('ai.sqlLab.editor.aiGenerate') }}
              </UButton>
              <span class="text-xs text-gray-400">{{ t('ai.sqlLab.editor.shortcut') }}</span>
              <UButton color="primary" size="sm" :loading="isExecuting" @click="executeSQL">
                <UIcon name="i-heroicons-play" class="mr-1 h-4 w-4" />
                {{ t('ai.sqlLab.editor.run') }}
              </UButton>
            </div>
          </div>
        </div>
      </div>

      <!-- 结果区域 -->
      <ResultTable ref="resultTableRef" :result="result" :error="error" :sql="sql" :prompt="lastPrompt" />
    </div>

    <!-- AI 生成弹窗 -->
    <AIGenerateModal
      v-model:open="showAIModal"
      :schema="schemaPanelRef?.schema || []"
      @generated="handleAIGenerated"
      @use-s-q-l="handleUseSQL"
      @run-s-q-l="handleRunSQL"
    />

    <!-- 历史记录弹窗 -->
    <AIHistoryModal
      v-model:open="showHistoryModal"
      :history="aiHistory"
      @execute="executeFromHistory"
      @delete="deleteHistory"
    />
  </div>
</template>
