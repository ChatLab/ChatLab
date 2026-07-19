import * as fs from 'fs'
import * as readline from 'readline'
import { KNOWN_PLATFORMS } from '@openchatlab/shared-types'

import { QQ_HEAD_SIGNATURES, QqTextAccumulator } from '../browser/qq'
import type { FormatFeature, FormatModule, ParseEvent, ParseOptions, Parser } from '../types'
import { createProgress, getFileSize } from '../utils'

export const feature: FormatFeature = {
  id: 'qq-native-txt',
  name: 'QQ 官方导出 (TXT)',
  platform: KNOWN_PLATFORMS.QQ,
  priority: 30,
  extensions: ['.txt'],
  signatures: { head: QQ_HEAD_SIGNATURES },
}

async function* parseQq(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options
  const totalBytes = getFileSize(filePath)
  let bytesRead = 0
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)
  onLog?.('info', `Starting QQ TXT parsing (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`)

  const accumulator = new QqTextAccumulator(filePath)
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const lines = readline.createInterface({ input: fileStream, crlfDelay: Infinity })
  fileStream.on('data', (chunk: string | Buffer) => {
    bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
  })

  let lastReportedCount = -1
  for await (const line of lines) {
    accumulator.pushLine(line)
    const messageCount = accumulator.messageCount
    if (messageCount > 0 && messageCount % 1000 === 0 && messageCount !== lastReportedCount) {
      lastReportedCount = messageCount
      onProgress?.(createProgress('parsing', bytesRead, totalBytes, messageCount, `Processed ${messageCount} messages`))
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
  onLog?.('info', `QQ TXT parsing completed: ${result.messages.length} messages, ${result.members.length} members`)
  if (result.skippedLines > 0) {
    onLog?.('info', `Skipped ${result.skippedLines} unrecognized lines while parsing QQ TXT`)
  }
  yield {
    type: 'done',
    data: { messageCount: result.messages.length, memberCount: result.members.length },
  }
}

export const parser_: Parser = { feature, parse: parseQq }

const module_: FormatModule = { feature, parser: parser_ }

export default module_
