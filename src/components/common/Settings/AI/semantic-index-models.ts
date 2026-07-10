/**
 * 语义索引向量模型选项（本地模型 + API 模板），供设置区块与模型配置弹窗共享。
 */

export interface LocalModelOption {
  modelId: string
  name: string
  approxMB: number
  recommended: boolean
  /** 仅中文 UI 展示 */
  zhOnly: boolean
}

export const LOCAL_MODELS: LocalModelOption[] = [
  {
    modelId: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    name: 'Qwen3-Embedding-0.6B',
    approxMB: 593,
    recommended: true,
    zhOnly: false,
  },
  { modelId: 'Xenova/bge-base-zh-v1.5', name: 'BGE base zh', approxMB: 390, recommended: false, zhOnly: true },
]

export interface ApiTemplate {
  id: string
  label: string
  baseUrl: string
  model: string
  /** 仅中文 locale 展示（中国区服务商，海外用户一般用不到） */
  zhOnly?: boolean
}

export const API_TEMPLATES: ApiTemplate[] = [
  { id: 'openai-compatible', label: 'OpenAI Compatible', baseUrl: '', model: '' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'nomic-embed-text' },
  {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'text-embedding-v3',
    zhOnly: true,
  },
  { id: 'zhipu', label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'embedding-3', zhOnly: true },
  { id: 'siliconflow', label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' },
]

/** 模型配置弹窗确认时回传给父组件的草稿（父组件负责落库并触发重建判定） */
export interface ModelConfigDraft {
  mode: 'local' | 'api'
  localModelId: string
  localDownloadSource: 'huggingface' | 'hf-mirror'
  apiBaseUrl: string
  apiModel: string
  apiKey: string
}
