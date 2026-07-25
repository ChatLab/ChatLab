const DEMO_ORIGIN = 'https://chatlab.fun/assets/demo'
const DEMO_LOCALES = new Set(['cn', 'en'])
const DEMO_FILES = new Set([
  'demo-group.json',
  'demo-private-A-cuilan.json',
  'demo-private-B-wukong.json',
  'demo-private-C-spider.json',
])

export async function proxyDemoRequest(context, fetchRemote = fetch) {
  const rawPath = Array.isArray(context.params.path) ? context.params.path.join('/') : String(context.params.path || '')
  const [locale, filename, ...extra] = rawPath.split('/')
  if (extra.length > 0 || !DEMO_LOCALES.has(locale) || !DEMO_FILES.has(filename)) {
    return new Response('Not found', { status: 404 })
  }

  try {
    const upstream = await fetchRemote(`${DEMO_ORIGIN}/${locale}/${filename}`)
    if (!upstream.ok || !upstream.body) {
      return new Response('Demo asset unavailable', { status: upstream.status || 502 })
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return new Response('Demo asset unavailable', { status: 502 })
  }
}

export function onRequestGet(context) {
  return proxyDemoRequest(context)
}
