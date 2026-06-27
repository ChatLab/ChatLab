import path from 'node:path'

export const CONTACTS_DIR_NAME = 'contacts'
export const CONTACTS_FACTS_DIR_NAME = 'facts'

export function getContactsDir(userDataDir: string): string {
  return path.join(userDataDir, CONTACTS_DIR_NAME)
}

export function getContactsFactsCacheDir(userDataDir: string): string {
  return path.join(getContactsDir(userDataDir), CONTACTS_FACTS_DIR_NAME)
}
