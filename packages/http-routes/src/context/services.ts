import type {
  AnalyticsService,
  ContactsService,
  GlobalInsightService,
  PeopleRelationshipsService,
  PreferencesManager,
} from '@openchatlab/node-runtime'

/** Optional shared services used by individual Web route domains. */
export interface ServiceRouteContext {
  contactsService?: ContactsService
  peopleRelationshipsService?: PeopleRelationshipsService
  globalInsightService?: GlobalInsightService
  preferencesManager?: PreferencesManager
  analyticsService?: AnalyticsService
}
