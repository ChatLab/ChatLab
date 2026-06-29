type RouteParamValue = string | string[]

interface PageTransitionRoute {
  matched: Array<{ path: string }>
  params: Record<string, RouteParamValue>
}

function formatRouteParam(value: RouteParamValue): string {
  return Array.isArray(value) ? value.join(',') : value
}

export function resolvePageTransitionKey(route: PageTransitionRoute): string {
  const topLevelPath = route.matched[0]?.path ?? ''
  if (!topLevelPath) return ''

  const dynamicParams = Object.entries(route.params)
    .filter(([key]) => topLevelPath.includes(`:${key}`))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => formatRouteParam(value))

  return dynamicParams.length > 0 ? `${topLevelPath}:${dynamicParams.join('&')}` : topLevelPath
}
