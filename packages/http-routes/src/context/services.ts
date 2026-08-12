import type {
  AnalyticsService,
  ContactsService,
  GlobalInsightService,
  TimeInvestmentService,
  PeopleRelationshipsService,
  PreferencesManager,
  NavigationLayoutService,
} from '@openchatlab/node-runtime'

/** Optional shared services used by individual Web route domains. */
export interface ServiceRouteContext {
  contactsService?: ContactsService
  peopleRelationshipsService?: PeopleRelationshipsService
  globalInsightService?: GlobalInsightService
  timeInvestmentService?: TimeInvestmentService
  preferencesManager?: PreferencesManager
  analyticsService?: AnalyticsService
  navigationLayoutService?: NavigationLayoutService
}
