export function createLazyAvatarObserver(
  target: Element,
  onVisible: () => void,
  options: IntersectionObserverInit = {}
): () => void {
  let loaded = false
  let observer: IntersectionObserver | null = null

  const loadOnce = () => {
    if (loaded) return
    loaded = true
    onVisible()
    observer?.disconnect()
    observer = null
  }

  if (typeof IntersectionObserver === 'undefined') {
    loadOnce()
    return () => {}
  }

  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
        loadOnce()
      }
    },
    {
      rootMargin: '160px 0px',
      threshold: 0,
      ...options,
    }
  )

  observer.observe(target)

  return () => {
    observer?.disconnect()
    observer = null
  }
}
