/**
 * 助手模块入口
 */

export type {
  AssistantConfig,
  AssistantSummary,
  AssistantInitResult,
  AssistantSaveResult,
  BuiltinAssistantInfo,
} from '@openchatlab/node-runtime'
export {
  initAssistantManager,
  getAllAssistants,
  getAssistantConfig,
  hasAssistant,
  updateAssistant,
  createAssistant,
  deleteAssistant,
  resetAssistant,
  getBuiltinCatalog,
  importAssistant,
  reimportAssistant,
  importAssistantFromMd,
  isGeneralAssistant,
} from './manager'
export { parseAssistantFile, serializeAssistant } from '@openchatlab/node-runtime'
