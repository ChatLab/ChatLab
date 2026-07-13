import type { BatchSegmentOptions, SupportedLocale } from '@openchatlab/core'
import { executeRegistryTool, type AiToolExecuteRequest, type AiToolExecuteResult } from '@openchatlab/http-routes'
import { batchSegmentWithFrequency } from '@openchatlab/node-runtime'
import type { SemanticSearchToolService } from '@openchatlab/tools'
import { t as i18nT } from '../../i18n'
import { WorkerDataProvider } from './worker-data-provider'

/**
 * 构造 Electron 手动调试用的 AI 工具执行器。
 *
 * 注入 semanticIndexService，使手动执行语义检索工具与正常 Agent stream 行为一致；
 * 缺失时（向量库不可用）语义工具会优雅返回不可用。其余依赖（Worker 数据访问、分词、
 * i18n 模板）为 Electron 平台特有，统一在此装配后委托给平台无关的执行核心。
 */
export function createExecuteElectronAiTool(
  semanticIndexService?: SemanticSearchToolService
): (params: AiToolExecuteRequest) => Promise<AiToolExecuteResult> {
  return (params) =>
    executeRegistryTool(params, {
      dataProvider: new WorkerDataProvider(params.sessionId, params.abortSignal),
      semanticIndexService,
      segmentText: (texts, locale, options) =>
        batchSegmentWithFrequency(texts, locale as SupportedLocale, options as BatchSegmentOptions),
      translateTemplate: (key: string) => {
        const translated = i18nT(key)
        return translated !== key ? translated : undefined
      },
    })
}
