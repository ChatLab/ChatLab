export { PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION, computePeopleRelationshipsSnapshot } from './compute'
export type {
  PeopleRelationshipsComputeLimits,
  PeopleRelationshipsComputeProgress,
  PeopleRelationshipsSnapshot,
} from './compute'
export { createPeopleRelationshipsService } from './service'
export type {
  PeopleRelationshipsComputeRunner,
  PeopleRelationshipsService,
  PeopleRelationshipsServiceDeps,
  PeopleRelationshipsServiceOptions,
} from './service'
export { getPeopleRelationshipsDir, getPeopleRelationshipsFactsCacheDir } from './paths'
