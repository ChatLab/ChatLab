import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { NavigationLayout } from '@openchatlab/shared-types'
import { desktopCliWebNavigationLayout } from '@/plugins/desktop-cli-web'
import { redirectFromHiddenInsightPage } from './router'

const entryIds = {
  annualSummary: 'insight.annual-summary',
  relationshipChanges: 'insight.relationship-changes',
  timeInvestment: 'insight.time-investment',
} as const

test('redirects a hidden current Insight page to the first visible entry and falls back home when all are hidden', async (t) => {
  t.after(() => desktopCliWebNavigationLayout.applyDefaultLayout())
  const view = { template: '<div />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: view },
      {
        path: '/annual-summary',
        name: 'insight-annual-summary',
        component: view,
        meta: { insightPageId: 'annual-summary' },
      },
      {
        path: '/time-investment',
        name: 'insight-time-investment',
        component: view,
        meta: { insightPageId: 'time-investment' },
      },
    ],
  })
  await router.push({ name: 'insight-annual-summary' })

  const timeInvestmentOnly: NavigationLayout = {
    schemaVersion: 1,
    primary: [{ kind: 'entry', entryId: entryIds.timeInvestment }],
    hiddenEntryIds: [entryIds.annualSummary, entryIds.relationshipChanges],
  }
  desktopCliWebNavigationLayout.applySavedLayout(timeInvestmentOnly)
  await redirectFromHiddenInsightPage(router, desktopCliWebNavigationLayout)
  assert.equal(router.currentRoute.value.name, 'insight-time-investment')

  const allHidden: NavigationLayout = {
    schemaVersion: 1,
    primary: [],
    hiddenEntryIds: Object.values(entryIds),
  }
  desktopCliWebNavigationLayout.applySavedLayout(allHidden)
  await redirectFromHiddenInsightPage(router, desktopCliWebNavigationLayout)
  assert.equal(router.currentRoute.value.name, 'home')
})
