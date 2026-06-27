<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Application, Container, Graphics, Text } from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import type { PeopleRelationshipGraphNode, PeopleRelationshipsGraphData } from '@openchatlab/shared-types'

const props = withDefaults(
  defineProps<{
    graph: PeopleRelationshipsGraphData
    selectedKey?: string | null
    privacyMode?: boolean
    label: string
  }>(),
  {
    selectedKey: null,
    privacyMode: false,
  }
)

const emit = defineEmits<{
  (event: 'select-node', node: PeopleRelationshipGraphNode): void
}>()

const canvasRoot = ref<HTMLElement | null>(null)

let pixiApp: Application | null = null
let viewport: Viewport | null = null
let backgroundLayer: Graphics | null = null
let resizeObserver: ResizeObserver | null = null
let hasUserMovedViewport = false

const renderedNodePositions = new Map<string, { x: number; y: number }>()

function colorToNumber(color: string | null | undefined, fallback: number): number {
  if (!color) return fallback
  const normalized = color.startsWith('#') ? color.slice(1) : color
  const parsed = Number.parseInt(normalized, 16)
  return Number.isFinite(parsed) ? parsed : fallback
}

function shortName(node: PeopleRelationshipGraphNode): string {
  if (props.privacyMode) return `#${node.rank}`
  return node.displayName || node.platformId || node.key
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
  if (!backgroundLayer) return

  const { width, height } = getViewportSize()
  backgroundLayer.clear()
  backgroundLayer.rect(0, 0, width, height).fill({ color: 0x05070d, alpha: 1 })

  const starCount = Math.min(260, Math.max(90, Math.floor((width * height) / 5200)))
  for (let index = 0; index < starCount; index += 1) {
    const x = ((index * 137.508 + 41) % width) + (index % 7) * 0.37
    const y = ((index * 67.37 + 89) % height) + (index % 5) * 0.29
    const size = index % 17 === 0 ? 1.7 : index % 5 === 0 ? 1.1 : 0.75
    const alpha = index % 11 === 0 ? 0.72 : 0.28
    backgroundLayer.circle(x, y, size).fill({ color: 0xe5eefb, alpha })
  }
}

function shouldShowLabel(node: PeopleRelationshipGraphNode, totalNodes: number): boolean {
  if (node.key === props.selectedKey) return true
  if (node.labelVisibility === 2) return true
  return node.labelVisibility === 1 && totalNodes <= 500
}

function createLabel(node: PeopleRelationshipGraphNode, radius: number): Text {
  const label = new Text({
    text: shortName(node),
    style: {
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontSize: node.key === props.selectedKey ? 13 : 11,
      fontWeight: node.key === props.selectedKey ? '700' : '600',
      fill: node.key === props.selectedKey ? 0xffffff : 0xd7e2f1,
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

function renderGraph(shouldFit = false) {
  if (!viewport) return

  viewport.removeChildren()
  renderedNodePositions.clear()

  const nodes = props.graph.nodes
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]))
  const bounds = getGraphBounds(nodes)
  const padding = 260
  const offsetX = -bounds.minX + padding
  const offsetY = -bounds.minY + padding
  const worldWidth = bounds.width + padding * 2
  const worldHeight = bounds.height + padding * 2
  const screen = getViewportSize()

  viewport.resize(screen.width, screen.height, worldWidth, worldHeight)

  const edgeLayer = new Graphics()
  const nodeLayer = new Container()
  const labelLayer = new Container()

  for (const edge of props.graph.edges) {
    const source = nodeByKey.get(edge.sourceKey)
    const target = nodeByKey.get(edge.targetKey)
    if (!source || !target) continue

    const sourceX = source.x + offsetX
    const sourceY = source.y + offsetY
    const targetX = target.x + offsetX
    const targetY = target.y + offsetY
    const touchesSelected = edge.sourceKey === props.selectedKey || edge.targetKey === props.selectedKey
    const alpha = touchesSelected ? 0.72 : edge.visibility === 2 ? 0.32 : 0.14
    const width = touchesSelected ? 2.2 : Math.min(1.8, Math.max(0.45, Math.log10(edge.weight + 1) * 0.95))

    edgeLayer
      .moveTo(sourceX, sourceY)
      .lineTo(targetX, targetY)
      .stroke({ color: touchesSelected ? 0xf8fafc : getNodeColor(source), width, alpha })
  }

  for (const node of nodes) {
    const x = node.x + offsetX
    const y = node.y + offsetY
    const radius = Math.max(3.6, node.size)
    const color = getNodeColor(node)
    const selected = node.key === props.selectedKey
    const nodeGraphic = new Graphics()

    renderedNodePositions.set(node.key, { x, y })

    if (selected) {
      nodeGraphic.circle(0, 0, radius + 9).fill({ color, alpha: 0.16 })
      nodeGraphic.circle(0, 0, radius + 5).stroke({ color: 0xffffff, width: 2.4, alpha: 0.92 })
    } else if (node.pool === 'friend') {
      nodeGraphic.circle(0, 0, radius + 5).fill({ color, alpha: 0.12 })
    }

    nodeGraphic.circle(0, 0, radius).fill({ color, alpha: selected ? 0.95 : 0.78 })
    nodeGraphic.circle(-radius * 0.28, -radius * 0.32, Math.max(1.4, radius * 0.34)).fill({
      color: 0xffffff,
      alpha: selected ? 0.45 : 0.22,
    })
    nodeGraphic.position.set(x, y)
    nodeGraphic.eventMode = 'static'
    nodeGraphic.cursor = 'pointer'
    nodeGraphic.on('pointertap', () => emit('select-node', node))
    nodeLayer.addChild(nodeGraphic)

    if (shouldShowLabel(node, nodes.length)) {
      const label = createLabel(node, radius)
      label.position.set(x, y + radius + 4)
      labelLayer.addChild(label)
    }
  }

  viewport.addChild(edgeLayer)
  viewport.addChild(nodeLayer)
  viewport.addChild(labelLayer)

  if (shouldFit || !hasUserMovedViewport) {
    viewport.fitWorld(true)
    if (viewport.scaled > 1.18) viewport.setZoom(1.18, true)
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
  app.stage.addChild(backgroundLayer)

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

  resizeObserver = new ResizeObserver(() => {
    drawBackground()
    renderGraph(!hasUserMovedViewport)
  })
  resizeObserver.observe(host)
}

function focusNode(key: string) {
  const position = renderedNodePositions.get(key)
  if (!position || !viewport) return

  hasUserMovedViewport = true
  const nextScale = Math.min(Math.max(viewport.scaled, 0.45), 1.55)
  viewport.animate({
    position,
    scale: nextScale,
    time: 420,
    ease: 'easeInOutSine',
  })
}

function fitView() {
  if (!viewport) return
  hasUserMovedViewport = false
  renderGraph(true)
}

onMounted(async () => {
  await nextTick()
  await initCanvas()
})

watch(
  () => [props.graph.nodes, props.graph.edges, props.selectedKey, props.privacyMode],
  () => {
    renderGraph(false)
  },
  { flush: 'post' }
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  viewport?.destroy({ children: true })
  viewport = null
  pixiApp?.destroy({ removeView: true }, true)
  pixiApp = null
  backgroundLayer = null
})

defineExpose({
  focusNode,
  fitView,
})
</script>

<template>
  <div ref="canvasRoot" class="h-full w-full overflow-hidden" role="img" :aria-label="label" />
</template>
