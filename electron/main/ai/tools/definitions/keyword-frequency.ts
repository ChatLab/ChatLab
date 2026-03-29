import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { isChineseLocale } from '../utils/format'
import { batchSegmentWithFrequency, type BatchSegmentOptions } from '../../../nlp/segmenter'
import type { SupportedLocale } from '../../../nlp/types'

interface TextRow {
  content: string
}

const schema = Type.Object({
  days: Type.Optional(Type.Number({ description: 'ai.tools.keyword_frequency.params.days' })),
  top_n: Type.Optional(Type.Number({ description: 'ai.tools.keyword_frequency.params.top_n' })),
})

export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'keyword_frequency',
    label: 'keyword_frequency',
    description: 'ai.tools.keyword_frequency.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, locale } = context
      const isZh = isChineseLocale(locale)
      const days = params.days || 30
      const topN = params.top_n || 50

      const sql = `
        SELECT content FROM message
        WHERE type = 0 AND content IS NOT NULL AND LENGTH(content) > 1
          AND ts > unixepoch('now', '-' || @days || ' days')
        LIMIT 50000
      `
      const rows = await workerManager.pluginQuery<TextRow>(sessionId, sql, { days })
      if (!rows || rows.length === 0) {
        const text = isZh ? '该时间范围内没有文本消息' : 'No text messages in this time range'
        return { content: [{ type: 'text', text }], details: null }
      }

      const texts = rows.map((r) => r.content)
      const segLocale: SupportedLocale = locale?.startsWith('ja') ? 'ja-JP' : locale?.startsWith('zh') ? 'zh-CN' : 'en-US'
      const segOptions: BatchSegmentOptions = {
        minCount: 2,
        topN,
        posFilterMode: 'meaningful',
        enableStopwords: true,
      }
      const freqMap = batchSegmentWithFrequency(texts, segLocale, segOptions)

      if (freqMap.size === 0) {
        const text = isZh ? '分词后没有有意义的高频词' : 'No meaningful high-frequency words found after segmentation'
        return { content: [{ type: 'text', text }], details: null }
      }

      const ranking = [...freqMap.entries()].map(([word, count], i) => ({
        rank: i + 1,
        word,
        count,
      }))

      const data = {
        period: isZh ? `近${days}天` : `Last ${days} days`,
        totalMessages: rows.length,
        totalKeywords: ranking.length,
        keywords: ranking.map((r) => `${r.rank}. ${r.word} (${r.count}${isZh ? '次' : ''})`),
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
