import dayjs from 'dayjs'

export type ExportFormat = 'markdown' | 'txt'

export interface ExportMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface ExportLabels {
  createdAt: string
  user: string
  assistant: string
}

/**
 * 格式化对话为 Markdown 格式
 */
export function formatAsMarkdown(
  title: string,
  messages: ExportMessage[],
  createdAt: number,
  labels: ExportLabels
): string {
  const lines: string[] = []

  // 标题
  lines.push(`# ${title}`)
  lines.push('')
  lines.push(`> ${labels.createdAt}: ${dayjs(createdAt).format('YYYY-MM-DD HH:mm:ss')}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  // 消息
  for (const msg of messages) {
    const time = dayjs(msg.timestamp).format('YYYY-MM-DD HH:mm:ss')
    const roleLabel = msg.role === 'user' ? labels.user : labels.assistant

    lines.push(`### ${roleLabel}`)
    lines.push(`*${time}*`)
    lines.push('')
    lines.push(msg.content)
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 格式化对话为纯文本格式
 */
export function formatAsPlainText(
  title: string,
  messages: ExportMessage[],
  createdAt: number,
  labels: ExportLabels
): string {
  const lines: string[] = []

  // 标题
  lines.push(`${title}`)
  lines.push(`${labels.createdAt}: ${dayjs(createdAt).format('YYYY-MM-DD HH:mm:ss')}`)
  lines.push('')
  lines.push('='.repeat(50))
  lines.push('')

  // 消息
  for (const msg of messages) {
    const time = dayjs(msg.timestamp).format('YYYY-MM-DD HH:mm:ss')
    const roleLabel = msg.role === 'user' ? labels.user : labels.assistant

    lines.push(`[${roleLabel}] ${time}`)
    lines.push('')
    lines.push(msg.content)
    lines.push('')
    lines.push('-'.repeat(50))
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 清理文件名中的非法字符
 */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[/\\?%*:|"<>]/g, '_')
}

/**
 * 导出对话到下载目录
 */
export async function exportConversation(
  title: string,
  messages: ExportMessage[],
  createdAt: number,
  format: ExportFormat,
  labels: ExportLabels
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (messages.length === 0) {
    return { success: false, error: 'No messages to export' }
  }

  // 格式化内容
  let content: string
  let filename: string
  const timestamp = dayjs(createdAt).format('YYYYMMDD_HHmmss')
  const safeTitle = sanitizeFilename(title)

  if (format === 'markdown') {
    content = formatAsMarkdown(title, messages, createdAt, labels)
    filename = `${safeTitle}_${timestamp}.md`
  } else {
    content = formatAsPlainText(title, messages, createdAt, labels)
    filename = `${safeTitle}_${timestamp}.txt`
  }

  // 转换为 data URL 并保存
  const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`
  const result = await window.cacheApi.saveToDownloads(filename, dataUrl)

  return result
}
