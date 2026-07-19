import * as fs from 'fs'
import { KNOWN_PLATFORMS } from '@openchatlab/shared-types'

import { LINE_FILENAME_SIGNATURES, LINE_HEAD_SIGNATURES, parseLineText } from '../browser/line'
import type { FormatFeature, FormatModule, ParseEvent, ParseOptions, Parser } from '../types'
import { createProgress, getFileSize } from '../utils'

export const feature: FormatFeature = {
  id: 'line-native-txt',
  name: 'LINE 官方导出 TXT',
  platform: KNOWN_PLATFORMS.LINE,
  priority: 35,
  extensions: ['.txt'],
  signatures: {
    head: LINE_HEAD_SIGNATURES,
    filename: LINE_FILENAME_SIGNATURES,
  },
}

async function* parseLine(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options
  const totalBytes = getFileSize(filePath)
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)
  onLog?.('info', `Starting LINE TXT parsing (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`)

  const result = await parseLineText(fs.readFileSync(filePath, 'utf-8'), filePath, {
    onProgress: (progress) =>
      onProgress?.(
        createProgress(
          'parsing',
          Math.round(progress.progress * totalBytes),
          totalBytes,
          progress.messagesProcessed,
          `Processed ${progress.messagesProcessed} messages`
        )
      ),
  })

  yield { type: 'meta', data: result.meta }
  yield { type: 'members', data: result.members }
  for (let index = 0; index < result.messages.length; index += batchSize) {
    yield { type: 'messages', data: result.messages.slice(index, index + batchSize) }
  }

  const doneProgress = createProgress('done', totalBytes, totalBytes, result.messages.length, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)
  onLog?.('info', `LINE TXT parsing completed: ${result.messages.length} messages, ${result.members.length} members`)
  yield {
    type: 'done',
    data: { messageCount: result.messages.length, memberCount: result.members.length },
  }
}

export const parser_: Parser = {
  feature,
  parse: parseLine,
}

const module_: FormatModule = {
  feature,
  parser: parser_,
}

export default module_
