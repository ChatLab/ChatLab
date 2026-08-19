<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import ChatMessage from '@/components/AIChat/chat/ChatMessage.vue'
import { useProgressiveChatHistory } from '@/components/AIChat/composables/useProgressiveChatHistory'
import { groupMessagesToQAPairs } from '@/components/AIChat/utils/chatMessages'
import type { ChatMessage as ChatMessageData, ContentBlock } from '@/stores/aiChat'
import { createAIStreamTextBatcher } from '@/stores/aiChatStreamBatcher'

interface BenchmarkReport {
  pairs: number
  mountedPairs: number
  blocksPerAnswer: number
  answerCharacters: number
  initialRenderMs: number
  domNodes: number
  stream?: {
    chunks: number
    intervalMs: number
    batched: boolean
    renderUpdates: number
    durationMs: number
    longTasks: number
    longTaskDurationMs: number
  }
}

declare global {
  interface Window {
    __AI_CHAT_BENCHMARK_STARTED_AT__: number
    __AI_CHAT_BENCHMARK__?: BenchmarkReport
  }
}

const params = new URLSearchParams(window.location.search)
const pairCount = readPositiveInteger('pairs', 100)
const blocksPerAnswer = readPositiveInteger('blocks', 10)
const answerCharacters = readPositiveInteger('chars', 10_000)
const streamChunks = readPositiveInteger('streamChunks', 0)
const streamIntervalMs = readPositiveInteger('streamInterval', 4)
const useStreamBatcher = params.get('batch') === '1'
const useProgressiveHistory = params.get('progressive') === '1'
const report = ref<BenchmarkReport | null>(null)
const messages = ref(createMessages(pairCount, blocksPerAnswer, answerCharacters))
const qaPairs = computed(() => groupMessagesToQAPairs(messages.value))
const benchmarkConversationId = ref<string | null>('benchmark')
const benchmarkScrollContainer = ref<HTMLElement | null>(null)
const progressiveHistory = useProgressiveChatHistory(qaPairs, benchmarkConversationId, benchmarkScrollContainer)
const renderedPairs = computed(() => (useProgressiveHistory ? progressiveHistory.visiblePairs.value : qaPairs.value))

function readPositiveInteger(key: string, fallback: number): number {
  const value = Number.parseInt(params.get(key) ?? '', 10)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function buildText(length: number, seed: number): string {
  const paragraph = `第 ${seed + 1} 段合成回答只用于性能测试，不包含任何用户数据。这里包含 **Markdown**、列表和换行。\n\n- 项目一\n- 项目二\n\n`
  return paragraph.repeat(Math.ceil(length / paragraph.length)).slice(0, length)
}

function createBlocks(blockCount: number, totalCharacters: number, seed: number): ContentBlock[] {
  const textPerBlock = Math.max(1, Math.floor(totalCharacters / blockCount))
  return Array.from({ length: blockCount }, (_, index): ContentBlock => {
    const text = buildText(textPerBlock, seed * blockCount + index)
    if (index % 3 === 0) return { type: 'think', tag: 'analysis', text, durationMs: 500 }
    if (index % 3 === 1) {
      return {
        type: 'tool',
        tool: {
          name: 'benchmark_tool',
          displayName: 'benchmark_tool',
          status: 'done',
          result: text,
          displayResult: text,
        },
      }
    }
    return { type: 'text', text }
  })
}

function createMessages(pairs: number, blockCount: number, characters: number): ChatMessageData[] {
  const result: ChatMessageData[] = []
  const timestamp = Date.now()
  for (let index = 0; index < pairs; index += 1) {
    result.push({
      id: `user-${index}`,
      role: 'user',
      content: `这是第 ${index + 1} 个合成问题。`,
      timestamp: timestamp + index * 2,
    })
    result.push({
      id: `assistant-${index}`,
      role: 'assistant',
      content: buildText(characters, index),
      contentBlocks: createBlocks(blockCount, characters, index),
      processDurationMs: 1_500,
      timestamp: timestamp + index * 2 + 1,
    })
  }
  return result
}

onMounted(async () => {
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const result: BenchmarkReport = {
    pairs: pairCount,
    mountedPairs: renderedPairs.value.length,
    blocksPerAnswer,
    answerCharacters,
    initialRenderMs: performance.now() - window.__AI_CHAT_BENCHMARK_STARTED_AT__,
    domNodes: document.getElementsByTagName('*').length,
  }
  report.value = result
  window.__AI_CHAT_BENCHMARK__ = result

  if (streamChunks > 0) {
    await runStreamingBenchmark(result)
  }
})

async function runStreamingBenchmark(result: BenchmarkReport): Promise<void> {
  const longTaskDurations: number[] = []
  const observer =
    typeof PerformanceObserver === 'undefined'
      ? null
      : new PerformanceObserver((entries) => {
          longTaskDurations.push(...entries.getEntries().map((entry) => entry.duration))
        })
  observer?.observe({ type: 'longtask', buffered: false })

  const assistantIndex = messages.value.length - 1
  const assistant = messages.value[assistantIndex]
  const initialBlocks = assistant.contentBlocks ?? []
  messages.value[assistantIndex] = {
    ...assistant,
    isStreaming: true,
    contentBlocks: [...initialBlocks, { type: 'text', text: '' }],
  }
  await nextTick()

  const chunkText = '合成流式内容 **Markdown**。'
  const startedAt = performance.now()
  let emitted = 0
  let renderUpdates = 0
  const applyText = (text: string) => {
    const current = messages.value[assistantIndex]
    const blocks = current.contentBlocks ?? []
    const lastBlock = blocks[blocks.length - 1]
    if (lastBlock?.type === 'text') lastBlock.text += text
    messages.value[assistantIndex] = {
      ...current,
      content: current.content + text,
      contentBlocks: [...blocks],
    }
    renderUpdates += 1
  }
  const batcher = createAIStreamTextBatcher((deltas) => {
    applyText(deltas.map((delta) => delta.content).join(''))
  })
  await new Promise<void>((resolve) => {
    const timer = window.setInterval(() => {
      if (useStreamBatcher) batcher.push({ type: 'content', content: chunkText })
      else applyText(chunkText)
      emitted += 1
      if (emitted < streamChunks) return
      window.clearInterval(timer)
      batcher.flush()
      resolve()
    }, streamIntervalMs)
  })

  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  observer?.disconnect()
  result.stream = {
    chunks: streamChunks,
    intervalMs: streamIntervalMs,
    batched: useStreamBatcher,
    renderUpdates,
    durationMs: performance.now() - startedAt,
    longTasks: longTaskDurations.length,
    longTaskDurationMs: longTaskDurations.reduce((sum, duration) => sum + duration, 0),
  }
  report.value = { ...result }
  window.__AI_CHAT_BENCHMARK__ = report.value
}
</script>

<template>
  <UApp>
    <main class="mx-auto max-w-4xl px-6 py-8">
      <pre id="benchmark-report" class="mb-8 rounded-lg bg-gray-100 p-4 text-xs dark:bg-gray-900">{{ report }}</pre>
      <template v-for="pair in renderedPairs" :key="pair.id">
        <div v-if="!pair.standalone" class="space-y-6 pb-4">
          <ChatMessage
            v-if="pair.user"
            :message-id="pair.user.id"
            :role="pair.user.role"
            :content="pair.user.content"
            :timestamp="pair.user.timestamp"
          />
          <ChatMessage
            v-if="pair.assistant"
            :message-id="pair.assistant.id"
            :role="pair.assistant.role"
            :content="pair.assistant.content"
            :content-blocks="pair.assistant.contentBlocks"
            :process-duration-ms="pair.assistant.processDurationMs"
            :timestamp="pair.assistant.timestamp"
          />
        </div>
      </template>
    </main>
  </UApp>
</template>
