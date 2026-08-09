import path from 'node:path'

export const CHAT_TOPICS_DB_FILENAME = 'topics.db'

export function getChatTopicsDir(userDataDir: string): string {
  return path.join(userDataDir, 'insight')
}

export function getChatTopicsDbPath(userDataDir: string): string {
  return path.join(getChatTopicsDir(userDataDir), CHAT_TOPICS_DB_FILENAME)
}
