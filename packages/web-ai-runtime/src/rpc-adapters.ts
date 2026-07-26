import type {
  AppendRuntimeMessageInput,
  ConversationRepository,
  RuntimeConversation,
  RuntimeMessage,
  RuntimeToolDefinition,
  ToolExecutionContext,
  ToolExecutor,
} from '@openchatlab/ai-runtime'
import type { WebRuntimeTaskPayload, WebRuntimeTaskResult, WebRuntimeTaskType } from '@openchatlab/web-runtime'

export interface WebRuntimeRpcPort {
  request<T extends WebRuntimeTaskType>(
    type: T,
    payload: WebRuntimeTaskPayload<T>,
    options?: { signal?: AbortSignal }
  ): Promise<WebRuntimeTaskResult<T>>
}

export class RpcConversationRepository implements ConversationRepository {
  constructor(private readonly rpc: WebRuntimeRpcPort) {}

  getConversation(id: string): Promise<RuntimeConversation | null> {
    return this.rpc.request('ai.conversation.get', { conversationId: id })
  }

  getMessages(conversationId: string): Promise<RuntimeMessage[]> {
    return this.rpc.request('ai.message.list', { conversationId })
  }

  appendMessage(input: AppendRuntimeMessageInput): Promise<RuntimeMessage> {
    return this.rpc.request('ai.message.append', input)
  }

  async updateMessage(id: string, patch: Pick<RuntimeMessage, 'content' | 'blocks' | 'usage'>): Promise<void> {
    await this.rpc.request('ai.message.update', { messageId: id, patch })
  }

  createConversation(sessionId: string, title?: string | null, signal?: AbortSignal): Promise<RuntimeConversation> {
    return this.rpc.request('ai.conversation.create', { sessionId, title }, { signal })
  }

  listConversations(sessionId: string): Promise<RuntimeConversation[]> {
    return this.rpc.request('ai.conversation.list', { sessionId })
  }

  async renameConversation(conversationId: string, title: string): Promise<boolean> {
    return (await this.rpc.request('ai.conversation.rename', { conversationId, title })).renamed
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    return (await this.rpc.request('ai.conversation.delete', { conversationId })).deleted
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    return (await this.rpc.request('ai.message.delete', { messageId })).deleted
  }
}

export class RpcToolExecutor implements ToolExecutor {
  constructor(
    private readonly rpc: WebRuntimeRpcPort,
    private readonly sessionId: string,
    private readonly locale: string
  ) {}

  listTools(): RuntimeToolDefinition[] {
    throw new Error('Use loadTools before executing the runtime')
  }

  execute(): Promise<never> {
    return Promise.reject(new Error('Use withDefinitions before executing the runtime'))
  }

  loadTools(signal?: AbortSignal) {
    return this.rpc.request('ai.tool.list', { locale: this.locale }, { signal })
  }

  withDefinitions(definitions: Awaited<ReturnType<RpcToolExecutor['loadTools']>>): ToolExecutor {
    return {
      listTools: () => definitions,
      execute: (name: string, input: unknown, context: ToolExecutionContext, signal: AbortSignal) => {
        if (context.sessionId !== this.sessionId) throw new Error('AI tool session does not match the bound session')
        return this.rpc.request(
          'ai.tool.execute',
          { sessionId: this.sessionId, name, input, locale: this.locale },
          { signal }
        )
      },
    }
  }
}
