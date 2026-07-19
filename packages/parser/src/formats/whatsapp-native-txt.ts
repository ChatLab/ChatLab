import * as fs from 'fs'
import * as readline from 'readline'
import { KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'

import { WHATSAPP_FILENAME_SIGNATURES, WHATSAPP_HEAD_SIGNATURES, WhatsAppTextAccumulator } from '../browser/whatsapp'
import type { FormatFeature, FormatModule, ParseEvent, ParseOptions, Parser } from '../types'
import { createProgress, getFileSize } from '../utils'

export const feature: FormatFeature = {
  id: 'whatsapp-native-txt',
  name: 'WhatsApp 官方导出 (TXT)',
  platform: KNOWN_PLATFORMS.WHATSAPP,
  priority: 25,
  extensions: ['.txt'],
  signatures: {
    head: WHATSAPP_HEAD_SIGNATURES,
    filename: WHATSAPP_FILENAME_SIGNATURES,
  },
}

async function* parseWhatsApp(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options
  const totalBytes = getFileSize(filePath)
  const accumulator = new WhatsAppTextAccumulator(filePath)
  let bytesRead = 0
  let lastReportedMessages = 0

  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)
  onLog?.('info', `Starting WhatsApp TXT parsing (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`)

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const lines = readline.createInterface({ input: fileStream, crlfDelay: Infinity })
  fileStream.on('data', (chunk: string | Buffer) => {
    bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
  })

  for await (const line of lines) {
    accumulator.pushLine(line)
    if (accumulator.messageCount >= lastReportedMessages + 500) {
      lastReportedMessages = accumulator.messageCount
      onProgress?.(
        createProgress(
          'parsing',
          bytesRead,
          totalBytes,
          accumulator.messageCount,
          `Processed ${accumulator.messageCount} messages`
        )
      )
    }
  }

  const result = accumulator.finish()
  yield { type: 'meta', data: result.meta }
  yield { type: 'members', data: result.members }
  for (let index = 0; index < result.messages.length; index += batchSize) {
    yield { type: 'messages', data: result.messages.slice(index, index + batchSize) }
  }

  const doneProgress = createProgress('done', totalBytes, totalBytes, result.messages.length, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)

  const typeCounts = new Map<MessageType, number>()
  for (const message of result.messages) {
    typeCounts.set(message.type, (typeCounts.get(message.type) ?? 0) + 1)
  }
  onLog?.(
    'info',
    `WhatsApp TXT parsing completed: ${result.messages.length} messages, ${result.members.length} members, type ${result.meta.type}`
  )
  onLog?.(
    'info',
    `Message types: ${Array.from(typeCounts.entries(), ([type, count]) => `${type}=${count}`).join(', ')}`
  )
  if (result.skippedLines > 0) onLog?.('info', `Skipped ${result.skippedLines} unrecognized lines`)

  yield {
    type: 'done',
    data: { messageCount: result.messages.length, memberCount: result.members.length },
  }
}

export const parser_: Parser = {
  feature,
  parse: parseWhatsApp,
}

const module_: FormatModule = {
  feature,
  parser: parser_,
}

export default module_
