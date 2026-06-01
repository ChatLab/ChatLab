<script setup lang="ts">
import { ref, nextTick, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SchemaPanel, AIHistoryModal, ResultTable, getTableLabel, getColumnLabel } from './SQLLab'
import type { AIHistory, SQLResult, TableSchema } from './SQLLab'
import { useDataService, useLLMService } from '@/services'
import { useLlmStreamService } from '@/services/ai-stream/service'

const { t, locale } = useI18n()

// Props
const props = defineProps<{
  sessionId: string
  chatType?: 'group' | 'private'
}>()

// 组件引用
const schemaPanelRef = ref<InstanceType<typeof SchemaPanel> | null>(null)
const resultTableRef = ref<InstanceType<typeof ResultTable> | null>(null)

// 根据当前聊天类型返回默认 Prompt 文案：群聊走群聊模板，其它场景走私聊模板
function getDefaultPromptByChatType(chatType?: 'group' | 'private'): string {
  return t(chatType === 'group' ? 'ai.sqlLab.generate.defaultPromptGroup' : 'ai.sqlLab.generate.defaultPromptPrivate')
}

// 状态
const sql = ref('SELECT * FROM message LIMIT 10')
// Prompt 模式默认按当前会话类型自动填入模板，避免用户从空白开始输入
const promptInput = ref(getDefaultPromptByChatType(props.chatType))
const inputMode = ref<'prompt' | 'sql'>('prompt')
const isExecuting = ref(false)
const isGenerating = ref(false)
const error = ref<string | null>(null)
const result = ref<SQLResult | null>(null)
const lastPrompt = ref('') // 记录最后使用的 AI 提示词
const streamingOutput = ref('')
const thinkingOutput = ref('')
const isThinking = ref(false)
const thinkingPreRef = ref<HTMLPreElement | null>(null)

// 弹窗状态
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
    result.value = await useDataService().executeSQL(props.sessionId, sql.value)
  } catch (err: any) {
    error.value = err.message || String(err)
  } finally {
    isExecuting.value = false
  }
}

// 处理快捷键
function handleKeyDown(event: KeyboardEvent, mode: 'prompt' | 'sql') {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    if (mode === 'prompt') {
      generateAndRunSQL()
    } else {
      executeSQL()
    }
  }
}

// 处理列名插入
function handleInsertColumn(tableName: string, columnName: string) {
  sql.value += `${tableName}.${columnName}`
}

// 切换输入模式（不做持久化，每次进入默认 Prompt 模式）
function toggleInputMode() {
  inputMode.value = inputMode.value === 'prompt' ? 'sql' : 'prompt'
}

function getSchemaDescription(schemaList: TableSchema[]): string {
  const lines: string[] = []
  for (const table of schemaList) {
    lines.push(`### ${table.name} (${getTableLabel(table.name, locale.value)})`)
    lines.push('| 列名 | 说明 | 类型 |')
    lines.push('|------|------|------|')
    for (const col of table.columns) {
      const pkMark = col.pk ? ' (主键)' : ''
      lines.push(`| ${col.name} | ${getColumnLabel(table.name, col.name, locale.value)}${pkMark} | ${col.type} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function buildAIPrompt(userPrompt: string, schemaList: TableSchema[]): string {
  return `你是一个 SQLite 数据库专家。用户需要查询聊天记录数据库。

## 数据库结构

${getSchemaDescription(schemaList)}

## 重要说明

1. message 表的 ts 字段是 Unix 时间戳（秒），查询日期需要使用 datetime(ts, 'unixepoch') 转换
2. message.type 字段：0=文本, 1=图片, 2=语音, 3=视频, 4=文件, 5=表情包, 6=系统消息, 99=其他
3. member 和 message 表通过 message.sender_id = member.id 关联
4. **人名查询**：当识别到人名/昵称查询时，必须同时在 member 表的 account_name、group_nickname 和 aliases 三个字段中模糊搜索，使用 OR 连接：
   \`\`\`
   WHERE m.account_name LIKE '%人名%'
      OR m.group_nickname LIKE '%人名%'
      OR m.aliases LIKE '%人名%'
   \`\`\`
5. 显示成员名称时，使用 COALESCE(m.group_nickname, m.account_name, m.platform_id) 来获取最佳显示名
6. **查询具体消息时包含消息 ID**：当用户需要查看具体的聊天记录时，SELECT 应包含 msg.id 作为第一个字段，这样用户可以点击查看完整上下文。注意是 msg.id（消息 ID），不是 m.id（成员 ID）。
7. **统计查询不需要消息 ID**：当用户需要统计分析时，不需要返回 msg.id
8. **严禁使用不存在的字段**：只能使用上方 Schema 中明确存在的表名和列名，禁止使用如 sender.display_name、member.display_name 等虚构字段
9. **成员显示名写法**：如果需要显示成员名称，优先使用 COALESCE(m.group_nickname, m.account_name, m.platform_id)；若不联表 member，可使用 COALESCE(msg.sender_group_nickname, msg.sender_account_name, msg.sender_id)
10. **单次只做一个分析目标**：一次 SQL 只返回一个语义一致的结果集，不要把多个分析目标用 UNION ALL/UNION 混合到同一结果表

## 用户需求

${userPrompt}

## 要求

请以 JSON 格式输出，包含两个字段：
- sql: SQLite 查询语句（不要用代码块包裹）
- explanation: 用简洁的中文解释这条 SQL 做了什么

示例格式：
{"sql": "SELECT ...", "explanation": "这条SQL查询了..."}

注意：
1. 仅输出 JSON，不要有任何其他文字
2. SQL 中的查询结果限制在合理范围内（建议 LIMIT 100）
3. 确保 SQL 语法正确
4. 若用户需求包含多个分析目标，仅选择第一个目标生成 SQL`
}

function parseGeneratedResult(rawContent: string): { sql: string; explanation: string } {
  let content = rawContent.trim()
  content = content.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '')
  try {
    const parsed = JSON.parse(content)
    return {
      sql: (parsed.sql || '').trim(),
      explanation: (parsed.explanation || '').trim(),
    }
  } catch {
    content = content.replace(/^```sql?\n?/i, '').replace(/\n?```$/i, '')
    return { sql: content.trim(), explanation: '' }
  }
}

async function generateAndRunSQL() {
  const prompt = promptInput.value.trim()
  if (!prompt) {
    error.value = t('ai.sqlLab.generate.errorEmptyPrompt')
    return
  }

  const hasConfig = await useLLMService().hasConfig()
  if (!hasConfig) {
    error.value = t('common.errorNoAIConfig')
    return
  }

  const schemaList = schemaPanelRef.value?.schema || []
  if (schemaList.length === 0) {
    error.value = t('common.error.unknown')
    return
  }

  isGenerating.value = true
  // 开始新一轮生成时清空旧结果，确保预览区优先展示本次 AI 流式输出
  result.value = null
  error.value = null
  streamingOutput.value = ''
  thinkingOutput.value = ''
  isThinking.value = false

  let streamError = ''

  try {
    const fullPrompt = buildAIPrompt(prompt, schemaList)
    const result = await useLlmStreamService().chatStream(
      [
        { role: 'system', content: '你是一个 SQLite 专家，请以 JSON 格式输出 sql 和 explanation 字段。' },
        { role: 'user', content: fullPrompt },
      ],
      { temperature: 0.1, maxTokens: 4096 },
      (chunk) => {
        if (chunk.thinking !== undefined) {
          if (chunk.thinkingDone) {
            isThinking.value = false
          } else {
            isThinking.value = true
            if (chunk.thinking) {
              thinkingOutput.value += chunk.thinking
              nextTick(() => {
                if (thinkingPreRef.value) {
                  thinkingPreRef.value.scrollTop = thinkingPreRef.value.scrollHeight
                }
              })
            }
          }
          return
        }
        if (chunk.error) {
          streamError = chunk.error
        }
        if (chunk.isFinished && chunk.finishReason === 'length') {
          streamError = t('ai.sqlLab.generate.errorTokenLimit')
        }
        if (chunk.content) streamingOutput.value += chunk.content
      }
    )

    if (!result.success) {
      error.value = result.error || streamError || t('ai.sqlLab.generate.errorGenerate')
      return
    }

    if (streamError) {
      error.value = streamError
      return
    }

    const generated = parseGeneratedResult(streamingOutput.value)
    if (!generated.sql) {
      error.value = streamingOutput.value
        ? `${t('ai.sqlLab.generate.errorGenerate')}: ${streamingOutput.value.slice(0, 200)}`
        : t('ai.sqlLab.generate.errorGenerate')
      return
    }

    sql.value = generated.sql
    lastPrompt.value = prompt
    addToHistory(prompt, generated.sql, generated.explanation)
    await executeSQL()
  } catch (err: any) {
    error.value = err.message || String(err)
  } finally {
    isGenerating.value = false
  }
}

// 从历史记录执行
async function executeFromHistory(record: AIHistory) {
  sql.value = record.sql
  lastPrompt.value = record.prompt // 记录历史的提示词
  showHistoryModal.value = false
  await executeSQL()
}

onMounted(() => {
  loadHistory()
})

// 会话类型变化时自动切换默认模板，保证私聊/群聊场景始终匹配
watch(
  () => props.chatType,
  (chatType) => {
    promptInput.value = getDefaultPromptByChatType(chatType)
  }
)
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
          <!-- 输入区 -->
          <!-- 两种输入模式统一输入框高度，避免切换模式时界面跳动 -->
          <textarea
            v-if="inputMode === 'prompt'"
            v-model="promptInput"
            class="h-32 w-full resize-none rounded-lg border border-gray-300 bg-white p-3 text-sm text-gray-800 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            :placeholder="t('ai.sqlLab.generate.placeholder')"
            spellcheck="false"
            @keydown="handleKeyDown($event, 'prompt')"
          />
          <textarea
            v-else
            v-model="sql"
            class="h-32 w-full resize-none rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm text-gray-800 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            :placeholder="t('ai.sqlLab.editor.placeholder')"
            spellcheck="false"
            @keydown="handleKeyDown($event, 'sql')"
          />

          <!-- 工具栏 -->
          <div class="mt-1 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UButton variant="ghost" size="xs" @click="toggleInputMode">
                <UIcon name="i-heroicons-arrows-right-left" class="mr-1 h-3.5 w-3.5" />
                {{
                  inputMode === 'prompt'
                    ? t('ai.sqlLab.editor.switchToSQLMode')
                    : t('ai.sqlLab.editor.switchToPromptMode')
                }}
              </UButton>
              <span v-if="inputMode === 'sql'" class="text-xs text-gray-400">{{ t('ai.sqlLab.editor.tip') }}</span>
            </div>
            <div class="flex items-center gap-2">
              <UButton variant="ghost" size="sm" :disabled="aiHistory.length === 0" @click="showHistoryModal = true">
                <UIcon name="i-heroicons-clock" class="mr-1 h-4 w-4" />
                {{ t('ai.sqlLab.editor.history') }}
                <span v-if="aiHistory.length > 0" class="ml-1 text-xs text-gray-400">({{ aiHistory.length }})</span>
              </UButton>
              <UButton
                v-if="inputMode === 'prompt'"
                color="primary"
                size="sm"
                :loading="isGenerating || isExecuting"
                :disabled="!promptInput.trim()"
                @click="generateAndRunSQL"
              >
                <UIcon name="i-heroicons-sparkles" class="mr-1 h-4 w-4" />
                {{ t('ai.sqlLab.editor.generateAndRun') }}
              </UButton>
              <UButton v-else color="primary" size="sm" :loading="isExecuting" @click="executeSQL">
                <UIcon name="i-heroicons-play" class="mr-1 h-4 w-4" />
                {{ t('ai.sqlLab.editor.run') }}
              </UButton>
            </div>
          </div>
        </div>
      </div>

      <!-- 结果区域：无查询结果时显示 AI 流式输出，有结果后自动切回结果表格 -->
      <div
        v-if="inputMode === 'prompt' && !result && !error && (streamingOutput || thinkingOutput || isGenerating)"
        class="flex-1 overflow-auto p-4"
      >
        <div
          class="mx-auto w-full max-w-3xl rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
        >
          <p class="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300">
            <UIcon name="i-heroicons-cpu-chip" class="h-4 w-4" />
            {{ t('ai.sqlLab.generate.aiOutput') }}
            <span v-if="isThinking" class="text-gray-500">{{ t('ai.sqlLab.generate.thinking') }}</span>
            <span v-else-if="isGenerating" class="text-pink-500">{{ t('common.generating') }}</span>
          </p>

          <!-- Thinking block -->
          <details v-if="thinkingOutput" class="mb-3" :open="isThinking">
            <summary class="cursor-pointer select-none text-xs font-medium text-gray-500 dark:text-gray-400">
              {{ t('ai.sqlLab.generate.thinkingProcess') }}
            </summary>
            <pre
              ref="thinkingPreRef"
              class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-gray-200 bg-gray-50 p-2 font-mono text-xs leading-5 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
              >{{ thinkingOutput }}</pre
            >
          </details>

          <pre
            v-if="streamingOutput"
            class="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-gray-600 dark:text-gray-400"
            >{{ streamingOutput }}</pre
          >
          <p v-else-if="!thinkingOutput" class="font-mono text-xs text-gray-400">
            {{ t('ai.sqlLab.generate.waitingAI') }}
          </p>
        </div>
      </div>
      <ResultTable v-else ref="resultTableRef" :result="result" :error="error" :sql="sql" :prompt="lastPrompt" />
    </div>

    <!-- 历史记录弹窗 -->
    <AIHistoryModal
      v-model:open="showHistoryModal"
      :history="aiHistory"
      @execute="executeFromHistory"
      @delete="deleteHistory"
    />
  </div>
</template>
