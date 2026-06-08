import { mock, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_TOOL_CATALOG } from '@openchatlab/core'

type MinEntry = { name: string; category: string }

describe('Electron TOOL_REGISTRY', () => {
  it('covers all BUILTIN_TOOL_CATALOG entries with correct name and category', async () => {
    const recorded: MinEntry[] = []

    // Mock the Electron-specific adapter module before loading the registry.
    // This prevents @openchatlab/node-runtime (pi-ai) and electron from being
    // resolved in the test environment, which lacks those native bindings.
    await mock.module('../shared-tool-adapter', {
      namedExports: {
        adaptSharedTool(tool: { name: string }, opts: { category: string }) {
          const entry = { name: tool.name, category: opts.category, factory: () => ({}) }
          recorded.push(entry)
          return entry
        },
      },
    })

    // Dynamic import keeps the mock active before the module graph resolves.
    const { TOOL_REGISTRY } = (await import('./index.js')) as { TOOL_REGISTRY: MinEntry[] }

    // Drift guard: every tool in BUILTIN_TOOL_CATALOG must appear in TOOL_REGISTRY
    // with the correct name and category.
    const registeredMap = new Map(TOOL_REGISTRY.map((e) => [e.name, e.category]))
    const mismatches = BUILTIN_TOOL_CATALOG.filter((e) => registeredMap.get(e.name) !== e.category).map(
      (e) => `${e.name} (expected category=${e.category}, got ${registeredMap.get(e.name) ?? 'missing'})`
    )
    assert.deepEqual(mismatches, [], `catalog/registry drift in Electron TOOL_REGISTRY: ${mismatches.join(', ')}`)
  })
})
