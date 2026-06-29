/**
 * Tests for Pixi relationship galaxy layer cleanup.
 *
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-pixi-layers.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { destroyRemovedPixiChildren } from './relationship-galaxy-pixi-layers'

test('destroys removed Pixi children recursively when clearing a container', () => {
  const destroyedOptions: unknown[] = []
  const removedChildren = [
    {
      destroy: (options?: unknown) => {
        destroyedOptions.push(options)
      },
    },
    {
      destroy: (options?: unknown) => {
        destroyedOptions.push(options)
      },
    },
  ]

  const container = {
    removeChildren: () => removedChildren,
  }

  destroyRemovedPixiChildren(container)

  assert.deepEqual(destroyedOptions, [{ children: true }, { children: true }])
})
