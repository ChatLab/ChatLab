import path from 'node:path'

export const PEOPLE_DIR_NAME = 'people'
export const RELATIONSHIPS_DIR_NAME = 'relationships'
export const RELATIONSHIPS_FACTS_DIR_NAME = 'facts'

export function getPeopleRelationshipsDir(userDataDir: string): string {
  return path.join(userDataDir, PEOPLE_DIR_NAME, RELATIONSHIPS_DIR_NAME)
}

export function getPeopleRelationshipsFactsCacheDir(userDataDir: string): string {
  return path.join(getPeopleRelationshipsDir(userDataDir), RELATIONSHIPS_FACTS_DIR_NAME)
}
