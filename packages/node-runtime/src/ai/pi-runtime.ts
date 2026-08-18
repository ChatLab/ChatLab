import {
  lazyApi,
  lazyStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai'

const apiStreams = {
  'openai-completions': lazyApi(() => import('@earendil-works/pi-ai/api/openai-completions')),
  'openai-responses': lazyApi(() => import('@earendil-works/pi-ai/api/openai-responses')),
  'anthropic-messages': lazyApi(() => import('@earendil-works/pi-ai/api/anthropic-messages')),
  'google-generative-ai': lazyApi(() => import('@earendil-works/pi-ai/api/google-generative-ai')),
} satisfies Record<string, ProviderStreams>

type SupportedApi = keyof typeof apiStreams

function isSupportedApi(api: Api): api is SupportedApi {
  return Object.hasOwn(apiStreams, api)
}

/**
 * Dispatch a ChatLab model to the stable Pi API implementation selected by its api field.
 * ChatLab intentionally supports only the four formats exposed in the model settings UI.
 */
export function streamSimple(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  if (!isSupportedApi(model.api)) {
    return lazyStream(model, async () => {
      throw new Error(`Unsupported ChatLab AI API format: ${model.api}`)
    })
  }

  return apiStreams[model.api].streamSimple(model, context, options)
}

export function completeSimple(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
): Promise<AssistantMessage> {
  return streamSimple(model, context, options).result()
}
