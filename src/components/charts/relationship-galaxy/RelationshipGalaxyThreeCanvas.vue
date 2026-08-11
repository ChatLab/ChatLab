<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { RelationshipGalaxyRenderGraph, RelationshipGalaxyRenderNode } from '@openchatlab/shared-types'
import {
  buildRelationshipGalaxy3DScene,
  type RelationshipGalaxy3DCommunity,
  type RelationshipGalaxy3DEdge,
  type RelationshipGalaxy3DNode,
  type RelationshipGalaxy3DScene,
} from './relationship-galaxy-3d-scene'
import {
  buildRelationshipGalaxy3DAmbientParticles,
  buildRelationshipGalaxy3DFogVeils,
  selectRelationshipGalaxy3DAmbientEdgeIds,
  selectRelationshipGalaxy3DPrimarySelectedEdgeIds,
  selectRelationshipGalaxy3DSelectedEdgeIds,
} from './relationship-galaxy-3d-environment'
import { buildRelationshipGalaxy3DEdgeCurvePoints } from './relationship-galaxy-3d-edge-path'
import {
  setRelationshipGalaxy3DEdgeGradientColor,
  type RelationshipGalaxy3DEdgeRenderBucket,
} from './relationship-galaxy-3d-edge-colors'
import { buildRelationshipVisibleLabelKeys } from './relationship-galaxy-connections'
import {
  applyRelationshipGalaxy3DSafeArea,
  buildRelationshipGalaxy3DFocusCameraPose,
  buildRelationshipGalaxy3DFocusFrame,
  buildRelationshipGalaxy3DImmersiveCameraPose,
  type RelationshipGalaxy3DCameraPose,
} from './relationship-galaxy-3d-camera'
import {
  applyRelationshipGalaxy3DCameraViewOffset,
  buildRelationshipGalaxy3DSceneLayoutSignature,
  captureRelationshipGalaxy3DCameraView,
  getRelationshipGalaxy3DDynamicLabelTier,
  getRelationshipGalaxy3DZoomLabelRankLimit,
  hasExceededRelationshipGalaxyPointerDragThreshold,
  parseRelationshipGalaxy3DCameraView,
  resolveRelationshipGalaxyPointerClickAction,
} from './relationship-galaxy-3d-canvas'

interface NodeObject {
  sceneNode: RelationshipGalaxy3DNode
  basePosition: THREE.Vector3
  currentPosition: THREE.Vector3
  phase: number
  index: number
}

interface VisibleLabel {
  key: string
  text: string
  rank: number
  x: number
  y: number
  opacity: number
  selected: boolean
  emphasis: 'major' | 'medium' | 'minor'
}

interface EdgeLayerObject {
  line: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  targetOpacity: number
  disposeWhenHidden: boolean
}

interface CameraFlight {
  startedAt: number
  duration: number
  fromPosition: THREE.Vector3
  toPosition: THREE.Vector3
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
  arcOffset: THREE.Vector3
}

const props = withDefaults(
  defineProps<{
    graph: RelationshipGalaxyRenderGraph
    selectedKey?: string | null
    safeInsetRight?: number
    label: string
  }>(),
  {
    selectedKey: null,
    safeInsetRight: 0,
  }
)

const emit = defineEmits<{
  (event: 'select-node', node: RelationshipGalaxyRenderNode): void
  (event: 'fallback'): void
}>()

const SELECTED_LABEL_LIMIT = 12

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
let activeFocusKey: string | null = null
let activeFocusFrameSignature: string | null = null
let pointerGestureStart: { x: number; y: number } | null = null
let pointerGestureMoved = false
let motionMediaQuery: MediaQueryList | null = null
let prefersReducedMotion = false
let ambientMaterial: THREE.ShaderMaterial | null = null
let nodeMaterial: THREE.ShaderMaterial | null = null
let nodePoints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
let renderedLayoutSignature: string | null = null

const graphGroup = new THREE.Group()
const environmentGroup = new THREE.Group()
const communityGlowGroup = new THREE.Group()
const fogVeilGroup = new THREE.Group()
const edgeGroup = new THREE.Group()
const nodeGroup = new THREE.Group()
const nodeObjects = new Map<string, NodeObject>()
const edgeLayerObjects: EdgeLayerObject[] = []
const nodeKeyByIndex: string[] = []
const neighborKeysOf = new Map<string, Set<string>>()
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const tmpWorldPosition = new THREE.Vector3()
let ambientVisibleEdgeIds = new Set<string>()
let selectedVisibleEdgeIds = new Set<string>()
let primarySelectedEdgeIds = new Set<string>()

function shortName(node: RelationshipGalaxyRenderNode): string {
  return node.displayName
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

function communityScenePosition(
  community: RelationshipGalaxy3DCommunity,
  model: RelationshipGalaxy3DScene
): THREE.Vector3 {
  const centerX = (model.bounds.minX + model.bounds.maxX) / 2
  const centerY = (model.bounds.minY + model.bounds.maxY) / 2
  return new THREE.Vector3(community.x - centerX, -(community.y - centerY), community.z)
}

function renderGraph(shouldFit = false) {
  if (!scene || !camera || !renderer) return

  const model = buildRelationshipGalaxy3DScene(props.graph, { selectedKey: props.selectedKey })
  sceneModel.value = model
  renderedLayoutSignature = buildRelationshipGalaxy3DSceneLayoutSignature(model)
  updateSelectedVisibleLabelKeys()
  clearGroup(environmentGroup)
  ambientMaterial = null
  clearGroup(communityGlowGroup)
  clearGroup(fogVeilGroup)
  clearGroup(edgeGroup)
  edgeLayerObjects.length = 0
  clearGroup(nodeGroup)
  nodeMaterial = null
  nodePoints = null
  nodeObjects.clear()
  nodeKeyByIndex.length = 0
  neighborKeysOf.clear()
  hoveredKey.value = null
  labelFrame = 0
  labels.value = []
  ambientVisibleEdgeIds = selectRelationshipGalaxy3DAmbientEdgeIds(model)
  selectedVisibleEdgeIds = selectRelationshipGalaxy3DSelectedEdgeIds(model)
  primarySelectedEdgeIds = selectRelationshipGalaxy3DPrimarySelectedEdgeIds(model)

  addAmbientEnvironment(model)
  addCommunityGlows(model)
  addFogVeils(model)
  rebuildNeighborKeys(model)
  renderEdgeLayers(model, false)

  addNodeLayer(model)

  if (shouldFit || !hasUserMovedCamera) fitView()
  refreshActiveFocus()
  resolvePendingFocus()
}

function applyGraphState() {
  if (!scene || !camera || !renderer) return
  if (!props.selectedKey) {
    activeFocusKey = null
    activeFocusFrameSignature = null
  }

  const model = buildRelationshipGalaxy3DScene(props.graph, { selectedKey: props.selectedKey })
  const nextLayoutSignature = buildRelationshipGalaxy3DSceneLayoutSignature(model)
  if (!nodePoints || renderedLayoutSignature !== nextLayoutSignature) {
    renderGraph(false)
    return
  }

  sceneModel.value = model
  updateSelectedVisibleLabelKeys()
  rebuildNeighborKeys(model)
  ambientVisibleEdgeIds = selectRelationshipGalaxy3DAmbientEdgeIds(model)
  selectedVisibleEdgeIds = selectRelationshipGalaxy3DSelectedEdgeIds(model)
  primarySelectedEdgeIds = selectRelationshipGalaxy3DPrimarySelectedEdgeIds(model)

  const nextNodeByKey = new Map(model.nodes.map((node) => [node.key, node]))
  for (const [key, object] of nodeObjects) {
    const nextNode = nextNodeByKey.get(key)
    if (nextNode) object.sceneNode = nextNode
  }

  labelFrame = 0
  if (prefersReducedMotion) {
    clearGroup(edgeGroup)
    edgeLayerObjects.length = 0
    renderEdgeLayers(model, false)
  } else {
    renderEdgeLayers(model, true)
  }
  refreshActiveFocus()
  resolvePendingFocus()
}

function rebuildNeighborKeys(model: RelationshipGalaxy3DScene) {
  neighborKeysOf.clear()
  for (const edge of model.edges) {
    if (!neighborKeysOf.has(edge.edge.sourceKey)) neighborKeysOf.set(edge.edge.sourceKey, new Set())
    if (!neighborKeysOf.has(edge.edge.targetKey)) neighborKeysOf.set(edge.edge.targetKey, new Set())
    neighborKeysOf.get(edge.edge.sourceKey)!.add(edge.edge.targetKey)
    neighborKeysOf.get(edge.edge.targetKey)!.add(edge.edge.sourceKey)
  }
}

function updateSelectedVisibleLabelKeys() {
  selectedVisibleLabelKeys.value = props.selectedKey
    ? buildRelationshipVisibleLabelKeys(props.graph, props.selectedKey, { limit: SELECTED_LABEL_LIMIT })
    : null
}

function addAmbientEnvironment(model: RelationshipGalaxy3DScene) {
  const particles = buildRelationshipGalaxy3DAmbientParticles(model)
  if (particles.length === 0) return

  const positions = new Float32Array(particles.length * 3)
  const colors = new Float32Array(particles.length * 3)
  const sizes = new Float32Array(particles.length)
  const opacities = new Float32Array(particles.length)
  const phases = new Float32Array(particles.length)
  const color = new THREE.Color()

  particles.forEach((particle, index) => {
    positions[index * 3] = particle.x
    positions[index * 3 + 1] = -particle.y
    positions[index * 3 + 2] = particle.z
    color.setHex(particle.color)
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
    sizes[index] = particle.size
    opacities[index] = particle.opacity
    phases[index] = particle.phase
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))

  ambientMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aOpacity;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vOpacity;
      varying float vPhase;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(aSize * (980.0 / max(120.0, -mvPosition.z)), 0.75, 6.5);
        vColor = aColor;
        vOpacity = aOpacity;
        vPhase = aPhase;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vColor;
      varying float vOpacity;
      varying float vPhase;
      void main() {
        float distanceToCenter = length(gl_PointCoord - vec2(0.5));
        float falloff = smoothstep(0.5, 0.03, distanceToCenter);
        if (falloff < 0.015) discard;
        float twinkle = 0.88 + sin(uTime * 0.22 + vPhase) * 0.12;
        gl_FragColor = vec4(vColor * falloff, falloff * vOpacity * twinkle);
      }
    `,
  })

  const starField = new THREE.Points(geometry, ambientMaterial)
  starField.frustumCulled = false
  starField.renderOrder = -3
  environmentGroup.add(starField)
}

function addCommunityGlows(model: RelationshipGalaxy3DScene) {
  for (const community of model.communities) {
    const material = new THREE.SpriteMaterial({
      map: getSoftGlowTexture(),
      color: community.color,
      transparent: true,
      opacity: community.opacity,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    })
    const glow = new THREE.Sprite(material)
    glow.position.copy(communityScenePosition(community, model))
    glow.scale.set(community.radius * 2.7, community.radius * 1.85, 1)
    glow.renderOrder = -2
    communityGlowGroup.add(glow)
  }
}

function addFogVeils(model: RelationshipGalaxy3DScene) {
  for (const veil of buildRelationshipGalaxy3DFogVeils(model)) {
    const material = new THREE.SpriteMaterial({
      map: getSoftGlowTexture(),
      color: veil.color,
      transparent: true,
      opacity: veil.opacity,
      blending: veil.foreground ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      rotation: veil.rotation,
    })
    const fog = new THREE.Sprite(material)
    fog.position.set(veil.x, -veil.y, veil.z)
    fog.scale.set(veil.width, veil.height, 1)
    fog.renderOrder = veil.foreground ? 4 : -1
    fogVeilGroup.add(fog)
  }
}

function renderEdgeLayers(model: RelationshipGalaxy3DScene, animate: boolean) {
  if (animate) {
    for (const object of edgeLayerObjects) {
      object.targetOpacity = 0
      object.disposeWhenHidden = true
    }
  }

  addEdgeLayer(model, 'dim', animate)
  addEdgeLayer(model, 'normal', animate)
  addEdgeLayer(model, 'highlight', animate)
}

function addEdgeLayer(model: RelationshipGalaxy3DScene, bucket: 'dim' | 'normal' | 'highlight', animate: boolean) {
  const edges = model.edges.filter((edge) => {
    if (props.selectedKey) {
      if (!selectedVisibleEdgeIds.has(edge.edge.id)) return false
      if (bucket === 'highlight') return primarySelectedEdgeIds.has(edge.edge.id)
      if (bucket === 'normal') return !primarySelectedEdgeIds.has(edge.edge.id)
      return false
    }
    if (!ambientVisibleEdgeIds.has(edge.edge.id)) return false
    if (bucket === 'highlight') return edge.highlighted
    if (bucket === 'dim') return edge.alpha <= 0.05
    return !edge.highlighted && edge.alpha > 0.05
  })
  if (edges.length === 0) return

  for (const band of groupEdgesByWidth(edges, bucket)) {
    addThinEdgePaths(model, band.edges, bucket, band.linewidth, animate)
  }
}

function addThinEdgePaths(
  model: RelationshipGalaxy3DScene,
  edges: RelationshipGalaxy3DEdge[],
  bucket: 'dim' | 'normal' | 'highlight',
  linewidth: number,
  animate: boolean
) {
  const targetOpacity = getEdgeLayerOpacity(bucket)
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: animate ? 0 : targetOpacity,
    linewidth,
    blending: THREE.AdditiveBlending,
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
  edgeLayerObjects.push({ line, targetOpacity, disposeWhenHidden: false })
}

function getEdgeLayerOpacity(bucket: 'dim' | 'normal' | 'highlight'): number {
  if (bucket === 'highlight') return 0.76
  if (bucket === 'normal' && props.selectedKey) return 0.09
  if (bucket === 'normal') return 0.14
  return 0.028
}

function updateEdgeLayerTransitions() {
  for (let index = edgeLayerObjects.length - 1; index >= 0; index -= 1) {
    const object = edgeLayerObjects[index]
    const material = object.line.material
    material.opacity += (object.targetOpacity - material.opacity) * 0.14
    if (!object.disposeWhenHidden || material.opacity >= 0.006) continue

    edgeGroup.remove(object.line)
    disposeObject(object.line)
    edgeLayerObjects.splice(index, 1)
  }
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
  const endpointFade = 0.08 + Math.pow(Math.sin(Math.PI * progress), 0.62) * 0.92
  vertexColor.multiplyScalar(endpointFade)
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

function addNodeLayer(model: RelationshipGalaxy3DScene) {
  if (model.nodes.length === 0) return

  const positions = new Float32Array(model.nodes.length * 3)
  const colors = new Float32Array(model.nodes.length * 3)
  const sizes = new Float32Array(model.nodes.length)
  const opacities = new Float32Array(model.nodes.length)
  const seeds = new Float32Array(model.nodes.length)
  const color = new THREE.Color()

  model.nodes.forEach((sceneNode, index) => {
    const basePosition = scenePosition(sceneNode, model)
    positions[index * 3] = basePosition.x
    positions[index * 3 + 1] = basePosition.y
    positions[index * 3 + 2] = basePosition.z
    color.setHex(sceneNode.color)
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
    sizes[index] = sceneNode.radius
    opacities[index] = sceneNode.opacity
    seeds[index] = sceneNode.seed
    nodeKeyByIndex[index] = sceneNode.key
    nodeObjects.set(sceneNode.key, {
      sceneNode,
      basePosition,
      currentPosition: basePosition.clone(),
      phase: sceneNode.seed * Math.PI * 2,
      index,
    })
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))

  // Inspired by Shiyun: one continuously fading shader point forms both the white core and colored outer glow,
  // avoiding the rings and blur produced by stacked sprites.
  nodeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSizeScale: { value: 1500 },
    },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aOpacity;
      attribute float aSeed;
      uniform float uTime;
      uniform float uSizeScale;
      varying vec3 vColor;
      varying float vOpacity;
      varying float vTwinkle;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(aSize * (uSizeScale / max(120.0, -mvPosition.z)), 1.2, 72.0);
        vColor = aColor;
        vOpacity = aOpacity;
        vTwinkle = 0.88 + 0.12 * sin(uTime * 0.7 + aSeed * 6.2831853);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vOpacity;
      varying float vTwinkle;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float halo = exp(-radius * radius * 4.5);
        if (halo < 0.006) discard;
        float core = exp(-radius * radius * 58.0);
        float coreMix = clamp(core * 1.45, 0.0, 1.0);
        vec3 color = mix(vColor * 1.72, vec3(2.25), coreMix);
        float alpha = min(1.0, halo * 0.55 + core * 0.72) * vOpacity * vTwinkle;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  })
  nodePoints = new THREE.Points(geometry, nodeMaterial)
  nodePoints.frustumCulled = false
  nodePoints.renderOrder = 2
  nodeGroup.add(nodePoints)
}

function updateAnimation() {
  if (!renderer || !scene || !camera || !controls) return

  const elapsedMs = performance.now() - animationStartedAt
  updateCameraFlight()

  const autoDrift = prefersReducedMotion ? 0 : hasUserMovedCamera ? 0.003 : 0.008
  graphGroup.rotation.y = Math.sin(elapsedMs / 25_000) * autoDrift
  graphGroup.rotation.x = Math.cos(elapsedMs / 30_000) * autoDrift * 0.4
  environmentGroup.rotation.z = prefersReducedMotion ? 0 : Math.sin(elapsedMs / 90_000) * 0.004
  fogVeilGroup.rotation.z = prefersReducedMotion ? 0 : Math.sin(elapsedMs / 52_000) * 0.008
  fogVeilGroup.rotation.x = prefersReducedMotion ? 0 : Math.cos(elapsedMs / 68_000) * 0.003
  if (ambientMaterial) ambientMaterial.uniforms.uTime.value = prefersReducedMotion ? 0 : elapsedMs / 1000
  if (nodeMaterial) nodeMaterial.uniforms.uTime.value = prefersReducedMotion ? 0 : elapsedMs / 1000
  updateEdgeLayerTransitions()
  const activeKey = hoveredKey.value || props.selectedKey
  const positionAttribute = nodePoints?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const sizeAttribute = nodePoints?.geometry.getAttribute('aSize') as THREE.BufferAttribute | undefined
  const opacityAttribute = nodePoints?.geometry.getAttribute('aOpacity') as THREE.BufferAttribute | undefined
  const positionArray = positionAttribute?.array as Float32Array | undefined
  const sizeArray = sizeAttribute?.array as Float32Array | undefined
  const opacityArray = opacityAttribute?.array as Float32Array | undefined

  for (const object of nodeObjects.values()) {
    const t = elapsedMs / 1000 + object.phase
    const isSelected = object.sceneNode.key === props.selectedKey
    const isActive = object.sceneNode.key === activeKey
    const isActiveNeighbor = Boolean(activeKey && neighborKeysOf.get(activeKey)?.has(object.sceneNode.key))
    const motionScale = isSelected ? 0.3 : 0.8
    const hoverScale = hoveredKey.value === object.sceneNode.key ? 1.18 : 1
    const selectedScale = isSelected ? 1.12 : 1
    const neighborScale = isActiveNeighbor ? 1.05 : 1

    if (prefersReducedMotion) {
      object.currentPosition.copy(object.basePosition)
    } else {
      object.currentPosition.set(
        object.basePosition.x + Math.sin(t * 0.3) * 2.0 * motionScale,
        object.basePosition.y + Math.cos(t * 0.25) * 1.5 * motionScale,
        object.basePosition.z + Math.sin(t * 0.2) * 4.0 * motionScale
      )
    }
    const shimmer = prefersReducedMotion ? 1 : 1 + Math.sin(t * 0.8) * 0.008
    let opacity = object.sceneNode.opacity

    if (activeKey) {
      if (isActive) {
        opacity = 1
      } else if (isActiveNeighbor) {
        opacity = 0.85
      } else {
        opacity = 0.18
      }
    }

    const index = object.index
    if (positionArray) {
      positionArray[index * 3] = object.currentPosition.x
      positionArray[index * 3 + 1] = object.currentPosition.y
      positionArray[index * 3 + 2] = object.currentPosition.z
    }
    if (sizeArray) {
      const targetSize = object.sceneNode.radius * shimmer * hoverScale * selectedScale * neighborScale
      sizeArray[index] += (targetSize - sizeArray[index]) * 0.16
    }
    if (opacityArray) opacityArray[index] += (opacity - opacityArray[index]) * 0.16
  }

  if (positionAttribute) positionAttribute.needsUpdate = true
  if (sizeAttribute) sizeAttribute.needsUpdate = true
  if (opacityAttribute) opacityAttribute.needsUpdate = true

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
  camera.position.addScaledVector(cameraFlight.arcOffset, Math.sin(Math.PI * eased))
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
  const sceneSpan = Math.max(
    sceneModel.value.bounds.width,
    sceneModel.value.bounds.height,
    sceneModel.value.bounds.depth,
    1
  )
  const cameraDistance = controls ? camera.position.distanceTo(controls.target) : sceneSpan
  const zoomLabelRankLimit = getRelationshipGalaxy3DZoomLabelRankLimit(cameraDistance, sceneSpan)
  const nodeOpacityArray = (nodePoints?.geometry.getAttribute('aOpacity')?.array as Float32Array | undefined) ?? null

  for (const object of nodeObjects.values()) {
    const selected = object.sceneNode.key === selectedKey
    const selectedNeighbor = Boolean(selectedKey && selectedNeighborKeys?.has(object.sceneNode.key))
    const labelTier = getRelationshipGalaxy3DDynamicLabelTier(
      object.sceneNode,
      selectedKey ?? null,
      hoveredKey.value,
      selectedVisibleLabelKeys.value,
      zoomLabelRankLimit
    )
    if (labelTier === 0) continue

    tmpWorldPosition.copy(object.currentPosition)
    graphGroup.localToWorld(tmpWorldPosition)
    const projected = tmpWorldPosition.clone().project(camera)
    if (projected.z < -1 || projected.z > 1) continue

    const x = (projected.x * 0.5 + 0.5) * width
    const y = (-projected.y * 0.5 + 0.5) * height
    if (x < -80 || x > width + 80 || y < -40 || y > height + 40) continue

    nextLabels.push({
      key: object.sceneNode.key,
      text: shortName(object.sceneNode.node),
      rank: object.sceneNode.node.rank,
      x,
      y: y + object.sceneNode.radius + 8,
      opacity: selected ? 1 : Math.max(0.42, nodeOpacityArray?.[object.index] ?? object.sceneNode.opacity),
      selected,
      emphasis: getLabelEmphasis(object.sceneNode, selectedNeighbor, labelTier),
    })
  }

  labels.value = resolveVisibleLabelCollisions(nextLabels)
}

function resolveVisibleLabelCollisions(candidates: VisibleLabel[]): VisibleLabel[] {
  const emphasisWeight: Record<VisibleLabel['emphasis'], number> = { major: 2, medium: 1, minor: 0 }
  const sorted = [...candidates].sort(
    (a, b) =>
      Number(b.selected) - Number(a.selected) ||
      emphasisWeight[b.emphasis] - emphasisWeight[a.emphasis] ||
      a.rank - b.rank ||
      a.key.localeCompare(b.key)
  )
  const visible: VisibleLabel[] = []

  // Even a small label set can overlap in the core cluster; preserve labels by visual priority without changing data.
  for (const candidate of sorted) {
    const candidateWidth = estimateLabelWidth(candidate)
    const overlaps = visible.some((item) => {
      const horizontalGap = (candidateWidth + estimateLabelWidth(item)) / 2 + 8
      return Math.abs(candidate.x - item.x) < horizontalGap && Math.abs(candidate.y - item.y) < 18
    })
    if (!candidate.selected && overlaps) continue
    visible.push(candidate)
  }

  return visible
}

function estimateLabelWidth(label: VisibleLabel): number {
  const fontSize = label.emphasis === 'major' ? 12 : label.emphasis === 'medium' ? 10.5 : 9.5
  const textUnits = [...label.text].reduce(
    (sum, character) => sum + ((character.codePointAt(0) ?? 0) <= 0x7f ? 0.58 : 1),
    0
  )
  return Math.min(190, Math.max(24, textUnits * fontSize + 4))
}

function getLabelEmphasis(
  sceneNode: RelationshipGalaxy3DNode,
  selectedNeighbor = false,
  labelTier = sceneNode.labelTier
): VisibleLabel['emphasis'] {
  if (labelTier === 2 || sceneNode.node.visualRole === 'anchor' || sceneNode.node.rank <= 5) return 'major'
  if (selectedNeighbor) return 'medium'
  if (sceneNode.node.rank <= 30) return 'medium'
  return 'minor'
}

async function initCanvas() {
  const host = canvasRoot.value
  if (!host || renderer) return

  const size = getViewportSize()
  scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x050711, 0.00022)

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
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.domElement.className = 'h-full w-full'
  host.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.055
  controls.rotateSpeed = 0.34
  controls.zoomSpeed = 0.72
  controls.panSpeed = 0.58
  controls.minDistance = 160
  controls.maxDistance = 18_000
  controls.addEventListener('start', () => {
    hasUserMovedCamera = true
    cameraFlight = null
    activeFocusKey = null
    activeFocusFrameSignature = null
  })

  graphGroup.add(communityGlowGroup, fogVeilGroup, edgeGroup, nodeGroup)
  scene.add(environmentGroup, graphGroup)

  renderer.domElement.addEventListener('pointermove', handlePointerMove)
  renderer.domElement.addEventListener('pointerdown', handlePointerDown)
  renderer.domElement.addEventListener('pointercancel', handlePointerCancel)
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
  if (
    pointerGestureStart &&
    hasExceededRelationshipGalaxyPointerDragThreshold(pointerGestureStart, {
      x: event.clientX,
      y: event.clientY,
    })
  ) {
    pointerGestureMoved = true
  }
  if (!renderer || !camera || !nodePoints) return
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  raycaster.params.Points.threshold = 18
  const [hit] = raycaster.intersectObject(nodePoints, false)
  hoveredKey.value = typeof hit?.index === 'number' ? (nodeKeyByIndex[hit.index] ?? null) : null
}

function handlePointerDown(event: PointerEvent) {
  pointerGestureStart = { x: event.clientX, y: event.clientY }
  pointerGestureMoved = false
}

function handlePointerCancel() {
  pointerGestureStart = null
  pointerGestureMoved = false
}

function handlePointerLeave() {
  hoveredKey.value = null
}

function handleClick() {
  const action = resolveRelationshipGalaxyPointerClickAction(hoveredKey.value, pointerGestureMoved)
  pointerGestureStart = null
  pointerGestureMoved = false
  if (action.type === 'ignore') return

  const object = nodeObjects.get(action.key)
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

function focusNode(key: string, duration = 760): boolean {
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
  const focusFrame = buildNodeFocusFrame(key)
  activeFocusKey = key
  activeFocusFrameSignature = buildFocusFrameSignature(focusFrame)
  const sceneSpan = Math.max(
    sceneModel.value.bounds.width,
    sceneModel.value.bounds.height,
    sceneModel.value.bounds.depth
  )
  const pose = applySafeAreaToCameraPose(
    buildRelationshipGalaxy3DFocusCameraPose(
      {
        position: vectorToPose(camera.position),
        target: vectorToPose(controls.target),
      },
      focusFrame.target,
      sceneSpan,
      {
        orbitSeed: object.sceneNode.seed,
        focusPoints: focusFrame.points,
        fovDegrees: camera.fov,
        aspectRatio: camera.aspect,
      }
    )
  )
  startCameraFlight(
    new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z),
    new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z),
    duration,
    object.sceneNode.seed < 0.5 ? -1 : 1
  )
  return true
}

function refreshActiveFocus() {
  if (!props.selectedKey || activeFocusKey !== props.selectedKey) return
  const focusFrame = buildNodeFocusFrame(props.selectedKey)
  const nextSignature = buildFocusFrameSignature(focusFrame)
  if (nextSignature === activeFocusFrameSignature) return

  // People neighborhood data can arrive after the initial focus; continue from the current camera to keep new points
  // in view while correcting the destination.
  focusNode(props.selectedKey, cameraFlight ? 520 : 620)
}

function buildNodeFocusFrame(key: string) {
  const selected = nodeObjects.get(key)
  if (!selected) {
    return {
      ...buildRelationshipGalaxy3DFocusFrame([], { x: 0, y: 0, z: 0 }),
      points: [],
      signature: '',
    }
  }

  const keys = new Set([key, ...(neighborKeysOf.get(key) ?? [])])
  const sortedKeys = [...keys].sort()
  const points = sortedKeys.flatMap((nodeKey) => {
    const object = nodeObjects.get(nodeKey)
    if (!object) return []
    const position = object.basePosition.clone()
    graphGroup.localToWorld(position)
    return [vectorToPose(position)]
  })
  const fallbackPosition = selected.basePosition.clone()
  graphGroup.localToWorld(fallbackPosition)
  return {
    ...buildRelationshipGalaxy3DFocusFrame(points, vectorToPose(fallbackPosition)),
    points,
    signature: sortedKeys
      .map((nodeKey) => {
        const position = nodeObjects.get(nodeKey)?.basePosition
        return position ? `${nodeKey}:${position.x}:${position.y}:${position.z}` : nodeKey
      })
      .join('|'),
  }
}

function buildFocusFrameSignature(frame: { signature: string }): string {
  return frame.signature
}

function captureView() {
  return captureRelationshipGalaxy3DCameraView(camera?.position, controls?.target, hasUserMovedCamera)
}

function restoreView(view: unknown): boolean {
  const restoredView = parseRelationshipGalaxy3DCameraView(view)
  if (!restoredView || !camera || !controls) return false

  pendingFocusKey = null
  activeFocusKey = null
  activeFocusFrameSignature = null
  hasUserMovedCamera = restoredView.hasUserMovedCamera
  applyCameraSafeAreaProjection()
  startCameraFlight(
    new THREE.Vector3(restoredView.position.x, restoredView.position.y, restoredView.position.z),
    new THREE.Vector3(restoredView.target.x, restoredView.target.y, restoredView.target.z),
    620
  )
  return true
}

function fitView() {
  if (!camera || !controls) return

  activeFocusKey = null
  activeFocusFrameSignature = null
  hasUserMovedCamera = false
  const pose = applySafeAreaToCameraPose(buildRelationshipGalaxy3DImmersiveCameraPose(sceneModel.value.bounds))
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
  applyRelationshipGalaxy3DCameraViewOffset(camera, {
    viewportWidth: size.width,
    viewportHeight: size.height,
    safeInsetRight: props.safeInsetRight,
  })
}

function vectorToPose(vector: THREE.Vector3): RelationshipGalaxy3DCameraPose['position'] {
  return { x: vector.x, y: vector.y, z: vector.z }
}

function startCameraFlight(toPosition: THREE.Vector3, toTarget: THREE.Vector3, duration: number, arcDirection = 0) {
  if (!camera || !controls) return
  if (prefersReducedMotion) {
    camera.position.copy(toPosition)
    controls.target.copy(toTarget)
    cameraFlight = null
    controls.update()
    return
  }
  cameraFlight = {
    startedAt: performance.now(),
    duration,
    fromPosition: camera.position.clone(),
    toPosition,
    fromTarget: controls.target.clone(),
    toTarget,
    arcOffset: buildCameraFlightArcOffset(camera.position, toPosition, arcDirection),
  }
}

function buildCameraFlightArcOffset(from: THREE.Vector3, to: THREE.Vector3, direction: number): THREE.Vector3 {
  if (direction === 0) return new THREE.Vector3()
  const travel = to.clone().sub(from)
  const distance = travel.length()
  if (distance <= 1) return new THREE.Vector3()

  const side = new THREE.Vector3(-travel.z, 0, travel.x)
  if (side.lengthSq() <= 0.0001) side.set(1, 0, 0)
  side.normalize().multiplyScalar(distance * 0.14 * Math.sign(direction))
  side.y += Math.min(120, distance * 0.055)
  return side
}

function syncMotionPreference() {
  prefersReducedMotion = motionMediaQuery?.matches ?? false
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

const textureCache = new Map<string, THREE.CanvasTexture>()

function getSoftGlowTexture(): THREE.CanvasTexture {
  const key = 'soft-glow'
  const cached = textureCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) throw new Error('failed to create galaxy glow texture context')

  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,0.96)')
  gradient.addColorStop(0.16, 'rgba(255,255,255,0.46)')
  gradient.addColorStop(0.42, 'rgba(255,255,255,0.12)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  textureCache.set(key, texture)
  return texture
}

onMounted(async () => {
  motionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  syncMotionPreference()
  motionMediaQuery.addEventListener('change', syncMotionPreference)
  await nextTick()
  await initCanvas()
})

watch([() => props.graph, () => props.selectedKey], applyGraphState, {
  flush: 'post',
})

watch(
  () => props.safeInsetRight,
  () => {
    applyCameraSafeAreaProjection()
  },
  { flush: 'post' }
)

onBeforeUnmount(() => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  motionMediaQuery?.removeEventListener('change', syncMotionPreference)
  motionMediaQuery = null
  resizeObserver?.disconnect()
  resizeObserver = null

  if (renderer) {
    renderer.domElement.removeEventListener('pointermove', handlePointerMove)
    renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
    renderer.domElement.removeEventListener('pointercancel', handlePointerCancel)
    renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
    renderer.domElement.removeEventListener('click', handleClick)
  }

  clearGroup(environmentGroup)
  clearGroup(communityGlowGroup)
  clearGroup(fogVeilGroup)
  clearGroup(edgeGroup)
  clearGroup(nodeGroup)
  for (const texture of textureCache.values()) texture.dispose()
  textureCache.clear()
  graphGroup.clear()
  environmentGroup.clear()
  scene?.clear()
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()

  renderer = null
  scene = null
  camera = null
  controls = null
  renderedLayoutSignature = null
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
  background:
    radial-gradient(ellipse at 46% 44%, rgba(92, 73, 144, 0.1) 0%, rgba(12, 14, 30, 0.02) 44%, transparent 68%),
    radial-gradient(ellipse at 62% 58%, rgba(32, 112, 152, 0.08) 0%, transparent 52%),
    radial-gradient(ellipse at 32% 62%, rgba(150, 46, 90, 0.055) 0%, transparent 48%),
    linear-gradient(180deg, #070813 0%, #03050c 58%, #020309 100%);
  box-shadow: inset 0 0 180px rgba(0, 0, 0, 0.74);
}

.relationship-galaxy-3d__label {
  pointer-events: auto;
  position: absolute;
  border: 0;
  max-width: 190px;
  padding: 0;
  transform: translate(-50%, 0);
  background: transparent;
  color: rgba(230, 236, 255, 0.56);
  cursor: pointer;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.035em;
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
  color: rgba(240, 244, 255, 0.88);
  font-size: 10.5px;
  font-weight: 750;
  text-shadow:
    0 0 3px rgba(0, 0, 0, 0.95),
    0 1px 5px rgba(0, 0, 0, 1);
}

.relationship-galaxy-3d__label--major {
  color: #fbfcff;
  font-size: 12px;
  font-weight: 850;
  text-shadow:
    0 0 4px rgba(255, 255, 255, 0.26),
    0 2px 10px rgba(0, 0, 0, 1);
}

.relationship-galaxy-3d__label--selected {
  color: #fff6fb;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-shadow:
    0 0 10px rgba(255, 134, 173, 0.42),
    0 2px 12px rgba(0, 0, 0, 1);
}
</style>
