export interface GalaxyNodeMotionOptions {
  elapsedMs: number
  seed: number
  selected: boolean
}

export interface GalaxyNodeMotion {
  scale: number
  offsetX: number
  offsetY: number
  haloAlpha: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function wave(elapsedMs: number, seed: number, periodMs: number): number {
  return Math.sin((elapsedMs / periodMs + seed) * Math.PI * 2)
}

export function createGalaxyAnimationSeed(key: string): number {
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}

export function resolveGalaxyNodeMotion(options: GalaxyNodeMotionOptions): GalaxyNodeMotion {
  // 统一延长动画周期，使得呼吸和漂移更柔和，频率降低约一倍
  const primary = wave(options.elapsedMs, options.seed, options.selected ? 3600 : 5200)
  // 漂移周期统一使用长周期，保证选中节点的偏移幅度和非选中节点呈稳定比例，且在任何时间点 selected 节点的偏移都小于等于 normal 节点
  const secondary = wave(options.elapsedMs, options.seed + 0.37, 6000)
  const drift = options.selected ? 0.6 : 1.0

  return {
    // 缩减缩放呼吸幅度，更加克制
    scale: clamp(1 + primary * (options.selected ? 0.02 : 0.01), 0.97, 1.03),
    offsetX: secondary * drift,
    offsetY: wave(options.elapsedMs, options.seed + 0.71, 7000) * drift,
    // 保持 halo 强弱对比，以便选中状态在视觉上脱颖而出
    haloAlpha: clamp((options.selected ? 0.35 : 0.08) + primary * (options.selected ? 0.06 : 0.02), 0.05, 0.45),
  }
}
