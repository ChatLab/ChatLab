import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../../../', import.meta.url)

function readProjectFile(relativePath) {
  return readFileSync(new URL(relativePath, root), 'utf-8')
}

test('agent prompt keeps database evidence policy in locked section', () => {
  const source = readProjectFile('electron/main/ai/agent/prompt-builder.ts')
  const agent = readProjectFile('electron/main/ai/agent/index.ts')
  const zhCN = readProjectFile('electron/main/i18n/locales/zh-CN.ts')
  const enUS = readProjectFile('electron/main/i18n/locales/en-US.ts')

  assert.match(source, /ai\.agent\.evidencePolicy/)
  assert.match(source, /ai\.agent\.dataSnapshotNote/)
  assert.match(agent, /this\.context\.dataSnapshot/)
  assert.match(zhCN, /AI 对话历史、历史 AI 回复和压缩摘要只用于理解用户意图/)
  assert.match(zhCN, /必须先调用合适的数据工具检索当前数据库/)
  assert.match(zhCN, /不要编造不存在的聊天记录/)
  assert.match(enUS, /prior AI replies, and compressed summaries/)
  assert.match(enUS, /first call an appropriate data tool/)
  assert.match(enUS, /do not fabricate nonexistent chat records/)
})

test('agent context carries a current database snapshot', () => {
  const toolTypes = readProjectFile('electron/main/ai/tools/types.ts')
  const ipc = readProjectFile('electron/main/ipc/ai.ts')

  assert.match(toolTypes, /dataSnapshot\?:/)
  assert.match(toolTypes, /totalMessages: number/)
  assert.match(toolTypes, /lastMessageTs: number \| null/)
  assert.match(ipc, /workerManager\.getChatOverview\(context\.sessionId, 5\)/)
  assert.match(ipc, /const enrichedContext: ToolContext = \{[\s\S]*dataSnapshot[\s\S]*\}/)
})
