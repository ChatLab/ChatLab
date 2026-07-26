import type { SaveWebModelConfigInput, WebAIProvider } from '@openchatlab/web-ai-runtime'

type ModelConfigForm = Pick<SaveWebModelConfigInput, 'baseURL' | 'model'>

export function resetProviderFields(form: ModelConfigForm, provider: WebAIProvider): void {
  if (provider === 'deepseek') {
    form.baseURL = 'https://api.deepseek.com'
    form.model = 'deepseek-v4-flash'
  } else {
    form.baseURL = ''
    form.model = ''
  }
}
