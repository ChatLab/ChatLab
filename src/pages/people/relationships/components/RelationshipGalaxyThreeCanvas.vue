<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { PeopleRelationshipGraphNode, PeopleRelationshipsGraphData } from '@openchatlab/shared-types'
import {
  buildRelationshipGalaxy3DScene,
  type RelationshipGalaxy3DEdge,
  type RelationshipGalaxy3DNode,
  type RelationshipGalaxy3DScene,
} from '../relationship-galaxy-3d-scene'
import { buildRelationshipGalaxy3DEdgeCurvePoints } from '../relationship-galaxy-3d-edge-path'
import {
  setRelationshipGalaxy3DEdgeGradientColor,
  type RelationshipGalaxy3DEdgeRenderBucket,
} from '../relationship-galaxy-3d-edge-colors'
import { buildRelationshipVisibleLabelKeys } from '../relationship-galaxy-connections'
import {
  applyRelationshipGalaxy3DSafeArea,
  buildRelationshipGalaxy3DViewOffset,
  buildRelationshipGalaxy3DFitCameraPose,
  type RelationshipGalaxy3DCameraPose,
} from '../relationship-galaxy-3d-camera'
import { maskRelationshipGalaxyPrivateText } from '../relationship-galaxy-privacy'

interface NodeObject {
  group: THREE.Group
  core: THREE.Sprite
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
  emphasis: 'major' | 'medium' | 'minor'
}

interface CameraFlight {
  startedAt: number
  duration: number
  fromPosition: THREE.Vector3
  toPosition: THREE.Vector3
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
}

interface RelationshipGalaxy3DCameraViewState {
  kind: '3d'
  position: RelationshipGalaxy3DCameraPose['position']
  target: RelationshipGalaxy3DCameraPose['position']
  hasUserMovedCamera: boolean
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
  (event: 'fallback'): void
}>()

const canvasRoot = ref<HTMLElement | null>(null)
const labels = shallowRef<VisibleLabel[]>([])
const hoveredKey = ref<string | null>(null)
const sceneModel = shallowRef<RelationshipGalaxy3DScene>(
  buildRelationshipGalaxy3DScene(props.graph, { selectedKey: props.selectedKey })
)
const selectedVisibleLabelKeys = shallowRef<Set<string> | null>(null)

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
const nodeObjects = new Map<string, NodeObject>()
const nodePickObjects: THREE.Object3D[] = []
const neighborKeysOf = new Map<string, Set<string>>()
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const tmpWorldPosition = new THREE.Vector3()

function shortName(node: PeopleRelationshipGraphNode): string {
  if (node.kind === 'owner') return props.ownerLabel
  const name = node.displayName || node.platformId || node.key
  return props.privacyMode ? maskRelationshipGalaxyPrivateText(name) : name
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

  const model = buildRelationshipGalaxy3DScene(props.graph, { selectedKey: props.selectedKey })
  sceneModel.value = model
  updateSelectedVisibleLabelKeys()
  clearGroup(edgeGroup)
  clearGroup(nodeGroup)
  nodeObjects.clear()
  nodePickObjects.length = 0
  neighborKeysOf.clear()
  hoveredKey.value = null
  labelFrame = 0
  labels.value = []

  for (const edge of model.edges) {
    if (!neighborKeysOf.has(edge.edge.sourceKey)) neighborKeysOf.set(edge.edge.sourceKey, new Set())
    if (!neighborKeysOf.has(edge.edge.targetKey)) neighborKeysOf.set(edge.edge.targetKey, new Set())
    neighborKeysOf.get(edge.edge.sourceKey)!.add(edge.edge.targetKey)
    neighborKeysOf.get(edge.edge.targetKey)!.add(edge.edge.sourceKey)
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

function updateSelectedVisibleLabelKeys() {
  selectedVisibleLabelKeys.value = props.selectedKey
    ? buildRelationshipVisibleLabelKeys(props.graph, props.selectedKey)
    : null
}

function addEdgeLayer(model: RelationshipGalaxy3DScene, bucket: 'dim' | 'normal' | 'highlight') {
  const edges = model.edges.filter((edge) => {
    if (bucket === 'highlight') return edge.highlighted
    if (bucket === 'dim') return edge.alpha <= 0.05
    return !edge.highlighted && edge.alpha > 0.05
  })
  if (edges.length === 0) return

  for (const band of groupEdgesByWidth(edges, bucket)) {
    addThinEdgePaths(model, band.edges, bucket, band.linewidth)
  }
}

function addThinEdgePaths(
  model: RelationshipGalaxy3DScene,
  edges: RelationshipGalaxy3DEdge[],
  bucket: 'dim' | 'normal' | 'highlight',
  linewidth: number
) {
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: bucket === 'highlight' ? 0.62 : bucket === 'normal' ? 0.21 : 0.05,
    linewidth,
    blending: THREE.NormalBlending,
    depthTest: true,
    depthWrite: false,
  })

  const sourceColor = new THREE.Color()
  const targetColor = new THREE.Color()
  const vertexColor = new THREE.Color()
  const positions: number[] = []
  const colors: number[] = []

  for (const edge of edges) {
    const source = scenePosition(edge.source, model)
    const target = scenePosition(edge.target, model)
    const points = buildRelationshipGalaxy3DEdgeCurvePoints(source, target, edge.source.seed + edge.target.seed)
    const stepCount = Math.max(1, points.length - 1)
    sourceColor.setHex(edge.source.color)
    targetColor.setHex(edge.target.color)

    for (let index = 0; index < points.length - 1; index += 1) {
      const current = points[index]
      const next = points[index + 1]
      positions.push(current.x, current.y, current.z, next.x, next.y, next.z)
      pushEdgeGradientColor(colors, vertexColor, sourceColor, targetColor, bucket, index / stepCount)
      pushEdgeGradientColor(colors, vertexColor, sourceColor, targetColor, bucket, (index + 1) / stepCount)
    }
  }

  if (positions.length === 0) {
    material.dispose()
    return
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const line = new THREE.LineSegments(geometry, material)
  line.frustumCulled = false
  edgeGroup.add(line)
}

function pushEdgeGradientColor(
  colors: number[],
  vertexColor: THREE.Color,
  sourceColor: THREE.Color,
  targetColor: THREE.Color,
  bucket: RelationshipGalaxy3DEdgeRenderBucket,
  progress: number
) {
  setRelationshipGalaxy3DEdgeGradientColor(vertexColor, sourceColor, targetColor, bucket, progress)
  colors.push(vertexColor.r, vertexColor.g, vertexColor.b)
}

function groupEdgesByWidth(edges: RelationshipGalaxy3DEdge[], bucket: 'dim' | 'normal' | 'highlight') {
  const groups = new Map<number, RelationshipGalaxy3DEdge[]>()
  for (const edge of edges) {
    const linewidth = getRenderedEdgeLineWidth(edge, bucket)
    const group = groups.get(linewidth) ?? []
    group.push(edge)
    groups.set(linewidth, group)
  }
  return [...groups.entries()].map(([linewidth, group]) => ({ linewidth, edges: group }))
}

function getRenderedEdgeLineWidth(edge: RelationshipGalaxy3DEdge, bucket: 'dim' | 'normal' | 'highlight'): number {
  if (bucket === 'highlight') return edge.width >= 2 ? 2.0 : 1.65
  if (bucket === 'dim') return 0.55
  if (edge.width >= 1.2) return 1.12
  if (edge.width >= 0.95) return 0.96
  return 0.82
}

function getStarSpriteScale(sceneNode: RelationshipGalaxy3DNode): number {
  if (sceneNode.state === 'selected') return 2.18
  if (sceneNode.node.kind === 'owner') return 2.04
  if (sceneNode.node.rank <= 10) return 1.76
  return 1.52
}

function createNodeObject(sceneNode: RelationshipGalaxy3DNode, basePosition: THREE.Vector3): NodeObject {
  const group = new THREE.Group()
  group.position.copy(basePosition)

  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getStarTexture(sceneNode.color, Math.floor(sceneNode.seed * 8)),
      color: 0xffffff,
      transparent: true,
      opacity: sceneNode.opacity,
      blending: THREE.NormalBlending,
      depthWrite: false,
      alphaTest: 0.02,
    })
  )
  core.scale.setScalar(sceneNode.radius * getStarSpriteScale(sceneNode))
  core.userData.key = sceneNode.key

  group.add(core)

  return {
    group,
    core,
    sceneNode,
    basePosition,
    phase: sceneNode.seed * Math.PI * 2,
  }
}

function updateAnimation() {
  if (!renderer || !scene || !camera || !controls) return

  const elapsedMs = performance.now() - animationStartedAt
  updateCameraFlight()

  const autoDrift = hasUserMovedCamera ? 0.003 : 0.008
  graphGroup.rotation.y = Math.sin(elapsedMs / 25_000) * autoDrift
  graphGroup.rotation.x = Math.cos(elapsedMs / 30_000) * autoDrift * 0.4
  const activeKey = hoveredKey.value || props.selectedKey

  for (const object of nodeObjects.values()) {
    const t = elapsedMs / 1000 + object.phase
    const isSelected = object.sceneNode.key === props.selectedKey
    const isActive = object.sceneNode.key === activeKey
    const isActiveNeighbor = Boolean(activeKey && neighborKeysOf.get(activeKey)?.has(object.sceneNode.key))
    const motionScale = isSelected ? 0.3 : 0.8
    const hoverScale = hoveredKey.value === object.sceneNode.key ? 1.28 : 1
    const selectedScale = isSelected ? 1.22 : 1
    const neighborScale = isActiveNeighbor ? 1.08 : 1

    object.group.position.set(
      object.basePosition.x + Math.sin(t * 0.3) * 2.0 * motionScale,
      object.basePosition.y + Math.cos(t * 0.25) * 1.5 * motionScale,
      object.basePosition.z + Math.sin(t * 0.2) * 4.0 * motionScale
    )
    object.group.scale.setScalar((1 + Math.sin(t * 0.8) * 0.006) * hoverScale * selectedScale * neighborScale)

    const material = object.core.material
    let opacity = object.sceneNode.opacity

    if (activeKey) {
      if (isActive) {
        opacity = 1
      } else if (isActiveNeighbor) {
        opacity = 0.85
      } else {
        opacity = 0.1
      }
    }

    material.opacity += (opacity - material.opacity) * 0.16
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
  const selectedKey = props.selectedKey
  const selectedNeighborKeys = selectedKey ? neighborKeysOf.get(selectedKey) : null

  for (const object of nodeObjects.values()) {
    const selected = object.sceneNode.key === selectedKey
    const selectedNeighbor = Boolean(selectedKey && selectedNeighborKeys?.has(object.sceneNode.key))
    const labelTier = getDynamicLabelTier(object.sceneNode, selectedKey ?? null, hoveredKey.value)
    if (labelTier === 0) continue

    object.group.getWorldPosition(tmpWorldPosition)
    const projected = tmpWorldPosition.clone().project(camera)
    if (projected.z < -1 || projected.z > 1) continue

    const x = (projected.x * 0.5 + 0.5) * width
    const y = (-projected.y * 0.5 + 0.5) * height
    if (x < -80 || x > width + 80 || y < -40 || y > height + 40) continue

    nextLabels.push({
      key: object.sceneNode.key,
      text: shortName(object.sceneNode.node),
      x,
      y: y + object.sceneNode.radius + 8,
      opacity: selected ? 1 : Math.max(0.42, object.core.material.opacity),
      selected,
      emphasis: getLabelEmphasis(object.sceneNode, selectedNeighbor, labelTier),
    })
  }

  labels.value = nextLabels
}

function getDynamicLabelTier(
  sceneNode: RelationshipGalaxy3DNode,
  selectedKey: string | null,
  hoveredKey: string | null
): 0 | 1 | 2 {
  if (sceneNode.key === hoveredKey) return sceneNode.labelTier === 2 ? 2 : 1
  if (!selectedKey) return sceneNode.labelTier
  if (!selectedVisibleLabelKeys.value?.has(sceneNode.key)) return 0
  return sceneNode.key === selectedKey || sceneNode.node.kind === 'owner' ? 2 : 1
}

function getLabelEmphasis(
  sceneNode: RelationshipGalaxy3DNode,
  selectedNeighbor = false,
  labelTier = sceneNode.labelTier
): VisibleLabel['emphasis'] {
  if (labelTier === 2 || sceneNode.node.kind === 'owner' || sceneNode.node.rank <= 5) return 'major'
  if (selectedNeighbor) return 'medium'
  if (sceneNode.node.rank <= 30) return 'medium'
  return 'minor'
}

async function initCanvas() {
  const host = canvasRoot.value
  if (!host || renderer) return

  const size = getViewportSize()
  scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x0a0503, 0.00032)

  camera = new THREE.PerspectiveCamera(45, size.width / size.height, 1, 30_000)
  camera.position.set(0, -150, 900)

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
  scene.add(graphGroup)

  renderer.domElement.addEventListener('pointermove', handlePointerMove)
  renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
  renderer.domElement.addEventListener('click', handleClick)

  resizeObserver = new ResizeObserver(resizeCanvas)
  resizeObserver.observe(host)

  renderGraph(true)
  animationStartedAt = performance.now()
  animationFrame = requestAnimationFrame(updateAnimation)
}

function resizeCanvas() {
  if (!renderer || !camera) return
  const size = getViewportSize()
  camera.aspect = size.width / size.height
  renderer.setSize(size.width, size.height)
  applyCameraSafeAreaProjection(size)
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

function selectNodeByKey(key: string) {
  const object = nodeObjects.get(key)
  if (!object) return
  emit('select-node', object.sceneNode.node)
}

function hoverNodeLabel(key: string) {
  hoveredKey.value = key
}

function leaveNodeLabel(key: string) {
  if (hoveredKey.value === key) hoveredKey.value = null
}

function handleLabelWheel(event: WheelEvent) {
  event.preventDefault()
  event.stopPropagation()

  const canvas = renderer?.domElement
  if (!canvas) return

  canvas.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      deltaMode: event.deltaMode,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      metaKey: event.metaKey,
      screenX: event.screenX,
      screenY: event.screenY,
      shiftKey: event.shiftKey,
    })
  )
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
  const distance = Math.max(180, Math.min(600, sceneModel.value.bounds.width * 0.18))
  const pose = applySafeAreaToCameraPose({
    position: vectorToPose(target.clone().add(new THREE.Vector3(0, -distance * 0.25, distance))),
    target: vectorToPose(target),
  })
  startCameraFlight(
    new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z),
    new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z),
    540
  )
  return true
}

function captureView(): RelationshipGalaxy3DCameraViewState | null {
  if (!camera || !controls) return null
  return {
    kind: '3d',
    position: vectorToPose(camera.position),
    target: vectorToPose(controls.target),
    hasUserMovedCamera,
  }
}

function restoreView(view: unknown): boolean {
  if (!isCameraViewState(view) || !camera || !controls) return false

  pendingFocusKey = null
  hasUserMovedCamera = view.hasUserMovedCamera
  applyCameraSafeAreaProjection()
  startCameraFlight(
    new THREE.Vector3(view.position.x, view.position.y, view.position.z),
    new THREE.Vector3(view.target.x, view.target.y, view.target.z),
    620
  )
  return true
}

function fitView() {
  if (!camera || !controls) return

  hasUserMovedCamera = false
  const pose = applySafeAreaToCameraPose(buildRelationshipGalaxy3DFitCameraPose(sceneModel.value.bounds))
  startCameraFlight(
    new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z),
    new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z),
    620
  )
}

function applySafeAreaToCameraPose(pose: RelationshipGalaxy3DCameraPose): RelationshipGalaxy3DCameraPose {
  const size = getViewportSize()
  applyCameraSafeAreaProjection(size)
  return applyRelationshipGalaxy3DSafeArea(pose, {
    viewportWidth: size.width,
    viewportHeight: size.height,
    safeInsetRight: props.safeInsetRight,
    fovDegrees: camera?.fov ?? 45,
  })
}

function applyCameraSafeAreaProjection(size = getViewportSize()) {
  if (!camera) return
  const viewOffset = buildRelationshipGalaxy3DViewOffset({
    viewportWidth: size.width,
    viewportHeight: size.height,
    safeInsetRight: props.safeInsetRight,
  })
  if (!viewOffset) {
    camera.clearViewOffset()
    return
  }

  camera.setViewOffset(
    viewOffset.fullWidth,
    viewOffset.fullHeight,
    viewOffset.offsetX,
    viewOffset.offsetY,
    viewOffset.width,
    viewOffset.height
  )
}

function vectorToPose(vector: THREE.Vector3): RelationshipGalaxy3DCameraPose['position'] {
  return { x: vector.x, y: vector.y, z: vector.z }
}

function isCameraViewState(value: unknown): value is RelationshipGalaxy3DCameraViewState {
  if (!isRecord(value)) return false
  return (
    value.kind === '3d' &&
    isCameraVector(value.position) &&
    isCameraVector(value.target) &&
    typeof value.hasUserMovedCamera === 'boolean'
  )
}

function isCameraVector(value: unknown): value is RelationshipGalaxy3DCameraPose['position'] {
  if (!isRecord(value)) return false
  return (
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y) &&
    typeof value.z === 'number' &&
    Number.isFinite(value.z)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

function getStarTexture(colorValue: number, variant: number): THREE.CanvasTexture {
  const colorKey = colorValue.toString(16).padStart(6, '0')
  const key = `star:${colorKey}:${variant}`
  const cached = textureCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) throw new Error('failed to create galaxy texture context')

  const edgeColor = new THREE.Color(colorValue)
  const xScale = 1.04 + pseudoRandom(variant + 4.2) * 0.06
  const yScale = 0.94 + pseudoRandom(variant + 9.8) * 0.05
  const rotation = (pseudoRandom(variant + 17.4) - 0.5) * 0.32
  const rayAlpha = 0.18 + pseudoRandom(variant + 21.7) * 0.12

  drawEllipticDisc(context, xScale, yScale, rotation, 38, [
    [0, 'rgba(255,255,255,0.1)'],
    [0.26, toRgb(edgeColor, 0.16)],
    [0.58, toRgb(edgeColor, 0.04)],
    [1, 'rgba(255,255,255,0)'],
  ])

  drawStarRay(context, rotation, 48, 2.2, rayAlpha, edgeColor)
  drawStarRay(context, rotation + Math.PI / 2, 32, 1.35, rayAlpha * 0.62, edgeColor)
  if (variant % 3 === 0) drawStarRay(context, rotation + Math.PI / 4, 22, 0.9, rayAlpha * 0.34, edgeColor)

  drawEllipticDisc(context, xScale, yScale, rotation, 18, [
    [0, 'rgba(255,255,255,1)'],
    [0.28, 'rgba(255,255,255,0.94)'],
    [0.54, toRgb(edgeColor, 0.95)],
    [0.78, toRgb(edgeColor, 0.38)],
    [1, 'rgba(255,255,255,0)'],
  ])

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  textureCache.set(key, texture)
  return texture
}

function drawEllipticDisc(
  context: CanvasRenderingContext2D,
  xScale: number,
  yScale: number,
  rotation: number,
  radius: number,
  stops: Array<[number, string]>
) {
  context.save()
  context.translate(64, 64)
  context.rotate(rotation)
  context.scale(xScale, yScale)

  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius)
  for (const [offset, color] of stops) gradient.addColorStop(offset, color)

  context.fillStyle = gradient
  context.beginPath()
  context.arc(0, 0, radius, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

function drawStarRay(
  context: CanvasRenderingContext2D,
  rotation: number,
  length: number,
  thickness: number,
  alpha: number,
  color: THREE.Color
) {
  context.save()
  context.translate(64, 64)
  context.rotate(rotation)

  const gradient = context.createLinearGradient(-length, 0, length, 0)
  gradient.addColorStop(0, 'rgba(255,255,255,0)')
  gradient.addColorStop(0.43, toRgb(color, alpha * 0.32))
  gradient.addColorStop(0.5, `rgba(255,255,255,${alpha})`)
  gradient.addColorStop(0.57, toRgb(color, alpha * 0.32))
  gradient.addColorStop(1, 'rgba(255,255,255,0)')

  context.fillStyle = gradient
  context.fillRect(-length, -thickness / 2, length * 2, thickness)
  context.restore()
}

function toRgb(color: THREE.Color, alpha: number): string {
  return `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${alpha})`
}

onMounted(async () => {
  await nextTick()
  await initCanvas()
})

watch(
  () => props.graph,
  () => {
    renderGraph(false)
  },
  { flush: 'post' }
)

watch(
  () => props.selectedKey,
  () => {
    renderGraph(false)
  },
  { flush: 'post' }
)

watch(
  () => props.privacyMode,
  () => {
    labelFrame = 1
    updateLabels()
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
  captureView,
  restoreView,
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
      <button
        v-for="item in labels"
        :key="item.key"
        type="button"
        class="relationship-galaxy-3d__label"
        :class="[
          `relationship-galaxy-3d__label--${item.emphasis}`,
          { 'relationship-galaxy-3d__label--selected': item.selected },
        ]"
        :style="{ left: `${item.x}px`, top: `${item.y}px`, opacity: item.opacity }"
        @blur="leaveNodeLabel(item.key)"
        @click.stop="selectNodeByKey(item.key)"
        @focus="hoverNodeLabel(item.key)"
        @mouseenter="hoverNodeLabel(item.key)"
        @mouseleave="leaveNodeLabel(item.key)"
        @wheel="handleLabelWheel"
      >
        {{ item.text }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.relationship-galaxy-3d {
  background: #000;
  background: radial-gradient(circle at 50% 50%, rgba(23, 12, 7, 1) 0%, rgba(6, 3, 2, 1) 100%);
}

.relationship-galaxy-3d__label {
  pointer-events: auto;
  position: absolute;
  border: 0;
  max-width: 190px;
  padding: 0;
  transform: translate(-50%, 0);
  background: transparent;
  color: rgba(255, 255, 255, 0.58);
  cursor: pointer;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.1;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow:
    0 0 4px rgba(0, 0, 0, 0.9),
    0 2px 4px rgba(0, 0, 0, 1);
  white-space: nowrap;
  will-change: transform, opacity;
}

.relationship-galaxy-3d__label:focus-visible {
  outline: 1px solid rgba(255, 230, 185, 0.72);
  outline-offset: 4px;
}

.relationship-galaxy-3d__label--medium {
  color: rgba(255, 255, 255, 0.88);
  font-size: 10.5px;
  font-weight: 750;
  text-shadow:
    0 0 3px rgba(0, 0, 0, 0.95),
    0 1px 5px rgba(0, 0, 0, 1);
}

.relationship-galaxy-3d__label--major {
  color: #fff;
  font-size: 12px;
  font-weight: 850;
  text-shadow:
    0 0 4px rgba(255, 255, 255, 0.26),
    0 2px 10px rgba(0, 0, 0, 1);
}

.relationship-galaxy-3d__label--selected {
  font-size: 13px;
  font-weight: 900;
}
</style>
