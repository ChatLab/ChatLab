import type { LanguageModelUsage } from 'ai'
import {
  runAbortSpike,
  runStreamSpike,
  runToolLoopSpike,
  type ProviderKind,
  type SpikeConfig,
  type SpikeEvent,
  type SpikeRunResult,
} from './runtime'

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element as T
}

const providerKind = requiredElement<HTMLSelectElement>('provider-kind')
const baseURL = requiredElement<HTMLInputElement>('base-url')
const model = requiredElement<HTMLInputElement>('model')
const apiKey = requiredElement<HTMLInputElement>('api-key')
const streamButton = requiredElement<HTMLButtonElement>('stream-test')
const toolButton = requiredElement<HTMLButtonElement>('tool-test')
const abortButton = requiredElement<HTMLButtonElement>('abort-test')
const stopButton = requiredElement<HTMLButtonElement>('stop')
const clearButton = requiredElement<HTMLButtonElement>('clear')
const status = requiredElement<HTMLElement>('status')
const ttfb = requiredElement<HTMLElement>('ttfb')
const toolCount = requiredElement<HTMLElement>('tool-count')
const usage = requiredElement<HTMLElement>('usage')
const output = requiredElement<HTMLPreElement>('output')

let activeController: AbortController | null = null

function readConfig(): SpikeConfig {
  const key = apiKey.value.trim()
  if (!key) throw new Error('请输入临时 API Key')
  const url = baseURL.value.trim()
  if (!url) throw new Error('请输入 Base URL')
  const modelId = model.value.trim()
  if (!modelId) throw new Error('请输入模型名称')
  return {
    providerKind: providerKind.value as ProviderKind,
    baseURL: url,
    apiKey: key,
    model: modelId,
  }
}

function append(value: string): void {
  output.textContent += value
  output.scrollTop = output.scrollHeight
}

function formatUsage(value: LanguageModelUsage): string {
  return `${value.inputTokens ?? 0} / ${value.outputTokens ?? 0}`
}

function handleEvent(event: SpikeEvent): void {
  switch (event.type) {
    case 'text':
      append(event.delta)
      break
    case 'reasoning':
      append(`[reasoning] ${event.delta}`)
      break
    case 'tool-call':
      append(`\n[tool-call] ${event.name}\n`)
      break
    case 'tool-result':
      append(`[tool-result] ${event.name}\n`)
      break
    case 'usage':
      usage.textContent = formatUsage(event.usage)
      break
    case 'aborted':
      append('\n[aborted]\n')
      break
  }
}

function safeErrorMessage(error: unknown, key: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replaceAll(key, '[REDACTED]')
}

function setRunning(running: boolean): void {
  streamButton.disabled = running
  toolButton.disabled = running
  abortButton.disabled = running
  stopButton.disabled = !running
}

async function run(test: (config: SpikeConfig, signal: AbortSignal) => Promise<SpikeRunResult>): Promise<void> {
  let config: SpikeConfig
  try {
    config = readConfig()
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error)
    return
  }

  output.textContent = ''
  status.textContent = '请求中'
  ttfb.textContent = '—'
  toolCount.textContent = '0'
  usage.textContent = '—'
  activeController = new AbortController()
  setRunning(true)

  try {
    const result = await test(config, activeController.signal)
    ttfb.textContent = result.firstOutputMs === null ? '—' : `${Math.round(result.firstOutputMs)} ms`
    toolCount.textContent = String(result.toolCalls)
    usage.textContent = formatUsage(result.usage)
    status.textContent = result.aborted ? '已中止' : '通过'
  } catch (error) {
    const message = safeErrorMessage(error, config.apiKey)
    status.textContent = activeController.signal.aborted ? '已中止' : '失败'
    append(`\n[error] ${message}\n`)
  } finally {
    activeController = null
    setRunning(false)
  }
}

streamButton.addEventListener('click', () => void run((config, signal) => runStreamSpike(config, signal, handleEvent)))
toolButton.addEventListener('click', () => void run((config, signal) => runToolLoopSpike(config, signal, handleEvent)))
abortButton.addEventListener('click', () => void run((config, signal) => runAbortSpike(config, signal, handleEvent)))
stopButton.addEventListener('click', () => activeController?.abort())
clearButton.addEventListener('click', () => {
  output.textContent = ''
})

document.documentElement.dataset.ready = 'true'
