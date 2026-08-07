import { watch, type WatchSource, type WatchStopHandle } from 'vue'

/**
 * Watch an overlay that may be mounted only after its visibility state is true.
 * The immediate run ensures lazy-mounted overlays consume their opening payload.
 */
export function watchLazyOverlayVisibility(
  source: WatchSource<boolean>,
  onChange: (visible: boolean) => void | Promise<void>
): WatchStopHandle {
  return watch(source, onChange, { immediate: true })
}
