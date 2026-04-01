<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TableSchema } from './types'
import { getTableLabel, getColumnLabel } from './types'

const { t } = useI18n()

// Props
const props = defineProps<{
  open: boolean
  schema: TableSchema[]
}>()

// Emits
const emit = defineEmits<{
  'update:open': [value: boolean]
  generated: [sql: string, explanation: string, prompt: string]
  useSQL: [sql: string]
  runSQL: [sql: string]
}>()

// 状态
const aiPrompt = ref('')
const isGenerating = ref(false)
const aiError = ref<string | null>(null)
const generatedSQL = ref('')
const generatedExplanation = ref('')
const streamingContent = ref('')
const showStreamingContent = ref(false)

// 构建 Schema 描述（用于 AI 提示词）
function buildSchemaDescription(): string {
  const lines: string[] = []

  for (const table of props.schema) {
    const tableLabel = getTableLabel(table.name)
    lines.push(`### ${table.name} (${tableLabel})`)
    lines.push('| 列名 | 说明 | 类型 |')
    lines.push('|------|------|------|')

    for (const col of table.columns) {
      const colLabel = getColumnLabel(table.name, col.name)
      const pkMark = col.pk ? ' (主键)' : ''
      lines.push(`| ${col.name} | ${colLabel}${pkMark} | ${col.type} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// 构建 AI 提示词
function buildAIPrompt(userRequest: string): string {
  const schemaDesc = buildSchemaDescription()

  return `你是一个 SQLite 数据库专家。用户需要查询聊天记录数据库。

## 数据库结构

${schemaDesc}

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
7. **统计查询不需要消息 ID**：当用户需要统计分析（如"统计发言数量"、"分析活跃度"）时，不需要返回 msg.id

## 用户需求

${userRequest}

## 要求

请以 JSON 格式输出，包含两个字段：
- sql: SQLite 查询语句（不要用代码块包裹）
- explanation: 用简洁的中文解释这条 SQL 做了什么

示例格式：
{"sql": "SELECT ...", "explanation": "这条SQL查询了..."}

注意：
1. 仅输出 JSON，不要有任何其他文字
2. SQL 中的查询结果限制在合理范围内（建议 LIMIT 100）
3. 确保 SQL 语法正确`
}

// 关闭弹窗
function closeModal() {
  emit('update:open', false)
  // 重置状态
  aiPrompt.value = ''
  aiError.value = null
  generatedSQL.value = ''
  generatedExplanation.value = ''
  streamingContent.value = ''
  showStreamingContent.value = false
}

// AI 生成 SQL
async function generateSQL() {
  if (!aiPrompt.value.trim()) {
    aiError.value = t('ai.sqlLab.generate.errorEmptyPrompt')
    return
  }

  // 检查是否配置了 LLM
  const hasConfig = await window.llmApi.hasConfig()
  if (!hasConfig) {
    aiError.value = t('common.errorNoAIConfig')
    return
  }

  isGenerating.value = true
  aiError.value = null
  generatedSQL.value = ''
  generatedExplanation.value = ''
  streamingContent.value = ''
  showStreamingContent.value = true

  try {
    const prompt = buildAIPrompt(aiPrompt.value)

    const result = await window.llmApi.chatStream(
      [
        { role: 'system', content: '你是一个 SQLite 专家，请以 JSON 格式输出 sql 和 explanation 字段。' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.1, maxTokens: 800 },
      (chunk) => {
        if (chunk.content) {
          streamingContent.value += chunk.content
        }
      }
    )

    if (result.success) {
      const rawContent = streamingContent.value

      try {
        let jsonStr = rawContent.trim()
        jsonStr = jsonStr.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '')

        const parsed = JSON.parse(jsonStr)
        generatedSQL.value = (parsed.sql || '').trim()
        generatedExplanation.value = (parsed.explanation || '').trim()
        showStreamingContent.value = false

        // 通知父组件生成成功
        if (generatedSQL.value) {
          emit('generated', generatedSQL.value, generatedExplanation.value, aiPrompt.value)
        }
      } catch {
        let sqlContent = rawContent.trim()
        sqlContent = sqlContent.replace(/^```sql?\n?/i, '').replace(/\n?```$/i, '')
        generatedSQL.value = sqlContent.trim()
        generatedExplanation.value = ''

        if (generatedSQL.value) {
          emit('generated', generatedSQL.value, '', aiPrompt.value)
        }
      }
    } else {
      aiError.value = result.error || t('ai.sqlLab.generate.errorGenerate')
    }
  } catch (err: any) {
    aiError.value = err.message || String(err)
  } finally {
    isGenerating.value = false
  }
}

// 使用生成的 SQL
function useGeneratedSQL() {
  if (generatedSQL.value) {
    emit('useSQL', generatedSQL.value)
    closeModal()
  }
}

// 使用并运行 SQL
function useAndRunSQL() {
  if (generatedSQL.value) {
    emit('runSQL', generatedSQL.value)
    closeModal()
  }
}
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6">
        <div class="mb-4 flex items-center gap-2">
          <UIcon name="i-heroicons-sparkles" class="h-5 w-5 text-pink-500" />
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('ai.sqlLab.generate.title') }}</h3>
        </div>

        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {{ t('ai.sqlLab.generate.description') }}
        </p>

        <!-- 输入框 -->
        <textarea
          v-model="aiPrompt"
          class="mb-4 h-24 w-full resize-none rounded-lg border border-gray-300 bg-white p-3 text-sm text-gray-800 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          :placeholder="t('ai.sqlLab.generate.placeholder')"
          :disabled="isGenerating"
        />

        <!-- 实时流式输出 -->
        <div v-if="streamingContent || isGenerating" class="mb-4">
          <button
            class="mb-1.5 flex w-full items-center gap-1.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400"
            @click="showStreamingContent = !showStreamingContent"
          >
            <UIcon
              :name="showStreamingContent ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
              class="h-3.5 w-3.5"
            />
            <UIcon name="i-heroicons-cpu-chip" class="h-3.5 w-3.5" />
            {{ t('ai.sqlLab.generate.aiOutput') }}
            <span v-if="isGenerating" class="ml-1 text-pink-500">{{ t('common.generating') }}</span>
          </button>
          <div
            v-show="showStreamingContent"
            class="max-h-40 overflow-y-auto rounded-lg bg-gray-50 p-3 dark:bg-gray-900"
          >
            <pre class="whitespace-pre-wrap break-all font-mono text-xs text-gray-600 dark:text-gray-400">{{
              streamingContent || t('ai.sqlLab.generate.waitingAI')
            }}</pre>
          </div>
        </div>

        <!-- 错误提示 -->
        <div v-if="aiError" class="mb-4 rounded-lg bg-red-50 p-3 dark:bg-red-950">
          <p class="text-sm text-red-600 dark:text-red-400">{{ aiError }}</p>
        </div>

        <!-- 生成结果 -->
        <div v-if="generatedSQL" class="mb-4 space-y-3">
          <!-- SQL 语句 -->
          <div>
            <p class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
              <UIcon name="i-heroicons-code-bracket" class="h-3.5 w-3.5" />
              {{ t('ai.sqlLab.generate.sqlStatement') }}
            </p>
            <div class="rounded-lg bg-gray-100 p-3 dark:bg-gray-800">
              <pre class="whitespace-pre-wrap break-all font-mono text-sm text-gray-800 dark:text-gray-200">{{
                generatedSQL
              }}</pre>
            </div>
          </div>

          <!-- 解释说明 -->
          <div v-if="generatedExplanation">
            <p class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
              <UIcon name="i-heroicons-light-bulb" class="h-3.5 w-3.5" />
              {{ t('ai.sqlLab.generate.explanation') }}
            </p>
            <div class="rounded-lg bg-blue-50 p-3 dark:bg-blue-950">
              <p class="text-sm text-blue-800 dark:text-blue-200">{{ generatedExplanation }}</p>
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="closeModal">{{ t('common.cancel') }}</UButton>

          <UButton
            v-if="!generatedSQL"
            color="primary"
            :loading="isGenerating"
            :disabled="!aiPrompt.trim()"
            @click="generateSQL"
          >
            <UIcon name="i-heroicons-sparkles" class="mr-1 h-4 w-4" />
            {{ t('ai.sqlLab.generate.generateSQL') }}
          </UButton>

          <template v-else>
            <UButton variant="outline" :loading="isGenerating" @click="generateSQL">
              {{ t('common.regenerate') }}
            </UButton>
            <UButton variant="outline" @click="useGeneratedSQL">{{ t('ai.sqlLab.generate.useSQL') }}</UButton>
            <UButton color="primary" @click="useAndRunSQL">
              <UIcon name="i-heroicons-play" class="mr-1 h-4 w-4" />
              {{ t('ai.sqlLab.generate.run') }}
            </UButton>
          </template>
        </div>
      </div>
    </template>
  </UModal>
</template>
