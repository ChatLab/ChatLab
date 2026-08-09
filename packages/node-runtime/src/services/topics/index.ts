export { CHAT_TOPICS_DB_FILENAME, getChatTopicsDbPath, getChatTopicsDir } from './paths'
export {
  applyTopicFinalization,
  applyTopicOperations,
  createEmptyTopicLedger,
  materializeChatTopics,
  parseTopicLedger,
  serializeTopicLedger,
} from './ledger'
export type { TopicFinalization, TopicLedger, TopicLedgerItem, TopicModelOperation } from './ledger'
export {
  CHAT_TOPICS_ALGORITHM_VERSION,
  CHAT_TOPICS_PROMPT_VERSION,
  buildTopicBlockPrompt,
  buildTopicFinalizationPrompt,
  parseTopicFinalizationResponse,
  parseTopicOperationsResponse,
} from './model-protocol'
export { createChatTopicModelClient } from './model-client'
export type { ChatTopicModelClient, ChatTopicModelResult } from './model-client'
export { createChatTopicService } from './service'
export type { ChatTopicService, ChatTopicServiceDeps } from './service'
export { chatTopicWorkCoordinator } from './work-coordinator'
export {
  TOPIC_BLOCK_MAX_CHARS,
  TOPIC_BLOCK_MAX_MESSAGES,
  chunkTopicMessages,
  createTopicPreflight,
  createTopicSourceSignature,
  getTopicChatType,
  loadTopicSourceDay,
} from './source'
export type { TopicChatType, TopicSourceBlock, TopicSourceDay, TopicSourceMessage } from './source'
export { ChatTopicStore, deleteSessionChatTopics } from './store'
export type { FinalizeTopicDayInput, TopicDayCheckpoint } from './store'
export {
  assertValidTimezone,
  assertValidTopicDayKey,
  enumerateTopicDays,
  formatTopicDayKey,
  getTopicDayRange,
} from './time'
export type { TopicDayRange } from './time'
