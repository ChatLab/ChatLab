<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TableSchema, SQLResult } from '@/components/analysis/SQLLab'
import { getColumnLabel } from '@/components/analysis/SQLLab'
import type { LocaleType } from '@/i18n/types'
import { UITabs } from '@/components/UI'

const PRIORITY_TABLES = ['member', 'meta', 'message', 'message_context', 'member_name_history']

const { t, locale } = useI18n()

const props = defineProps<{
  sessionId: string
}>()

type DbSource = 'chat' | 'ai'

const dbSource = ref<DbSource>((localStorage.getItem('debug_dbSource') as DbSource) || 'chat')
const schema = ref<TableSchema[]>([])
const selectedTable = ref('')
const result = ref<SQLResult | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)

const pageSize = 100
const currentPage = ref(1)
const totalRows = ref(0)

const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize)))

const editingRowIndex = ref<number | null>(null)
const editingValues = ref<Record<string, string>>({})
const isClearingDebug = ref(false)

const isAiDb = computed(() => dbSource.value === 'ai')

const conversations = ref<Array<{ id: string; title: string | null }>>([])
const selectedConversation = ref('')
const showConversationFilter = computed(
  () => isAiDb.value && selectedTable.value === 'ai_message' && conversations.value.length > 0
)
const conversationItems = computed(() => {
  const all = { label: t('analysis.debug.tableBrowser.allConversations'), value: '__all__' }
  const items = conversations.value.map((c) => ({
    label: c.title || c.id.slice(0, 16),
    value: c.id,
  }))
  return [all, ...items]
})

async function loadConversations() {
  if (!isAiDb.value) {
    conversations.value = []
    return
  }
  try {
    const escapedId = props.sessionId.replace(/'/g, "''")
    const res = await window.aiApi.executeAiSQL(
      `SELECT id, title FROM ai_conversation WHERE session_id = '${escapedId}' ORDER BY updated_at DESC`
    )
    conversations.value = res.rows.map((r) => ({ id: String(r[0]), title: r[1] ? String(r[1]) : null }))
    selectedConversation.value = '__all__'
  } catch {
    conversations.value = []
  }
}

const dbTabs = computed(() => [
  { label: t('analysis.debug.tableBrowser.chatDb'), value: 'chat' as DbSource },
  { label: t('analysis.debug.tableBrowser.aiDb'), value: 'ai' as DbSource },
])

const sortedSchema = computed(() => {
  const sorted = [...schema.value]
  sorted.sort((a, b) => {
    const ai = PRIORITY_TABLES.indexOf(a.name)
    const bi = PRIORITY_TABLES.indexOf(b.name)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return 0
  })
  return sorted
})

const tableItems = computed(() =>
  sortedSchema.value.map((s) => ({
    label: s.name,
    value: s.name,
  }))
)

async function runSQL(sql: string): Promise<SQLResult> {
  if (dbSource.value === 'ai') {
    return await window.aiApi.executeAiSQL(sql)
  }
  return await window.chatApi.executeSQL(props.sessionId, sql)
}

async function loadSchema() {
  try {
    if (dbSource.value === 'ai') {
      schema.value = await window.aiApi.getAiSchema()
    } else {
      schema.value = await window.chatApi.getSchema(props.sessionId)
    }
    if (sortedSchema.value.length > 0) {
      const defaultTable = isAiDb.value ? 'ai_message' : sortedSchema.value[0].name
      selectedTable.value = sortedSchema.value.some((s) => s.name === defaultTable)
        ? defaultTable
        : sortedSchema.value[0].name
    } else {
      selectedTable.value = ''
      result.value = null
    }
  } catch (e) {
    console.error('Failed to load schema:', e)
  }
}

function getSessionWhereClause(): string {
  if (!isAiDb.value) return ''
  const escapedId = props.sessionId.replace(/'/g, "''")
  const table = selectedTable.value
  if (table === 'ai_conversation') {
    return ` WHERE "session_id" = '${escapedId}'`
  }
  if (table === 'ai_message') {
    if (selectedConversation.value && selectedConversation.value !== '__all__') {
      const escapedConvId = selectedConversation.value.replace(/'/g, "''")
      return ` WHERE "conversation_id" = '${escapedConvId}'`
    }
    return ` WHERE "conversation_id" IN (SELECT "id" FROM "ai_conversation" WHERE "session_id" = '${escapedId}')`
  }
  return ''
}

async function loadTableData() {
  if (!selectedTable.value) return
  isLoading.value = true
  error.value = null
  editingRowIndex.value = null

  try {
    const where = getSessionWhereClause()
    const countResult = await runSQL(`SELECT COUNT(*) as cnt FROM "${selectedTable.value}"${where}`)
    totalRows.value = countResult?.rows?.[0]?.[0] ?? 0

    const offset = (currentPage.value - 1) * pageSize
    result.value = await runSQL(
      `SELECT * FROM "${selectedTable.value}"${where} ORDER BY rowid DESC LIMIT ${pageSize} OFFSET ${offset}`
    )
  } catch (e: any) {
    error.value = e.message || String(e)
    result.value = null
  } finally {
    isLoading.value = false
  }
}

function startEdit(rowIndex: number) {
  if (!result.value) return
  editingRowIndex.value = rowIndex
  const row = result.value.rows[rowIndex]
  const values: Record<string, string> = {}
  result.value.columns.forEach((col, i) => {
    values[col] = row[i] == null ? '' : String(row[i])
  })
  editingValues.value = values
}

function cancelEdit() {
  editingRowIndex.value = null
  editingValues.value = {}
}

async function saveEdit() {
  if (editingRowIndex.value === null || !result.value) return

  const table = selectedTable.value
  const tableSchema = schema.value.find((s) => s.name === table)
  if (!tableSchema) return

  const pkCol = tableSchema.columns.find((c) => c.pk)
  if (!pkCol) {
    error.value = 'No primary key found for this table'
    return
  }

  const row = result.value.rows[editingRowIndex.value]
  const pkIndex = result.value.columns.indexOf(pkCol.name)
  const pkValue = row[pkIndex]

  const setClauses = result.value.columns
    .filter((col) => col !== pkCol.name)
    .map((col) => `"${col}" = '${editingValues.value[col].replace(/'/g, "''")}'`)
    .join(', ')

  const sql = `UPDATE "${table}" SET ${setClauses} WHERE "${pkCol.name}" = '${String(pkValue).replace(/'/g, "''")}'`

  try {
    await runSQL(sql)
    cancelEdit()
    await loadTableData()
  } catch (e: any) {
    error.value = e.message || String(e)
  }
}

async function deleteRow(rowIndex: number) {
  if (!result.value) return

  const table = selectedTable.value
  const tableSchema = schema.value.find((s) => s.name === table)
  if (!tableSchema) return

  const pkCol = tableSchema.columns.find((c) => c.pk)
  if (!pkCol) {
    error.value = 'No primary key found for this table'
    return
  }

  const row = result.value.rows[rowIndex]
  const pkIndex = result.value.columns.indexOf(pkCol.name)
  const pkValue = row[pkIndex]

  const sql = `DELETE FROM "${table}" WHERE "${pkCol.name}" = '${String(pkValue).replace(/'/g, "''")}'`

  try {
    await runSQL(sql)
    await loadTableData()
  } catch (e: any) {
    error.value = e.message || String(e)
  }
}

function confirmDelete(rowIndex: number) {
  if (confirm(t('analysis.debug.tableBrowser.confirmDelete'))) {
    deleteRow(rowIndex)
  }
}

async function handleClearDebugContext() {
  if (!confirm(t('analysis.debug.tableBrowser.confirmClearDebug'))) return
  isClearingDebug.value = true
  try {
    const res = await window.aiApi.clearDebugContext()
    if (res.success) {
      await loadTableData()
    }
  } catch (e: any) {
    error.value = e.message || String(e)
  } finally {
    isClearingDebug.value = false
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
}

function getCellContextMenu(cell: unknown, _colIdx: number, rowIdx: number) {
  if (!result.value) return []
  const cellText = cell == null ? 'NULL' : String(cell)
  const row = result.value.rows[rowIdx]
  const rowObj: Record<string, unknown> = {}
  result.value.columns.forEach((c, i) => {
    rowObj[c] = row[i]
  })
  return [
    [
      {
        label: t('analysis.debug.tableBrowser.copyCell'),
        class: 'p-2',
        onSelect: () => copyToClipboard(cellText),
      },
      {
        label: t('analysis.debug.tableBrowser.editRow'),
        class: 'p-2',
        onSelect: () => startEdit(rowIdx),
      },
      {
        label: t('analysis.debug.tableBrowser.copyRow'),
        class: 'p-2',
        onSelect: () => copyToClipboard(JSON.stringify(rowObj, null, 2)),
      },
      {
        label: t('analysis.debug.tableBrowser.deleteRow'),
        class: 'p-2 text-red-600 dark:text-red-400',
        onSelect: () => deleteRow(rowIdx),
      },
    ],
  ]
}

watch(dbSource, (val) => {
  localStorage.setItem('debug_dbSource', val)
  selectedTable.value = ''
  result.value = null
  totalRows.value = 0
  currentPage.value = 1
  selectedConversation.value = ''
  loadSchema()
  loadConversations()
})

watch(selectedTable, (val) => {
  if (val) {
    currentPage.value = 1
    loadTableData()
  }
})

watch(selectedConversation, () => {
  if (selectedTable.value === 'ai_message') {
    currentPage.value = 1
    loadTableData()
  }
})

watch(currentPage, () => {
  loadTableData()
})

onMounted(async () => {
  await Promise.all([loadSchema(), loadConversations()])
  if (selectedTable.value) {
    await loadTableData()
  }
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Toolbar -->
    <div class="relative z-20 flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
      <!-- DB Source Tabs -->
      <UITabs v-model="dbSource" :items="dbTabs" size="xs" />

      <div class="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />

      <!-- Table Tabs -->
      <div :class="isAiDb ? 'max-w-[50%]' : 'flex-1'" class="min-w-0">
        <UITabs v-model="selectedTable" :items="tableItems" size="xs" />
      </div>

      <!-- Conversation Filter Dropdown (AI DB + ai_message) -->
      <USelectMenu
        v-if="showConversationFilter"
        v-model="selectedConversation"
        :items="conversationItems"
        value-key="value"
        class="w-48"
        size="xs"
        :ui="{ content: 'z-50' }"
      />

      <div class="flex-1" />

      <UButton
        v-if="isAiDb && selectedTable === 'ai_message'"
        variant="ghost"
        size="xs"
        color="error"
        icon="i-heroicons-trash"
        :loading="isClearingDebug"
        @click="handleClearDebugContext"
      >
        {{ t('analysis.debug.tableBrowser.clearDebugContext') }}
      </UButton>

      <UButton variant="ghost" size="xs" icon="i-heroicons-arrow-path" :loading="isLoading" @click="loadTableData">
        {{ t('analysis.debug.tableBrowser.refresh') }}
      </UButton>
    </div>

    <!-- Error -->
    <div
      v-if="error"
      class="mx-4 mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ error }}
    </div>

    <!-- Table Content -->
    <div class="flex-1 overflow-auto">
      <div v-if="!result && !isLoading" class="flex h-full items-center justify-center">
        <p class="text-sm text-gray-400">{{ t('analysis.debug.tableBrowser.noData') }}</p>
      </div>

      <table v-else-if="result" class="w-full border-collapse text-xs">
        <thead class="sticky top-0 bg-gray-50 dark:bg-gray-800">
          <tr>
            <th
              class="whitespace-nowrap border-b border-r border-gray-200 px-2 py-1.5 text-left font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400"
            >
              #
            </th>
            <th
              v-for="col in result.columns"
              :key="col"
              class="border-b border-r border-gray-200 px-2 py-1.5 text-left dark:border-gray-700"
            >
              <div class="font-mono text-xs font-medium text-gray-700 dark:text-gray-300">{{ col }}</div>
              <div class="text-[10px] leading-tight text-gray-400">
                {{ getColumnLabel(selectedTable, col, locale as LocaleType) }}
              </div>
            </th>
            <th
              class="whitespace-nowrap border-b border-gray-200 px-2 py-1.5 text-center font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400"
            >
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, rowIdx) in result.rows"
            :key="rowIdx"
            class="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
          >
            <td class="border-b border-r border-gray-100 px-2 py-1.5 text-gray-400 dark:border-gray-800">
              {{ (currentPage - 1) * pageSize + rowIdx + 1 }}
            </td>
            <td
              v-for="(cell, colIdx) in row"
              :key="colIdx"
              class="max-w-[300px] border-b border-r border-gray-100 p-0 text-gray-700 dark:border-gray-800 dark:text-gray-300"
              :title="cell == null ? 'NULL' : String(cell)"
            >
              <template v-if="editingRowIndex === rowIdx">
                <input
                  v-model="editingValues[result.columns[colIdx]]"
                  class="w-full px-2 py-1.5 rounded border border-gray-300 bg-white text-xs dark:border-gray-600 dark:bg-gray-800"
                />
              </template>
              <UContextMenu v-else :items="getCellContextMenu(cell, colIdx, rowIdx)">
                <div class="w-full truncate px-2 py-1.5">
                  <span v-if="cell == null" class="italic text-gray-400">NULL</span>
                  <span v-else>{{ String(cell).slice(0, 200) }}</span>
                </div>
              </UContextMenu>
            </td>
            <td class="border-b border-gray-100 px-2 py-1.5 text-center dark:border-gray-800">
              <template v-if="editingRowIndex === rowIdx">
                <div class="flex items-center justify-center gap-1">
                  <UButton size="xs" color="primary" variant="ghost" icon="i-heroicons-check" @click="saveEdit" />
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-x-mark" @click="cancelEdit" />
                </div>
              </template>
              <template v-else>
                <div class="flex items-center justify-center gap-1">
                  <UButton size="xs" variant="ghost" icon="i-heroicons-pencil-square" @click="startEdit(rowIdx)" />
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="error"
                    icon="i-heroicons-trash"
                    @click="confirmDelete(rowIdx)"
                  />
                </div>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Footer: Row Count + Pagination -->
    <div class="flex items-center justify-between border-t border-gray-200 px-4 py-2 dark:border-gray-700">
      <span class="text-xs text-gray-500 dark:text-gray-400">
        {{ totalRows > 0 ? t('analysis.debug.tableBrowser.rowCount', { count: totalRows }) : '' }}
      </span>
      <div v-if="totalPages > 1" class="flex items-center gap-3">
        <UButton
          size="xs"
          variant="ghost"
          :disabled="currentPage <= 1"
          icon="i-heroicons-chevron-left"
          @click="currentPage--"
        />
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {{ t('analysis.debug.tableBrowser.page', { current: currentPage, total: totalPages }) }}
        </span>
        <UButton
          size="xs"
          variant="ghost"
          :disabled="currentPage >= totalPages"
          icon="i-heroicons-chevron-right"
          @click="currentPage++"
        />
      </div>
    </div>
  </div>
</template>
