export interface PixiRemovableChildrenContainer {
  removeChildren(): PixiDestroyableChild[]
}

export interface PixiDestroyableChild {
  destroy(options?: { children?: boolean }): void
}

export function destroyRemovedPixiChildren(container: PixiRemovableChildrenContainer): void {
  // Pixi 的 removeChildren 只脱离 display objects；重绘前需要递归销毁旧层，避免 listener/GPU 资源残留。
  for (const child of container.removeChildren()) {
    child.destroy({ children: true })
  }
}
