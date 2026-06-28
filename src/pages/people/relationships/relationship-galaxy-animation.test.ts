/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-animation.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { createGalaxyAnimationSeed, resolveGalaxyNodeMotion } from './relationship-galaxy-animation'

test('creates deterministic animation seeds for stable graph keys', () => {
  assert.equal(createGalaxyAnimationSeed('weixin:alice'), createGalaxyAnimationSeed('weixin:alice'))
  assert.notEqual(createGalaxyAnimationSeed('weixin:alice'), createGalaxyAnimationSeed('weixin:bob'))
})

test('keeps node motion inside a small visual-only range', () => {
  const seed = createGalaxyAnimationSeed('weixin:alice')
  const early = resolveGalaxyNodeMotion({ elapsedMs: 120, seed, selected: false })
  const late = resolveGalaxyNodeMotion({ elapsedMs: 1120, seed, selected: false })

  assert.ok(early.scale >= 0.96 && early.scale <= 1.06)
  assert.ok(late.scale >= 0.96 && late.scale <= 1.06)
  assert.ok(Math.abs(early.offsetX) <= 1.8)
  assert.ok(Math.abs(early.offsetY) <= 1.8)
  assert.notEqual(early.scale, late.scale)
})

test('gives selected nodes a stronger pulse', () => {
  const seed = createGalaxyAnimationSeed('weixin:alice')
  const normalNode = resolveGalaxyNodeMotion({ elapsedMs: 360, seed, selected: false })
  const selectedNode = resolveGalaxyNodeMotion({ elapsedMs: 360, seed, selected: true })

  assert.ok(selectedNode.haloAlpha > normalNode.haloAlpha)
  assert.ok(Math.abs(selectedNode.offsetX) <= Math.abs(normalNode.offsetX))
})
