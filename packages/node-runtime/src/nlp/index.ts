/**
 * NLP 模块（Node.js 实现）
 *
 * 分词引擎、词频统计、词库管理的 Node.js 实现。
 * 平台无关的类型和数据从 @openchatlab/core 导出。
 */

// 分词引擎
export {
  initNlpDir,
  getNlpDir,
  getJieba,
  clearJiebaInstance,
  segment,
  batchSegmentWithFrequency,
  collectPosTagStats,
  getPosTagDefinitions,
} from './segmenter'

// 词频统计
export { computeWordFrequency, segmentText } from './word-frequency'

// 词库管理
export {
  isDictDownloaded,
  getDictList,
  loadDictBuffer,
  downloadDict,
  deleteDict,
  ensureDefaultDict,
} from './dict-manager'
