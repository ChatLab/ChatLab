<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { PeopleRelationshipGraphNode, PeopleRelationshipsGraphData } from '@openchatlab/shared-types'
import {
  buildRelationshipGalaxy3DScene,
  type RelationshipGalaxy3DNode,
  type RelationshipGalaxy3DScene,
} from '../relationship-galaxy-3d-scene'

interface NodeObject {
  group: THREE.Group
  core: THREE.Sprite
  glow: THREE.Sprite
  sceneNode: RelationshipGalaxy3DNode
  basePosition: THREE.Vector3
  phase: number
}

interface VisibleLabel {
  key: string
  text: string
  x: number
  y: number
  opacity: number
  selected: boolean
}

interface CameraFlight {
  startedAt: number
  duration: number
  fromPosition: THREE.Vector3
  toPosition: THREE.Vector3
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
}

const props = withDefaults(
  defineProps<{
    graph: PeopleRelationshipsGraphData
    selectedKey?: string | null
    privacyMode?: boolean
    label: string
    ownerLabel: string
  }>(),
  {
    selectedKey: null,
    privacyMode: false,
  }
)

const emit = defineEmits<{
  (event: 'select-node', node: PeopleRelationshipGraphNode): void
  (event: 'fallback'): void
}>()

const canvasRoot = ref<HTMLElement | null>(null)
const labels = shallowRef<VisibleLabel[]>([])
const hoveredKey = ref<string | null>(null)
const sceneModel = computed(() => buildRelationshipGalaxy3DScene(props.graph, { selectedKey: props.selectedKey }))

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let resizeObserver: ResizeObserver | null = null
let animationFrame = 0
let animationStartedAt = 0
let labelFrame = 0
let hasUserMovedCamera = false
let pendingFocusKey: string | null = null
let cameraFlight: CameraFlight | null = null

const graphGroup = new THREE.Group()
const edgeGroup = new THREE.Group()
const nodeGroup = new THREE.Group()
const starGroup = new THREE.Group()
const nodeObjects = new Map<string, NodeObject>()
const nodePickObjects: THREE.Object3D[] = []
const neighborKeysOf = new Map<string, Set<string>>()
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const tmpWorldPosition = new THREE.Vector3()

function shortName(node: PeopleRelationshipGraphNode): string {
  if (node.kind === 'owner') return props.ownerLabel
  if (props.privacyMode) return `#${node.rank}`
  return node.displayName || node.platformId || node.key
}

function getViewportSize(): { width: number; height: number } {
  const rect = canvasRoot.value?.getBoundingClientRect()
  return {
    width: Math.max(1, Math.floor(rect?.width ?? 1)),
    height: Math.max(1, Math.floor(rect?.height ?? 1)),
  }
}

function scenePosition(node: RelationshipGalaxy3DNode, model: RelationshipGalaxy3DScene): THREE.Vector3 {
  const centerX = (model.bounds.minX + model.bounds.maxX) / 2
  const centerY = (model.bounds.minY + model.bounds.maxY) / 2
  return new THREE.Vector3(node.x - centerX, -(node.y - centerY), node.z)
}

function renderGraph(shouldFit = false) {
  if (!scene || !camera || !renderer) return

  clearGroup(edgeGroup)
  clearGroup(nodeGroup)
  nodeObjects.clear()
  nodePickObjects.length = 0
  neighborKeysOf.clear()
  hoveredKey.value = null
  labelFrame = 0
  labels.value = []

  const model = sceneModel.value
  for (const edge of props.graph.edges) {
    if (!neighborKeysOf.has(edge.sourceKey)) neighborKeysOf.set(edge.sourceKey, new Set())
    if (!neighborKeysOf.has(edge.targetKey)) neighborKeysOf.set(edge.targetKey, new Set())
    neighborKeysOf.get(edge.sourceKey)!.add(edge.targetKey)
    neighborKeysOf.get(edge.targetKey)!.add(edge.sourceKey)
  }

  addEdgeLayer(model, 'dim')
  addEdgeLayer(model, 'normal')
  addEdgeLayer(model, 'highlight')

  for (const sceneNode of model.nodes) {
    const basePosition = scenePosition(sceneNode, model)
    const object = createNodeObject(sceneNode, basePosition)
    nodeObjects.set(sceneNode.key, object)
    nodePickObjects.push(object.core)
    nodeGroup.add(object.group)
  }

  if (shouldFit || !hasUserMovedCamera) fitView()
  resolvePendingFocus()
}

function addEdgeLayer(model: RelationshipGalaxy3DScene, bucket: 'dim' | 'normal' | 'highlight') {
  const edges = model.edges.filter((edge) => {
    if (bucket === 'highlight') return edge.highlighted
    if (bucket === 'dim') return edge.alpha <= 0.05
    return !edge.highlighted && edge.alpha > 0.05
  })
  if (edges.length === 0) return

  const positions: number[] = []
  const colors: number[] = []
  const color = new THREE.Color()

  for (const edge of edges) {
    const source = scenePosition(edge.source, model)
    const target = scenePosition(edge.target, model)
    const points = makeWispyEdgePoints(source, target, edge.source.seed + edge.target.seed)
    color.setHex(edge.color)

    for (let i = 0; i < points.length - 1; i++) {
      positions.push(points[i].x, points[i].y, points[i].z, points[i + 1].x, points[i + 1].y, points[i + 1].z)
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: bucket === 'highlight' ? 0.72 : bucket === 'normal' ? 0.2 : 0.055,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  edgeGroup.add(new THREE.LineSegments(geometry, material))
}

function makeWispyEdgePoints(source: THREE.Vector3, target: THREE.Vector3, seed: number): THREE.Vector3[] {
  const mid = source.clone().lerp(target, 0.5)
  const distance = source.distanceTo(target)
  const bend = (seed % 1) - 0.5
  const control = mid.add(
    new THREE.Vector3(
      (target.y - source.y) * 0.035 * bend,
      (source.x - target.x) * 0.035 * bend,
      Math.min(160, distance * 0.12) * bend
    )
  )
  const curve = new THREE.QuadraticBezierCurve3(source, control, target)
  return curve.getPoints(7)
}

function createNodeObject(sceneNode: RelationshipGalaxy3DNode, basePosition: THREE.Vector3): NodeObject {
  const group = new THREE.Group()
  group.position.copy(basePosition)

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getRadialTexture('glow'),
      color: sceneNode.color,
      transparent: true,
      opacity: 0.22 * sceneNode.glow,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  glow.scale.setScalar(sceneNode.radius * (sceneNode.state === 'selected' ? 8.8 : 6.4))

  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getRadialTexture('core'),
      color: sceneNode.color,
      transparent: true,
      opacity: sceneNode.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  core.scale.setScalar(sceneNode.radius * 2.35)
  core.userData.key = sceneNode.key

  group.add(glow)
  group.add(core)

  if (sceneNode.state === 'selected') {
    const ring = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getRadialTexture('ring'),
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
    ring.scale.setScalar(sceneNode.radius * 4.4)
    group.add(ring)
  }

  return {
    group,
    core,
    glow,
    sceneNode,
    basePosition,
    phase: sceneNode.seed * Math.PI * 2,
  }
}

function updateAnimation() {
  if (!renderer || !scene || !camera || !controls) return

  const elapsedMs = performance.now() - animationStartedAt
  updateCameraFlight()

  const autoDrift = hasUserMovedCamera ? 0.007 : 0.018
  graphGroup.rotation.y = Math.sin(elapsedMs / 18_000) * autoDrift
  graphGroup.rotation.x = Math.cos(elapsedMs / 22_000) * autoDrift * 0.55
  starGroup.rotation.y = elapsedMs / 120_000

  for (const object of nodeObjects.values()) {
    const t = elapsedMs / 1000 + object.phase
    const motionScale = object.sceneNode.state === 'selected' ? 0.45 : 1
    const hoverScale = hoveredKey.value === object.sceneNode.key ? 1.28 : 1
    const neighborScale = hoveredKey.value && neighborKeysOf.get(hoveredKey.value)?.has(object.sceneNode.key) ? 1.08 : 1

    object.group.position.set(
      object.basePosition.x + Math.sin(t * 0.48) * 3.2 * motionScale,
      object.basePosition.y + Math.cos(t * 0.42) * 2.6 * motionScale,
      object.basePosition.z + Math.sin(t * 0.36) * 7 * motionScale
    )
    object.group.scale.setScalar((1 + Math.sin(t * 1.2) * 0.035 * object.sceneNode.glow) * hoverScale * neighborScale)

    const activeKey = hoveredKey.value || props.selectedKey
    const material = object.core.material
    const glowMaterial = object.glow.material
    let opacity = object.sceneNode.opacity
    let glowOpacity = 0.22 * object.sceneNode.glow

    if (activeKey && hoveredKey.value) {
      if (object.sceneNode.key === activeKey) {
        opacity = 1
        glowOpacity = 0.38
      } else if (neighborKeysOf.get(activeKey)?.has(object.sceneNode.key)) {
        opacity = 0.86
        glowOpacity = 0.22
      } else {
        opacity = 0.11
        glowOpacity = 0.035
      }
    }

    material.opacity += (opacity - material.opacity) * 0.16
    glowMaterial.opacity += (glowOpacity - glowMaterial.opacity) * 0.16
  }

  controls.update()
  updateLabels()
  renderer.render(scene, camera)
  animationFrame = requestAnimationFrame(updateAnimation)
}

function updateCameraFlight() {
  if (!controls || !camera || !cameraFlight) return

  const progress = Math.min(1, (performance.now() - cameraFlight.startedAt) / cameraFlight.duration)
  const eased = easeInOutCubic(progress)
  camera.position.lerpVectors(cameraFlight.fromPosition, cameraFlight.toPosition, eased)
  controls.target.lerpVectors(cameraFlight.fromTarget, cameraFlight.toTarget, eased)

  if (progress >= 1) cameraFlight = null
}

function updateLabels() {
  if (!renderer || !camera) return
  labelFrame += 1
  if (labelFrame % 2 !== 0) return

  const { width, height } = getViewportSize()
  const nextLabels: VisibleLabel[] = []

  for (const object of nodeObjects.values()) {
    if (object.sceneNode.labelTier === 0) continue

    object.group.getWorldPosition(tmpWorldPosition)
    const projected = tmpWorldPosition.clone().project(camera)
    if (projected.z < -1 || projected.z > 1) continue

    const x = (projected.x * 0.5 + 0.5) * width
    const y = (-projected.y * 0.5 + 0.5) * height
    if (x < -80 || x > width + 80 || y < -40 || y > height + 40) continue

    const selected = object.sceneNode.key === props.selectedKey
    nextLabels.push({
      key: object.sceneNode.key,
      text: shortName(object.sceneNode.node),
      x,
      y: y + object.sceneNode.radius + 8,
      opacity: selected ? 1 : Math.max(0.42, object.core.material.opacity),
      selected,
    })
  }

  labels.value = nextLabels
}

async function initCanvas() {
  const host = canvasRoot.value
  if (!host || renderer) return

  const size = getViewportSize()
  scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x04060b, 0.00018)

  camera = new THREE.PerspectiveCamera(48, size.width / size.height, 1, 30_000)
  camera.position.set(0, -600, 1500)

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  } catch (error) {
    console.warn('relationship galaxy 3d renderer unavailable', error)
    emit('fallback')
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(size.width, size.height)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.className = 'h-full w-full'
  host.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.055
  controls.rotateSpeed = 0.34
  controls.zoomSpeed = 0.72
  controls.panSpeed = 0.58
  controls.minDistance = 160
  controls.maxDistance = 9000
  controls.addEventListener('start', () => {
    hasUserMovedCamera = true
    cameraFlight = null
  })

  graphGroup.add(edgeGroup)
  graphGroup.add(nodeGroup)
  scene.add(starGroup)
  scene.add(graphGroup)
  addStarField()

  renderer.domElement.addEventListener('pointermove', handlePointerMove)
  renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
  renderer.domElement.addEventListener('click', handleClick)

  resizeObserver = new ResizeObserver(resizeCanvas)
  resizeObserver.observe(host)

  renderGraph(true)
  animationStartedAt = performance.now()
  animationFrame = requestAnimationFrame(updateAnimation)
}

function addStarField() {
  clearGroup(starGroup)

  const positions: number[] = []
  const colors: number[] = []
  const color = new THREE.Color()
  const count = 1600

  for (let i = 0; i < count; i++) {
    const seed = i * 97.317
    const x = pseudoRandom(seed) * 9000 - 4500
    const y = pseudoRandom(seed + 13.1) * 6000 - 3000
    const z = pseudoRandom(seed + 29.7) * 3000 - 1500
    positions.push(x, y, z)

    const huePick = pseudoRandom(seed + 8.8)
    if (huePick < 0.58) color.setHex(0xdbeafe)
    else if (huePick < 0.8) color.setHex(0xfef3c7)
    else color.setHex(0xa7f3d0)
    const intensity = 0.38 + pseudoRandom(seed + 19.2) * 0.62
    colors.push(color.r * intensity, color.g * intensity, color.b * intensity)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: 2.5,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  })

  starGroup.add(new THREE.Points(geometry, material))
}

function resizeCanvas() {
  if (!renderer || !camera) return
  const size = getViewportSize()
  camera.aspect = size.width / size.height
  camera.updateProjectionMatrix()
  renderer.setSize(size.width, size.height)
}

function handlePointerMove(event: PointerEvent) {
  if (!renderer || !camera) return
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const [hit] = raycaster.intersectObjects(nodePickObjects, false)
  hoveredKey.value = typeof hit?.object.userData.key === 'string' ? hit.object.userData.key : null
}

function handlePointerLeave() {
  hoveredKey.value = null
}

function handleClick() {
  const key = hoveredKey.value
  if (!key) return
  const object = nodeObjects.get(key)
  if (!object) return
  emit('select-node', object.sceneNode.node)
}

function resolvePendingFocus() {
  if (!pendingFocusKey) return
  const key = pendingFocusKey
  if (!nodeObjects.has(key)) {
    pendingFocusKey = null
    return
  }
  focusNode(key)
}

function focusNode(key: string): boolean {
  if (!camera || !controls) {
    pendingFocusKey = key
    return false
  }

  const object = nodeObjects.get(key)
  if (!object) {
    pendingFocusKey = key
    return false
  }

  pendingFocusKey = null
  hasUserMovedCamera = true
  const target = object.basePosition.clone()
  const distance = Math.max(280, Math.min(900, sceneModel.value.bounds.width * 0.22))
  startCameraFlight(target.clone().add(new THREE.Vector3(0, -distance * 0.42, distance)), target, 540)
  return true
}

function fitView() {
  if (!camera || !controls) return

  hasUserMovedCamera = false
  const model = sceneModel.value
  const span = Math.max(model.bounds.width, model.bounds.height, model.bounds.depth, 900)
  startCameraFlight(new THREE.Vector3(0, -span * 0.18, span * 1.16), new THREE.Vector3(0, 0, 0), 620)
}

function startCameraFlight(toPosition: THREE.Vector3, toTarget: THREE.Vector3, duration: number) {
  if (!camera || !controls) return
  cameraFlight = {
    startedAt: performance.now(),
    duration,
    fromPosition: camera.position.clone(),
    toPosition,
    fromTarget: controls.target.clone(),
    toTarget,
  }
}

function clearGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children.pop()
    if (!child) continue
    disposeObject(child)
  }
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Object3D & {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }
    mesh.geometry?.dispose()
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) material.dispose()
    } else {
      mesh.material?.dispose()
    }
  })
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2
}

function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

const textureCache = new Map<string, THREE.CanvasTexture>()

function getRadialTexture(kind: 'core' | 'glow' | 'ring'): THREE.CanvasTexture {
  const cached = textureCache.get(kind)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) throw new Error('failed to create galaxy texture context')

  if (kind === 'ring') {
    context.strokeStyle = 'rgba(255,255,255,0.95)'
    context.lineWidth = 7
    context.shadowColor = 'rgba(255,255,255,0.8)'
    context.shadowBlur = 12
    context.beginPath()
    context.arc(64, 64, 42, 0, Math.PI * 2)
    context.stroke()
  } else {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 62)
    if (kind === 'core') {
      gradient.addColorStop(0, 'rgba(255,255,255,1)')
      gradient.addColorStop(0.25, 'rgba(255,255,255,0.82)')
      gradient.addColorStop(0.58, 'rgba(255,255,255,0.24)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
    } else {
      gradient.addColorStop(0, 'rgba(255,255,255,0.32)')
      gradient.addColorStop(0.35, 'rgba(255,255,255,0.16)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
    }
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  textureCache.set(kind, texture)
  return texture
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
  if (animationFrame) cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  resizeObserver = null

  if (renderer) {
    renderer.domElement.removeEventListener('pointermove', handlePointerMove)
    renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
    renderer.domElement.removeEventListener('click', handleClick)
  }

  clearGroup(edgeGroup)
  clearGroup(nodeGroup)
  clearGroup(starGroup)
  for (const texture of textureCache.values()) texture.dispose()
  textureCache.clear()
  graphGroup.clear()
  scene?.clear()
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()

  renderer = null
  scene = null
  camera = null
  controls = null
  labels.value = []
})

defineExpose({
  focusNode,
  fitView,
})
</script>

<template>
  <div
    ref="canvasRoot"
    class="relationship-galaxy-3d relative h-full w-full overflow-hidden"
    role="img"
    :aria-label="label"
  >
    <div class="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <span
        v-for="item in labels"
        :key="item.key"
        class="relationship-galaxy-3d__label"
        :class="{ 'relationship-galaxy-3d__label--selected': item.selected }"
        :style="{ left: `${item.x}px`, top: `${item.y}px`, opacity: item.opacity }"
      >
        {{ item.text }}
      </span>
    </div>
    <div class="relationship-galaxy-3d__crosshair pointer-events-none absolute left-1/2 top-1/2 z-10"></div>
  </div>
</template>

<style scoped>
.relationship-galaxy-3d {
  background:
    linear-gradient(180deg, rgba(9, 12, 20, 0.95), rgba(2, 4, 9, 1)),
    radial-gradient(circle at 50% 45%, rgba(45, 58, 88, 0.18), transparent 58%);
}

.relationship-galaxy-3d__label {
  position: absolute;
  max-width: 132px;
  transform: translate(-50%, 0);
  color: rgba(226, 232, 240, 0.9);
  font-size: 11px;
  font-weight: 650;
  line-height: 1.1;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow:
    0 0 8px rgba(255, 255, 255, 0.5),
    0 2px 8px rgba(0, 0, 0, 0.95);
  white-space: nowrap;
  will-change: transform, opacity;
}

.relationship-galaxy-3d__label--selected {
  color: #fff;
  font-size: 15px;
  font-weight: 800;
  text-shadow:
    0 0 10px rgba(255, 255, 255, 0.86),
    0 0 22px rgba(125, 211, 252, 0.5),
    0 2px 10px rgba(0, 0, 0, 1);
}

.relationship-galaxy-3d__crosshair {
  height: 13px;
  width: 13px;
  transform: translate(-50%, -50%);
}

.relationship-galaxy-3d__crosshair::before,
.relationship-galaxy-3d__crosshair::after {
  position: absolute;
  background: rgba(226, 232, 240, 0.45);
  content: '';
}

.relationship-galaxy-3d__crosshair::before {
  left: 6px;
  top: 0;
  height: 13px;
  width: 1px;
}

.relationship-galaxy-3d__crosshair::after {
  left: 0;
  top: 6px;
  height: 1px;
  width: 13px;
}
</style>
