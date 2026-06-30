<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Application, Container, Graphics, Text } from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import type { PeopleRelationshipGraphNode, PeopleRelationshipsGraphData } from '@openchatlab/shared-types'
import { createGalaxyAnimationSeed, resolveGalaxyNodeMotion } from '../relationship-galaxy-animation'
import {
  buildRelationshipVisibleGraphForSelection,
  buildRelationshipVisibleLabelKeys,
} from '../relationship-galaxy-connections'
import { destroyRemovedPixiChildren } from '../relationship-galaxy-pixi-layers'
import {
  buildRelationshipGalaxy2DSafeCenter,
  buildRelationshipGalaxy2DSafeFitScale,
} from '../relationship-galaxy-viewport'
import { maskRelationshipGalaxyPrivateText } from '../relationship-galaxy-privacy'

interface Ripple {
  graphic: Graphics
  x: number
  y: number
  radius: number
  maxRadius: number
  color: number
  alpha: number
}

interface AnimatedNode {
  graphic: Graphics
  label?: any
  baseX: number
  baseY: number
  labelBaseY: number
  seed: number
  selected: boolean
  startX: number
  startY: number
  targetX: number
  targetY: number
  key: string
  radius: number
  color: number
  pool: string
  isOwner: boolean
  selectedNeighbor: boolean
  dimmedBySelection: boolean
  currentAlpha: number
  currentScale: number
}

interface RelationshipGalaxy2DViewState {
  kind: '2d'
  center: { x: number; y: number }
  scale: number
  hasUserMovedViewport: boolean
}

const props = withDefaults(
  defineProps<{
    graph: PeopleRelationshipsGraphData
    selectedKey?: string | null
    privacyMode?: boolean
    safeInsetRight?: number
    label: string
    ownerLabel: string
  }>(),
  {
    selectedKey: null,
    privacyMode: false,
    safeInsetRight: 0,
  }
)

const emit = defineEmits<{
  (event: 'select-node', node: PeopleRelationshipGraphNode): void
}>()

const canvasRoot = ref<HTMLElement | null>(null)

let pixiApp: Application | null = null
let viewport: Viewport | null = null
let backgroundLayer: Graphics | null = null
let backgroundStarsLayer: Graphics | null = null
let resizeObserver: ResizeObserver | null = null
let hasUserMovedViewport = false
let animationStartedAt = 0
let pendingFocusKey: string | null = null

const renderedNodePositions = new Map<string, { x: number; y: number }>()
const animatedNodes: AnimatedNode[] = []

const hoveredKey = ref<string | null>(null)
const neighborKeysOf = new Map<string, Set<string>>()
const activeRipples: Ripple[] = []
let entranceProgress = 0
let edgeLayer: Graphics | null = null
let highlightEdgeLayer: Graphics | null = null

function colorToNumber(color: string | null | undefined, fallback: number): number {
  if (!color) return fallback
  const normalized = color.startsWith('#') ? color.slice(1) : color
  const parsed = Number.parseInt(normalized, 16)
  return Number.isFinite(parsed) ? parsed : fallback
}

function shortName(node: PeopleRelationshipGraphNode): string {
  if (node.kind === 'owner') return props.ownerLabel
  const name = node.displayName || node.platformId || node.key
  return props.privacyMode ? maskRelationshipGalaxyPrivateText(name) : name
}

function getNodeColor(node: PeopleRelationshipGraphNode): number {
  if (node.pool === 'friend') return colorToNumber(node.color, 0x38bdf8)
  return colorToNumber(node.color, 0xf59e0b)
}

function getViewportSize(): { width: number; height: number } {
  const rect = canvasRoot.value?.getBoundingClientRect()
  return {
    width: Math.max(1, Math.floor(rect?.width ?? 1)),
    height: Math.max(1, Math.floor(rect?.height ?? 1)),
  }
}

function getGraphBounds(nodes: PeopleRelationshipGraphNode[]) {
  if (nodes.length === 0) {
    return { minX: -500, minY: -500, maxX: 500, maxY: 500, width: 1000, height: 1000 }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x)
    maxY = Math.max(maxY, node.y)
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(800, maxX - minX),
    height: Math.max(800, maxY - minY),
  }
}

function drawBackground() {
  if (!backgroundLayer || !backgroundStarsLayer) return

  const { width, height } = getViewportSize()
  backgroundLayer.clear()
  backgroundStarsLayer.clear()

  // 1. 深邃的太空底色，带有一丝冷靛蓝
  backgroundLayer.rect(0, 0, width, height).fill({ color: 0x04060b, alpha: 1 })

  // 2. 模拟非常微弱、不规则的星团起伏（极低不透明度的三色渐变圆，仅供冷暖微弱交织）
  const nebulaColors = [
    0x0a1631, // 深靛蓝
    0x140a28, // 深紫
    0x061c28, // 青蓝
  ]

  for (let i = 0; i < 8; i++) {
    const progress = i / 8
    const centerX = width * (0.2 + progress * 0.6) + Math.sin(progress * Math.PI) * width * 0.1
    const centerY = height * (0.3 + (1 - progress) * 0.4) + Math.cos(progress * Math.PI) * height * 0.08
    const maxRadius = Math.max(width, height) * (0.2 + (i % 3) * 0.04)
    const color = nebulaColors[i % nebulaColors.length]

    const steps = 4
    for (let step = 0; step < steps; step++) {
      const r = maxRadius * (1 - step / steps)
      const a = ((0.012 * (step + 1)) / steps) * 0.5
      backgroundLayer.circle(centerX, centerY, r).fill({ color, alpha: a })
    }
  }

  // 3. 极少量远景微星（用于烘托宇宙静谧氛围，数量极少以防显得粗糙）
  const starCount = Math.min(80, Math.max(30, Math.floor((width * height) / 18000)))
  for (let i = 0; i < starCount; i++) {
    const x = (i * 253.117 + 83) % width
    const y = (i * 123.643 + 47) % height

    const size = i % 8 === 0 ? 1.0 : 0.65
    const alpha = i % 5 === 0 ? 0.35 : i % 2 === 0 ? 0.18 : 0.1
    const color = 0xdbeafe // 淡淡的冰蓝白

    backgroundStarsLayer.circle(x, y, size).fill({ color, alpha })
  }
}

interface NodeSelectionState {
  active: boolean
  selected: boolean
  neighbor: boolean
}

function shouldShowLabel(
  node: PeopleRelationshipGraphNode,
  totalNodes: number,
  state: NodeSelectionState,
  visibleLabelKeys: Set<string> | null
): boolean {
  if (state.active) return Boolean(visibleLabelKeys?.has(node.key))
  if (node.labelVisibility === 2) return true
  return node.labelVisibility === 1 && totalNodes <= 500
}

function createLabel(node: PeopleRelationshipGraphNode, radius: number, state: NodeSelectionState): Text {
  const label = new Text({
    text: shortName(node),
    style: {
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontSize: state.selected ? 13 : state.neighbor ? 11.5 : 11,
      fontWeight: state.selected ? '700' : '600',
      fill: state.selected ? 0xffffff : state.neighbor ? 0xf7dfb4 : 0xd7e2f1,
      align: 'center',
      dropShadow: {
        color: 0x000000,
        alpha: 0.8,
        blur: 4,
        distance: 1,
      },
    },
  })
  label.anchor.set(0.5, 0)
  label.position.set(0, radius + 5)
  label.resolution = 2
  return label
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3)
}

function triggerRipple(x: number, y: number, radius: number, color: number) {
  if (!viewport) return
  const rippleG = new Graphics()
  viewport.addChild(rippleG)
  activeRipples.push({
    graphic: rippleG,
    x,
    y,
    radius: 4,
    maxRadius: Math.max(28, radius * 3.5),
    color,
    alpha: 0.7,
  })
}

function drawHighlightEdges() {
  if (!highlightEdgeLayer || !viewport) return
  highlightEdgeLayer.clear()

  const visibleGraph = buildRelationshipVisibleGraphForSelection(props.graph, props.selectedKey)
  const nodes = visibleGraph.nodes
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]))
  const hoveredKeyInGraph = hoveredKey.value && nodeByKey.has(hoveredKey.value) ? hoveredKey.value : null
  const selectedKeyInGraph = props.selectedKey && nodeByKey.has(props.selectedKey) ? props.selectedKey : null
  const activeKey = hoveredKeyInGraph || selectedKeyInGraph
  if (!activeKey) {
    if (edgeLayer) edgeLayer.alpha = 1.0
    return
  }

  if (edgeLayer) edgeLayer.alpha = hoveredKeyInGraph ? 0.12 : selectedKeyInGraph ? 0.2 : 1.0

  const bounds = getGraphBounds(nodes)
  const padding = 260
  const offsetX = -bounds.minX + padding
  const offsetY = -bounds.minY + padding

  for (const edge of visibleGraph.edges) {
    if (edge.sourceKey !== activeKey && edge.targetKey !== activeKey) continue

    const source = nodeByKey.get(edge.sourceKey)
    const target = nodeByKey.get(edge.targetKey)
    if (!source || !target) continue

    const sourceX = source.x + offsetX
    const sourceY = source.y + offsetY
    const targetX = target.x + offsetX
    const targetY = target.y + offsetY

    const edgeColor = getNodeColor(source)
    highlightEdgeLayer
      .moveTo(sourceX, sourceY)
      .lineTo(targetX, targetY)
      .stroke({ color: edgeColor, width: 3.0, alpha: 0.16 })
    highlightEdgeLayer
      .moveTo(sourceX, sourceY)
      .lineTo(targetX, targetY)
      .stroke({ color: 0xffffff, width: 1.3, alpha: 0.65 })
  }
}

function renderGraph(shouldFit = false) {
  if (!viewport) return

  destroyRemovedPixiChildren(viewport)
  activeRipples.length = 0
  renderedNodePositions.clear()
  animatedNodes.length = 0
  neighborKeysOf.clear()
  hoveredKey.value = null
  entranceProgress = 0

  const visibleGraph = buildRelationshipVisibleGraphForSelection(props.graph, props.selectedKey)
  const nodes = visibleGraph.nodes
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]))
  const bounds = getGraphBounds(nodes)
  const padding = 260
  const offsetX = -bounds.minX + padding
  const offsetY = -bounds.minY + padding
  const worldWidth = bounds.width + padding * 2
  const worldHeight = bounds.height + padding * 2
  const screen = getViewportSize()

  viewport.resize(screen.width, screen.height, worldWidth, worldHeight)

  edgeLayer = new Graphics()
  highlightEdgeLayer = new Graphics()
  const nodeLayer = new Container()
  const labelLayer = new Container()

  for (const edge of visibleGraph.edges) {
    if (!neighborKeysOf.has(edge.sourceKey)) neighborKeysOf.set(edge.sourceKey, new Set())
    if (!neighborKeysOf.has(edge.targetKey)) neighborKeysOf.set(edge.targetKey, new Set())
    neighborKeysOf.get(edge.sourceKey)!.add(edge.targetKey)
    neighborKeysOf.get(edge.targetKey)!.add(edge.sourceKey)

    const source = nodeByKey.get(edge.sourceKey)
    const target = nodeByKey.get(edge.targetKey)
    if (!source || !target) continue

    const sourceX = source.x + offsetX
    const sourceY = source.y + offsetY
    const targetX = target.x + offsetX
    const targetY = target.y + offsetY

    const alpha = edge.visibility === 2 ? 0.22 : 0.07
    const width = Math.min(1.4, Math.max(0.4, Math.log10(edge.weight + 1) * 0.75))
    const edgeColor = getNodeColor(source)
    edgeLayer.moveTo(sourceX, sourceY).lineTo(targetX, targetY).stroke({ color: edgeColor, width, alpha })
  }

  const selectedKey = props.selectedKey
  const hasActiveSelection = Boolean(selectedKey && nodeByKey.has(selectedKey))
  const selectedNeighborKeys = selectedKey && hasActiveSelection ? neighborKeysOf.get(selectedKey) : null
  const visibleLabelKeys =
    selectedKey && hasActiveSelection ? buildRelationshipVisibleLabelKeys(visibleGraph, selectedKey) : null

  const communityCenters = new Map<string, { x: number; y: number }>()
  const communityCounts = new Map<string, number>()
  for (const node of nodes) {
    const key = node.communityId || 'default'
    if (!communityCenters.has(key)) {
      communityCenters.set(key, { x: 0, y: 0 })
      communityCounts.set(key, 0)
    }
    const center = communityCenters.get(key)!
    center.x += node.x + offsetX
    center.y += node.y + offsetY
    communityCounts.set(key, communityCounts.get(key)! + 1)
  }
  for (const [key, center] of communityCenters.entries()) {
    const count = communityCounts.get(key) || 1
    center.x /= count
    center.y /= count
  }

  for (const node of nodes) {
    const targetX = node.x + offsetX
    const targetY = node.y + offsetY
    const radius = Math.max(3.6, node.size)
    const color = getNodeColor(node)
    const selected = hasActiveSelection && node.key === selectedKey
    const selectedNeighbor = Boolean(hasActiveSelection && selectedNeighborKeys?.has(node.key))
    const dimmedBySelection = hasActiveSelection && !selected && !selectedNeighbor
    const selectionState: NodeSelectionState = {
      active: hasActiveSelection,
      selected,
      neighbor: selectedNeighbor,
    }
    const isOwner = node.kind === 'owner'
    const nodeGraphic = new Graphics()

    renderedNodePositions.set(node.key, { x: targetX, y: targetY })

    const commKey = node.communityId || 'default'
    const center = communityCenters.get(commKey) || { x: screen.width / 2, y: screen.height / 2 }
    const startX = center.x
    const startY = center.y

    if (selected) {
      nodeGraphic.circle(0, 0, radius + 11).fill({ color, alpha: 0.12 })
      nodeGraphic.circle(0, 0, radius + 6).fill({ color: 0xffffff, alpha: 0.18 })
      nodeGraphic.circle(0, 0, radius + 5).stroke({ color: 0xffffff, width: 1.8, alpha: 0.95 })

      const focusDist = radius + 8
      const tickLen = 3.5
      nodeGraphic
        .moveTo(0, -focusDist)
        .lineTo(0, -focusDist - tickLen)
        .stroke({ color: 0xffffff, width: 1.2, alpha: 0.85 })
      nodeGraphic
        .moveTo(0, focusDist)
        .lineTo(0, focusDist + tickLen)
        .stroke({ color: 0xffffff, width: 1.2, alpha: 0.85 })
      nodeGraphic
        .moveTo(-focusDist, 0)
        .lineTo(-focusDist - tickLen, 0)
        .stroke({ color: 0xffffff, width: 1.2, alpha: 0.85 })
      nodeGraphic
        .moveTo(focusDist, 0)
        .lineTo(focusDist + tickLen, 0)
        .stroke({ color: 0xffffff, width: 1.2, alpha: 0.85 })
    } else {
      if (isOwner) {
        nodeGraphic.circle(0, 0, radius + 8).fill({ color: 0xf59e0b, alpha: 0.14 })
        nodeGraphic.circle(0, 0, radius + 4).stroke({ color: 0xf59e0b, width: 1.2, alpha: 0.45 })
      } else if (selectedNeighbor) {
        nodeGraphic.circle(0, 0, radius + 5).stroke({ color: 0xf7dfb4, width: 1.2, alpha: 0.42 })
      } else if (node.pool === 'friend') {
        nodeGraphic.circle(0, 0, radius + 4).fill({ color, alpha: 0.08 })
      }
      if (radius > 7) {
        nodeGraphic.circle(0, 0, radius + 6).fill({ color, alpha: 0.06 })
      }
    }

    const coreColor = isOwner ? 0xf59e0b : color
    const coreAlpha = dimmedBySelection ? 0.36 : selected ? 0.98 : selectedNeighbor ? 0.88 : 0.82
    nodeGraphic.circle(0, 0, radius).fill({ color: coreColor, alpha: coreAlpha })

    if (!selected) {
      nodeGraphic
        .circle(0, 0, radius)
        .stroke({ color: selectedNeighbor ? 0xf7dfb4 : 0xffffff, width: 0.8, alpha: selectedNeighbor ? 0.35 : 0.22 })
    }

    nodeGraphic.circle(-radius * 0.28, -radius * 0.32, Math.max(1.2, radius * 0.34)).fill({
      color: 0xffffff,
      alpha: dimmedBySelection ? 0.1 : selected ? 0.55 : selectedNeighbor ? 0.34 : 0.28,
    })

    nodeGraphic.position.set(startX, startY)
    nodeGraphic.eventMode = 'static'
    nodeGraphic.cursor = 'pointer'

    nodeGraphic.on('pointertap', () => {
      triggerRipple(nodeGraphic.x, nodeGraphic.y, radius, color)
      emit('select-node', node)
    })

    nodeGraphic.on('pointerover', () => {
      hoveredKey.value = node.key
    })
    nodeGraphic.on('pointerout', () => {
      hoveredKey.value = null
    })

    nodeLayer.addChild(nodeGraphic)

    const animatedNode: AnimatedNode = {
      graphic: nodeGraphic,
      baseX: startX,
      baseY: startY,
      labelBaseY: startY + radius + 4,
      seed: createGalaxyAnimationSeed(node.key),
      selected,
      startX,
      startY,
      targetX,
      targetY,
      key: node.key,
      radius,
      color,
      pool: node.pool,
      isOwner,
      selectedNeighbor,
      dimmedBySelection,
      currentAlpha: dimmedBySelection ? 0.16 : selected ? 0.98 : selectedNeighbor ? 0.88 : 0.82,
      currentScale: 1.0,
    }
    animatedNodes.push(animatedNode)

    if (shouldShowLabel(node, nodes.length, selectionState, visibleLabelKeys)) {
      const label = createLabel(node, radius, selectionState)

      if (selected) {
        const labelBg = new Graphics()
        const bgPaddingX = 6
        const bgPaddingY = 3
        const bgWidth = label.width + bgPaddingX * 2
        const bgHeight = label.height + bgPaddingY * 2

        labelBg
          .roundRect(-bgWidth / 2, -bgPaddingY, bgWidth, bgHeight, 5)
          .fill({ color: 0x0c111d, alpha: 0.8 })
          .stroke({ color: 0xffffff, width: 1, alpha: 0.18 })

        const labelContainer = new Container()
        labelContainer.position.set(startX, startY + radius + 4)

        label.position.set(0, 0)
        labelContainer.addChild(labelBg)
        labelContainer.addChild(label)
        labelLayer.addChild(labelContainer)

        animatedNode.label = labelContainer as any
        animatedNode.labelBaseY = startY + radius + 4
      } else {
        label.position.set(startX, startY + radius + 4)
        labelLayer.addChild(label)
        animatedNode.label = label
      }
    }
  }

  viewport.addChild(edgeLayer)
  viewport.addChild(highlightEdgeLayer)
  viewport.addChild(nodeLayer)
  viewport.addChild(labelLayer)

  drawHighlightEdges()

  if (shouldFit || !hasUserMovedViewport) {
    viewport.fitWorld(true)
    if (viewport.scaled > 1.18) viewport.setZoom(1.18, true)
    const safeScale = buildRelationshipGalaxy2DSafeFitScale(viewport.scaled, {
      viewportWidth: screen.width,
      safeInsetRight: props.safeInsetRight,
    })
    if (safeScale < viewport.scaled) viewport.setZoom(safeScale, true)
    viewport.moveCenter(
      buildRelationshipGalaxy2DSafeCenter(viewport.center, {
        viewportWidth: screen.width,
        safeInsetRight: props.safeInsetRight,
        scale: viewport.scaled,
      })
    )
  }

  resolvePendingFocus()
}

function updateGalaxyAnimation() {
  if (!pixiApp) return
  const elapsedMs = performance.now() - animationStartedAt

  if (backgroundStarsLayer) {
    backgroundStarsLayer.position.set(Math.sin(elapsedMs / 16_000) * 8, Math.cos(elapsedMs / 19_000) * 5)
  }

  if (entranceProgress < 1.0) {
    entranceProgress = Math.min(1.0, entranceProgress + 0.035)
    const t = easeOutCubic(entranceProgress)
    for (const node of animatedNodes) {
      node.baseX = node.startX + (node.targetX - node.startX) * t
      node.baseY = node.startY + (node.targetY - node.startY) * t
      node.labelBaseY = node.baseY + node.radius + 4
    }
  }

  for (let i = activeRipples.length - 1; i >= 0; i--) {
    const r = activeRipples[i]
    r.radius += (r.maxRadius - r.radius) * 0.15
    r.alpha -= 0.035

    r.graphic.clear()
    r.graphic.circle(r.x, r.y, r.radius).stroke({ color: r.color, width: 1.2, alpha: r.alpha })

    if (r.alpha > 0.15) {
      r.graphic.circle(r.x, r.y, r.radius * 1.25).stroke({ color: r.color, width: 0.8, alpha: r.alpha * 0.4 })
    }

    if (r.alpha <= 0 || r.radius >= r.maxRadius - 1) {
      viewport?.removeChild(r.graphic)
      r.graphic.destroy()
      activeRipples.splice(i, 1)
    }
  }

  for (const node of animatedNodes) {
    const motion = resolveGalaxyNodeMotion({ elapsedMs, seed: node.seed, selected: node.selected })

    let targetAlpha = node.dimmedBySelection ? 0.14 : node.selected ? 0.98 : node.selectedNeighbor ? 0.9 : 0.82
    let targetScale = motion.scale * (node.dimmedBySelection ? 0.9 : node.selectedNeighbor ? 1.03 : 1)

    if (hoveredKey.value) {
      if (node.key === hoveredKey.value) {
        targetAlpha = 1.0
        targetScale = motion.scale * 1.18
      } else if (neighborKeysOf.get(hoveredKey.value)?.has(node.key)) {
        targetAlpha = 0.9
        targetScale = motion.scale * 1.05
      } else {
        targetAlpha = 0.12
        targetScale = motion.scale * 0.82
      }
    }

    node.currentAlpha += (targetAlpha - node.currentAlpha) * 0.16
    node.currentScale += (targetScale - node.currentScale) * 0.16

    node.graphic.position.set(node.baseX + motion.offsetX, node.baseY + motion.offsetY)
    node.graphic.scale.set(node.currentScale)
    node.graphic.alpha = Math.min(1, node.currentAlpha + motion.haloAlpha * (node.dimmedBySelection ? 0.04 : 0.12))

    if (node.label) {
      node.label.position.set(node.baseX + motion.offsetX, node.labelBaseY + motion.offsetY)
      const labelAlpha = node.selected ? 1 : node.selectedNeighbor ? 0.9 : 0.82
      node.label.alpha = Math.min(1, labelAlpha + motion.haloAlpha * 0.35)
    }
  }
}

async function initCanvas() {
  const host = canvasRoot.value
  if (!host || pixiApp) return

  const app = new Application()
  await app.init({
    resizeTo: host,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: 'webgl',
  })

  if (!canvasRoot.value || pixiApp) {
    app.destroy({ removeView: true }, true)
    return
  }

  pixiApp = app
  host.appendChild(app.canvas)
  app.canvas.className = 'h-full w-full'

  backgroundLayer = new Graphics()
  backgroundStarsLayer = new Graphics()
  app.stage.addChild(backgroundLayer)
  app.stage.addChild(backgroundStarsLayer)

  const size = getViewportSize()
  viewport = new Viewport({
    screenWidth: size.width,
    screenHeight: size.height,
    worldWidth: 1000,
    worldHeight: 1000,
    events: app.renderer.events,
    ticker: app.ticker,
  })
  viewport.drag().pinch().wheel().decelerate().clampZoom({ minScale: 0.04, maxScale: 2.8 })
  viewport.on('moved', () => {
    hasUserMovedViewport = true
  })
  viewport.on('zoomed', () => {
    hasUserMovedViewport = true
  })
  app.stage.addChild(viewport)

  drawBackground()
  renderGraph(true)
  animationStartedAt = performance.now()
  app.ticker.add(updateGalaxyAnimation)

  resizeObserver = new ResizeObserver(() => {
    drawBackground()
    renderGraph(!hasUserMovedViewport)
  })
  resizeObserver.observe(host)
}

function resolvePendingFocus() {
  if (!pendingFocusKey) return
  const key = pendingFocusKey
  if (!renderedNodePositions.has(key)) {
    pendingFocusKey = null
    return
  }
  focusNode(key)
}

function focusNode(key: string): boolean {
  const position = renderedNodePositions.get(key)
  if (!position || !viewport) {
    pendingFocusKey = key
    return false
  }

  pendingFocusKey = null
  hasUserMovedViewport = true
  const nextScale = Math.min(Math.max(viewport.scaled, 0.45), 1.55)
  const screen = getViewportSize()
  const nextPosition = buildRelationshipGalaxy2DSafeCenter(position, {
    viewportWidth: screen.width,
    safeInsetRight: props.safeInsetRight,
    scale: nextScale,
  })
  viewport.animate({
    position: nextPosition,
    scale: nextScale,
    time: 420,
    ease: 'easeInOutSine',
  })
  return true
}

function captureView(): RelationshipGalaxy2DViewState | null {
  if (!viewport) return null
  return {
    kind: '2d',
    center: { x: viewport.center.x, y: viewport.center.y },
    scale: viewport.scaled,
    hasUserMovedViewport,
  }
}

function restoreView(view: unknown): boolean {
  if (!is2DViewState(view) || !viewport) return false

  pendingFocusKey = null
  hasUserMovedViewport = view.hasUserMovedViewport
  viewport.animate({
    position: view.center,
    scale: view.scale,
    time: 420,
    ease: 'easeInOutSine',
  })
  return true
}

function fitView() {
  if (!viewport) return
  hasUserMovedViewport = false
  renderGraph(true)
}

function is2DViewState(value: unknown): value is RelationshipGalaxy2DViewState {
  if (!isRecord(value)) return false
  return (
    value.kind === '2d' &&
    is2DPoint(value.center) &&
    typeof value.scale === 'number' &&
    Number.isFinite(value.scale) &&
    typeof value.hasUserMovedViewport === 'boolean'
  )
}

function is2DPoint(value: unknown): value is RelationshipGalaxy2DViewState['center'] {
  if (!isRecord(value)) return false
  return (
    typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

onMounted(async () => {
  await nextTick()
  await initCanvas()
})

watch(
  () => [props.graph.nodes, props.graph.edges, props.selectedKey, props.privacyMode, props.safeInsetRight],
  () => {
    renderGraph(false)
  },
  { flush: 'post' }
)

watch(
  () => hoveredKey.value,
  () => {
    drawHighlightEdges()
  }
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  pixiApp?.ticker.remove(updateGalaxyAnimation)
  for (const r of activeRipples) {
    r.graphic.destroy()
  }
  activeRipples.length = 0
  viewport?.destroy({ children: true })
  viewport = null
  pixiApp?.destroy({ removeView: true }, true)
  pixiApp = null
  backgroundLayer = null
  backgroundStarsLayer = null
})

defineExpose({
  focusNode,
  fitView,
  captureView,
  restoreView,
})
</script>

<template>
  <div ref="canvasRoot" class="h-full w-full overflow-hidden" role="img" :aria-label="label" />
</template>
