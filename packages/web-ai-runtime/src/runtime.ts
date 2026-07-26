import { getDefaultAssistantPrompt, runAgent, type ConversationRepository } from '@openchatlab/ai-runtime'
import { generateText } from 'ai'

import { normalizeWebAIError, WebAIRuntimeError } from './errors'
import { WebModelConfigStore } from './model-config-store'
import { createWebAIModel, type CreatedWebModel } from './provider-factory'
import { RpcConversationRepository, RpcToolExecutor, type WebRuntimeRpcPort } from './rpc-adapters'
import type {
  SaveWebModelConfigInput,
  WebAIConnectionTestResult,
  WebAIRunInput,
  WebAIRunResult,
  WebModelConfig,
} from './types'

export class WebAIChatRuntime {
  readonly conversations: RpcConversationRepository
  private readonly active = new Map<string, AbortController>()

  constructor(
    private readonly rpc: WebRuntimeRpcPort,
    private readonly configStore: WebModelConfigStore = new WebModelConfigStore(),
    private readonly modelFactory: (
      config: WebModelConfig,
      apiKey: string
    ) => Promise<CreatedWebModel> = createWebAIModel
  ) {
    this.conversations = new RpcConversationRepository(rpc)
  }

  getConfig(): Promise<WebModelConfig | null> {
    return this.configStore.getConfig()
  }

  saveConfig(input: SaveWebModelConfigInput): Promise<WebModelConfig> {
    return this.configStore.save(input)
  }

  clearConfig(): Promise<void> {
    return this.configStore.clear()
  }

  async testConnection(input?: SaveWebModelConfigInput): Promise<WebAIConnectionTestResult> {
    const startedAt = performance.now()
    try {
      const { config, apiKey } = input
        ? {
            config: {
              provider: input.provider,
              baseURL: input.baseURL,
              model: input.model,
              contextWindow: input.contextWindow,
              updatedAt: Date.now(),
            } satisfies WebModelConfig,
            apiKey: input.apiKey,
          }
        : await this.getRequiredConfig()
      const model = await this.modelFactory(config, apiKey)
      await generateText({ model: model.model, prompt: 'Reply with OK.', maxOutputTokens: 8 })
      return { ok: true, latencyMs: Math.round(performance.now() - startedAt) }
    } catch (error) {
      return { ok: false, error: normalizeWebAIError(error).data }
    }
  }

  async run(input: WebAIRunInput): Promise<WebAIRunResult> {
    if (this.active.has(input.conversationId)) throw new Error('This AI conversation is already generating')
    const abortController = new AbortController()
    this.active.set(input.conversationId, abortController)
    try {
      const { config, apiKey } = await this.getRequiredConfig()
      const model = await this.modelFactory(config, apiKey)
      const toolBridge = new RpcToolExecutor(this.rpc, input.sessionId, input.locale)
      const tools = toolBridge.withDefinitions(await toolBridge.loadTools(abortController.signal))
      const userMessage = await this.conversations.appendMessage({
        conversationId: input.conversationId,
        role: 'user',
        content: input.userMessage,
      })
      const repository = filterMessagesFromHistory(this.conversations, new Set([userMessage.id]))
      const result = await runAgent({
        conversationId: input.conversationId,
        sessionId: input.sessionId,
        systemPrompt: getDefaultAssistantPrompt(input.locale),
        userMessage: input.userMessage,
        model,
        repository,
        tools,
        signal: abortController.signal,
        compression: { thresholdRatio: 0.7, recentBufferRatio: 0.2 },
        onEvent: input.onEvent,
      })
      return { userMessage, assistantMessage: result.message }
    } catch (error) {
      if (abortController.signal.aborted) throw error
      throw normalizeWebAIError(error)
    } finally {
      this.active.delete(input.conversationId)
    }
  }

  stop(conversationId: string): boolean {
    const controller = this.active.get(conversationId)
    if (!controller) return false
    controller.abort()
    return true
  }

  async regenerateLast(input: Omit<WebAIRunInput, 'userMessage'>): Promise<WebAIRunResult> {
    if (this.active.has(input.conversationId)) throw new Error('This AI conversation is already generating')
    const messages = await this.conversations.getMessages(input.conversationId)
    const assistant = [...messages].reverse().find((message) => message.role === 'assistant')
    if (!assistant) throw new Error('No assistant message is available to regenerate')
    const assistantIndex = messages.findIndex((message) => message.id === assistant.id)
    const user = [...messages.slice(0, assistantIndex)].reverse().find((message) => message.role === 'user')
    if (!user) throw new Error('No user message is available to regenerate')
    const abortController = new AbortController()
    this.active.set(input.conversationId, abortController)
    try {
      const { config, apiKey } = await this.getRequiredConfig()
      const model = await this.modelFactory(config, apiKey)
      const toolBridge = new RpcToolExecutor(this.rpc, input.sessionId, input.locale)
      const tools = toolBridge.withDefinitions(await toolBridge.loadTools(abortController.signal))
      const result = await runAgent({
        conversationId: input.conversationId,
        sessionId: input.sessionId,
        systemPrompt: getDefaultAssistantPrompt(input.locale),
        userMessage: user.content,
        model,
        // 保留旧回复直到新回复成功，失败或中止时不会让用户丢失原有结果。
        repository: filterMessagesFromHistory(this.conversations, new Set([user.id, assistant.id])),
        tools,
        signal: abortController.signal,
        onEvent: input.onEvent,
      })
      await this.conversations.deleteMessage(assistant.id)
      return { userMessage: user, assistantMessage: result.message }
    } catch (error) {
      if (abortController.signal.aborted) throw error
      throw normalizeWebAIError(error)
    } finally {
      this.active.delete(input.conversationId)
    }
  }

  private async getRequiredConfig(): Promise<{ config: WebModelConfig; apiKey: string }> {
    const [config, apiKey] = await Promise.all([this.configStore.getConfig(), this.configStore.getApiKey()])
    if (!config || !apiKey) {
      throw new WebAIRuntimeError({
        code: 'NOT_CONFIGURED',
        message: 'Configure a browser-compatible model before starting AI chat.',
        retryable: false,
      })
    }
    return { config, apiKey }
  }
}

function filterMessagesFromHistory(
  repository: ConversationRepository,
  messageIds: ReadonlySet<string>
): ConversationRepository {
  return {
    ...repository,
    getConversation: (id) => repository.getConversation(id),
    getMessages: async (conversationId) =>
      (await repository.getMessages(conversationId)).filter((message) => !messageIds.has(message.id)),
    appendMessage: (input) => repository.appendMessage(input),
    updateMessage: (id, patch) => repository.updateMessage(id, patch),
    replaceSummary: (conversationId, input) => repository.replaceSummary(conversationId, input),
  }
}
