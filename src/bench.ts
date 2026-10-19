import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CubicBezierCurve3,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineCurve3,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Curve,
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { stripOf, type Divergence, type HoleId, type PartsCatalog, type PointId } from "./netlist"
import type { SolveResult } from "./solver"
import { nextInstanceId, prefixFor, type AppView, type BenchPlacement, type CircuitDoc, type Wire } from "./state"
import { particleSpeed } from "./ui"

export type BenchTool = "select" | "wire" | { place: string; value?: number; id?: string } | "meter"
export type BenchSelection = { kind: "wire" | "part"; id: string }
export type BenchCallbacks = {
  onChange(doc: CircuitDoc, commit: boolean): void
  onEvent(name: string): void
  onSelect?(selection: BenchSelection | null): void
  onHint?(text: string | null): void
}
export type BenchRenderOpts = { currentView: boolean; reducedMotion: boolean; preview?: SolveResult; divergences?: Divergence[] }

export const PITCH = 2.54
const COLUMNS = 30
const ROWS = "ABCDEFGHIJ"
const ROW_Z: Record<string, number> = { A: -5.5, B: -4.5, C: -3.5, D: -2.5, E: -1.5, F: 1.5, G: 2.5, H: 3.5, I: 4.5, J: 5.5 }
const RAIL_Z: Record<string, number> = { "T+": -8.5, "T-": -7.5, "B+": 7.5, "B-": 8.5 }
const BOARD_HEIGHT = 8.5
const MAT_Y = -BOARD_HEIGHT
const BOARD_HALF_X = (COLUMNS / 2 + 1.5) * PITCH
const BOARD_HALF_Z = 10 * PITCH
const WIRE_RADIUS = 0.32
const WIRE_COLORS = { positive: "#C62828", negative: "#202020", neutral: "#3D8BD9" }

export const WIRE_PALETTE = [
  { value: "#3D8BD9", name: "Azul" },
  { value: "#C62828", name: "Vermelho" },
  { value: "#202020", name: "Preto" },
  { value: "#2E9E5B", name: "Verde" },
  { value: "#E0954A", name: "Laranja" },
  { value: "#E6EDF3", name: "Branco" },
]

const COLOR = {
  mat: 0x1a2128,
  board: 0xf2f0ea,
  hole: 0x3a3f45,
  holeStrip: 0x8a9aab,
  accent: 0xe0954a,
  positive: 0xe5534b,
  negative: 0x5aa9e6,
  current: 0xffd166,
  warning: 0xe3b341,
}

export function holePosition(hole: HoleId): { x: number; z: number } | null {
  const terminal = /^([A-J])([1-9]\d?)$/.exec(hole)
  const rail = /^([TB][+-])([1-9]\d?)$/.exec(hole)
  const match = terminal ?? rail
  if (!match) return null
  const col = Number(match[2])
  if (col < 1 || col > COLUMNS) return null
  const z = terminal ? ROW_Z[match[1]] : RAIL_Z[match[1]]
  return { x: (col - (COLUMNS + 1) / 2) * PITCH, z: z * PITCH }
}

export function nearestHole(x: number, z: number): HoleId | null {
  const col = Math.round(x / PITCH + (COLUMNS + 1) / 2)
  if (col < 1 || col > COLUMNS) return null
  let best: string | null = null
  let bestDist = Infinity
  for (const [row, rz] of [...Object.entries(ROW_Z), ...Object.entries(RAIL_Z)]) {
    const d = Math.abs(rz * PITCH - z)
    if (d < bestDist) {
      bestDist = d
      best = row
    }
  }
  if (best === null) return null
  const hole = `${best}${col}`
  const pos = holePosition(hole)
  if (!pos || Math.hypot(pos.x - x, pos.z - z) > PITCH * 0.75) return null
  return hole
}

function allHoles(): HoleId[] {
  const holes: HoleId[] = []
  for (let col = 1; col <= COLUMNS; col++) {
    for (const row of ROWS) holes.push(`${row}${col}`)
    for (const rail of Object.keys(RAIL_Z)) holes.push(`${rail}${col}`)
  }
  return holes
}

function gridOf(hole: HoleId): { col: number; row: number } | null {
  const m = /^([A-J])([1-9]\d?)$/.exec(hole)
  if (!m) return null
  return { col: Number(m[2]), row: ROWS.indexOf(m[1]) }
}

function holeAt(col: number, row: number): HoleId | null {
  if (col < 1 || col > COLUMNS || row < 0 || row > 9) return null
  return `${ROWS[row]}${col}`
}

function rotateOffset([dc, dr]: [number, number], rotation: number): [number, number] {
  switch (rotation) {
    case 90:
      return [-dr, dc]
    case 180:
      return [-dc, -dr]
    case 270:
      return [dr, -dc]
    default:
      return [dc, dr]
  }
}

export function suggestedWireColor(start: HoleId): string {
  const strip = stripOf(start)
  if (strip === "rail-T+" || strip === "rail-B+") return WIRE_COLORS.positive
  if (strip === "rail-T-" || strip === "rail-B-") return WIRE_COLORS.negative
  return WIRE_COLORS.neutral
}

type OffboardShape = { size: [number, number, number]; pins: Record<string, [number, number, number]> }

const OFFBOARD: Record<string, OffboardShape> = {
  battery: { size: [26, 17, 46], pins: { "+": [-6, 9, -23], "-": [6, 9, -23] } },
  lamp: { size: [14, 8, 14], pins: { a: [-7, 2, 0], b: [7, 2, 0] } },
  logic_probe: { size: [8, 8, 34], pins: { IN: [-2, 4, -17], GND: [3, 4, -17] } },
  dc_motor: { size: [20, 20, 26], pins: { "+": [-5, 4, -13], "-": [5, 4, -13] } },
  buzzer: { size: [12, 9, 12], pins: { "+": [-6, 2, 0], "-": [6, 2, 0] } },
}

function offboardShape(type: string): OffboardShape {
  return OFFBOARD[type] ?? { size: [10, 8, 10], pins: {} }
}

const CHIP_CODES: Record<string, string> = {
  chip_nand: "7400",
  chip_nor: "7402",
  chip_not: "7404",
  chip_and: "7408",
  chip_or: "7432",
  chip_xor: "7486",
  chip_xnor: "XNOR",
}

const labelCache = new Map<string, CanvasTexture>()

function textTexture(text: string, color = "#E6EDF3", background = "rgba(14,20,27,0.85)"): CanvasTexture {
  const key = `${text}|${color}|${background}`
  const cached = labelCache.get(key)
  if (cached) return cached
  const canvas = document.createElement("canvas")
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = background
  ctx.beginPath()
  ctx.roundRect(4, 8, 120, 48, 10)
  ctx.fill()
  ctx.fillStyle = color
  ctx.font = "600 30px 'IBM Plex Mono', monospace"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, 64, 33)
  const texture = new CanvasTexture(canvas)
  labelCache.set(key, texture)
  return texture
}

function label(text: string, scale = 7, color?: string, background?: string): Sprite {
  const sprite = new Sprite(new SpriteMaterial({ map: textTexture(text, color, background), depthTest: false }))
  sprite.scale.set(scale, scale / 2, 1)
  sprite.renderOrder = 10
  return sprite
}

type IconName = "forbidden" | "turnCw" | "turnCcw" | "levelHigh" | "levelLow" | "levelUnknown"
const iconCache = new Map<string, CanvasTexture>()

function iconTexture(name: IconName, color: string): CanvasTexture {
  const key = `${name}|${color}`
  const cached = iconCache.get(key)
  if (cached) return cached
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "rgba(14,20,27,0.85)"
  ctx.beginPath()
  ctx.arc(32, 32, 30, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 5
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  if (name === "forbidden") {
    ctx.beginPath()
    ctx.arc(32, 32, 16, 0, Math.PI * 2)
    ctx.moveTo(21, 43)
    ctx.lineTo(43, 21)
    ctx.stroke()
  } else if (name === "levelHigh" || name === "levelLow") {
    const up = name === "levelHigh"
    ctx.beginPath()
    ctx.moveTo(32, up ? 46 : 18)
    ctx.lineTo(32, up ? 18 : 46)
    ctx.moveTo(22, up ? 28 : 36)
    ctx.lineTo(32, up ? 18 : 46)
    ctx.lineTo(42, up ? 28 : 36)
    ctx.stroke()
  } else if (name === "levelUnknown") {
    ctx.beginPath()
    ctx.arc(32, 25, 8, Math.PI * 1.1, Math.PI * 0.4)
    ctx.quadraticCurveTo(32, 33, 32, 38)
    ctx.stroke()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(32, 46, 3, 0, Math.PI * 2)
    ctx.fill()
  } else {
    const cw = name === "turnCw"
    const start = -Math.PI * 0.8
    const end = Math.PI * 0.55
    ctx.save()
    if (!cw) {
      ctx.translate(64, 0)
      ctx.scale(-1, 1)
    }
    ctx.beginPath()
    ctx.arc(32, 32, 15, start, end)
    ctx.stroke()
    const tx = 32 + 15 * Math.cos(end)
    const ty = 32 + 15 * Math.sin(end)
    ctx.beginPath()
    ctx.moveTo(tx + 8, ty - 1)
    ctx.lineTo(tx, ty)
    ctx.lineTo(tx + 2, ty - 8)
    ctx.stroke()
    ctx.restore()
  }
  const texture = new CanvasTexture(canvas)
  iconCache.set(key, texture)
  return texture
}

function iconSprite(name: IconName, color: string, size = 5): Sprite {
  const sprite = new Sprite(new SpriteMaterial({ map: iconTexture(name, color), depthTest: false }))
  sprite.scale.set(size, size, 1)
  sprite.renderOrder = 10
  return sprite
}

let glowTexture: CanvasTexture | null = null

function glow(): CanvasTexture {
  if (glowTexture) return glowTexture
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext("2d")!
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
  gradient.addColorStop(0, "rgba(255,226,150,0.9)")
  gradient.addColorStop(0.35, "rgba(255,200,110,0.35)")
  gradient.addColorStop(1, "rgba(255,190,90,0)")
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  glowTexture = new CanvasTexture(canvas)
  return glowTexture
}

let hatchTexture: CanvasTexture | null = null

function hatch(): CanvasTexture {
  if (hatchTexture) return hatchTexture
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 32
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "rgba(229,83,75,0.35)"
  ctx.fillRect(0, 0, 32, 32)
  ctx.strokeStyle = "rgba(229,83,75,0.95)"
  ctx.lineWidth = 4
  for (let i = -32; i < 64; i += 10) {
    ctx.beginPath()
    ctx.moveTo(i, 32)
    ctx.lineTo(i + 32, 0)
    ctx.stroke()
  }
  hatchTexture = new CanvasTexture(canvas)
  return hatchTexture
}

function wireCurve(a: Vector3, b: Vector3, liftBase = 0): CubicBezierCurve3 {
  const height = Math.max(PITCH, 0.35 * a.distanceTo(b)) + liftBase
  return new CubicBezierCurve3(a, a.clone().setY(a.y + height), b.clone().setY(b.y + height), b)
}

function std(color: number | string, extra: Partial<{ emissive: number; emissiveIntensity: number; roughness: number; metalness: number; transparent: boolean; opacity: number }> = {}) {
  return new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...extra })
}

type Pickable = { kind: "part" | "wire" | "wireEnd" | "leadEnd"; id: string; end?: "a" | "b"; pin?: string }
type Drag = { pick: Pickable; doc: CircuitDoc; moved: boolean }
type Mode =
  | { kind: "idle" }
  | { kind: "wire"; start: HoleId | null }
  | { kind: "rigid"; type: string; value?: number; id?: string; rotation: 0 | 90 | 180 | 270 }
  | { kind: "offboard"; type: string; value?: number; id?: string }
  | { kind: "leads"; id: string; pins: string[]; index: number }
type Particle = { mesh: Mesh; curve: Curve<Vector3>; length: number; t: number; speed: number; direction: number }
type Spinner = { obj: Object3D; direction: number }

export function createBench(container: HTMLElement, catalog: PartsCatalog, cb: BenchCallbacks) {
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x0e141b)
  container.appendChild(renderer.domElement)

  const scene = new Scene()
  const camera = new PerspectiveCamera(40, 1, 1, 3000)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI * 0.45
  controls.minDistance = 50
  controls.maxDistance = 420
  controls.mouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2 }
  controls.addEventListener("end", () => cb.onEvent("cameraOrbited"))

  scene.add(new HemisphereLight(0xfff1dc, 0x1a2128, 0.6))
  scene.add(new AmbientLight(0xffffff, 0.15))
  const key = new DirectionalLight(0xffe2b8, 1.6)
  key.position.set(-80, 160, 90)
  scene.add(key)
  const fill = new DirectionalLight(0x9fc4ff, 0.35)
  fill.position.set(120, 60, -80)
  scene.add(fill)

  const mat = new Mesh(new PlaneGeometry(900, 900), std(COLOR.mat, { roughness: 0.95 }))
  mat.rotation.x = -Math.PI / 2
  mat.position.y = MAT_Y
  scene.add(mat)

  const board = new Mesh(new BoxGeometry(BOARD_HALF_X * 2, BOARD_HEIGHT, BOARD_HALF_Z * 2), std(COLOR.board, { roughness: 0.8 }))
  board.position.y = -BOARD_HEIGHT / 2
  scene.add(board)

  const channel = new Mesh(new BoxGeometry(BOARD_HALF_X * 2 - 2, 0.2, PITCH * 0.9), std(0xd8d4ca))
  channel.position.y = 0.01
  scene.add(channel)

  for (const [rail, z] of Object.entries(RAIL_Z)) {
    const positive = rail.endsWith("+")
    const stripe = new Mesh(new BoxGeometry(COLUMNS * PITCH, 0.05, 0.3), new MeshBasicMaterial({ color: positive ? COLOR.positive : COLOR.negative }))
    const offset = rail.startsWith("T") ? -0.6 : 0.6
    stripe.position.set(0, 0.03, (z + offset) * PITCH)
    scene.add(stripe)
    for (const side of [-1, 1]) {
      const glyph = label(positive ? "+" : "−", 6, positive ? "#E5534B" : "#5AA9E6", "rgba(0,0,0,0)")
      glyph.position.set(side * (COLUMNS / 2 + 0.9) * PITCH, 1.2, z * PITCH)
      scene.add(glyph)
    }
  }

  const holes = allHoles()
  const holeIndex = new Map(holes.map((h, i) => [h, i]))
  const holeMesh = new InstancedMesh(new BoxGeometry(1.1, 0.06, 1.1), new MeshBasicMaterial({ color: 0xffffff }), holes.length)
  const dummy = new Object3D()
  holes.forEach((h, i) => {
    const p = holePosition(h)!
    dummy.position.set(p.x, 0.04, p.z)
    dummy.updateMatrix()
    holeMesh.setMatrixAt(i, dummy.matrix)
    holeMesh.setColorAt(i, new Color(COLOR.hole))
  })
  scene.add(holeMesh)

  const hoverRing = new Mesh(new RingGeometry(0.9, 1.4, 24), new MeshBasicMaterial({ color: COLOR.accent, depthTest: false }))
  hoverRing.rotation.x = -Math.PI / 2
  hoverRing.renderOrder = 5
  hoverRing.visible = false
  scene.add(hoverRing)

  const partsGroup = new Group()
  const ghostGroup = new Group()
  const particleGroup = new Group()
  scene.add(partsGroup, ghostGroup, particleGroup)

  let view: AppView | null = null
  let opts: BenchRenderOpts = { currentView: false, reducedMotion: false }
  let mode: Mode = { kind: "idle" }
  let tool: BenchTool = "select"
  let selection: BenchSelection | null = null
  let hoverHole: HoleId | null = null
  let lastHoverEvent: HoleId | null = null
  let drag: Drag | null = null
  let pressedButton: string | null = null
  let downAt: { x: number; y: number } | null = null
  const pickables: Mesh[] = []
  let particles: Particle[] = []
  let spinners: Spinner[] = []
  const raycaster = new Raycaster()
  const pointer = new Vector2()
  const boardPlane = new Plane(new Vector3(0, 1, 0), 0)
  const matPlane = new Plane(new Vector3(0, 1, 0), -MAT_Y)

  function frame() {
    controls.target.set(0, 0, 4)
    camera.position.set(0, 120, 135)
    controls.update()
  }
  frame()

  function resize() {
    const w = container.clientWidth
    const h = Math.max(container.clientHeight, 1)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  resize()

  function doc(): CircuitDoc {
    return structuredClone(view!.doc)
  }

  function result(): SolveResult | undefined {
    return opts.preview ?? view?.benchResult
  }

  function occupiedHoles(d: CircuitDoc, except?: { wireEnd?: string; lead?: string }): Set<HoleId> {
    const used = new Set<HoleId>()
    for (const p of d.bench.placements) {
      for (const [pin, hole] of Object.entries(p.holes)) {
        if (hole && except?.lead !== `${p.id}.${pin}`) used.add(hole)
      }
    }
    for (const w of d.bench.wires) {
      if (except?.wireEnd !== `${w.id}.a`) used.add(w.a)
      if (except?.wireEnd !== `${w.id}.b`) used.add(w.b)
    }
    return used
  }

  function rigidHoles(type: string, anchor: HoleId, rotation: number): Record<string, HoleId> | null {
    const def = catalog[type]
    const grid = gridOf(anchor)
    if (!def?.footprint || !grid) return null
    const result: Record<string, HoleId> = {}
    for (let i = 0; i < def.pins.length; i++) {
      const [dc, dr] = rotateOffset(def.footprint[i], rotation)
      const hole = holeAt(grid.col + dc, grid.row + dr)
      if (!hole) return null
      result[def.pins[i]] = hole
    }
    return result
  }

  function rigidValid(type: string, holesByPin: Record<string, HoleId> | null, d: CircuitDoc): boolean {
    if (!holesByPin) return false
    const used = occupiedHoles(d)
    // CI só encaixa montado sobre o canal do meio, com uma fileira de pinos em E e outra em F
    if (type.startsWith("chip_") && !Object.values(holesByPin).every((h) => h.startsWith("E") || h.startsWith("F"))) return false
    return Object.values(holesByPin).every((h) => !used.has(h)) && catalog[type] !== undefined
  }

  function pinWorld(placement: BenchPlacement, type: string, pin: string): Vector3 {
    const hole = placement.holes[pin]
    if (catalog[type]?.placement !== "offboard") {
      const p = hole ? holePosition(hole) : null
      return p ? new Vector3(p.x, 0.6, p.z) : new Vector3()
    }
    return offboardPin(placement, type, pin)
  }

  function offboardPin(placement: BenchPlacement, type: string, pin: string): Vector3 {
    const shape = offboardShape(type)
    const [dx, dy, dz] = shape.pins[pin] ?? [0, 0, 0]
    const base = placement.offboard ?? { x: 0, z: 0 }
    return new Vector3(base.x + dx, MAT_Y + dy, base.z + dz)
  }

  function danglingEnd(placement: BenchPlacement, type: string, pin: string): Vector3 {
    const anchor = offboardPin(placement, type, pin)
    const towardBoard = new Vector3(-anchor.x, 0, -anchor.z).normalize().multiplyScalar(14)
    return anchor.clone().add(towardBoard).setY(MAT_Y + 1)
  }

  function pointWorld(point: PointId): Vector3 | null {
    if (point.startsWith("h:")) {
      const p = holePosition(point.slice(2))
      return p ? new Vector3(p.x, 0.7, p.z) : null
    }
    if (point.startsWith("p:") && view) {
      const ref = point.slice(2)
      const dot = ref.indexOf(".")
      const id = ref.slice(0, dot)
      const pin = ref.slice(dot + 1)
      const placement = view.doc.bench.placements.find((p) => p.id === id)
      const instance = view.doc.instances.find((i) => i.id === id)
      if (placement && instance) return pinWorld(placement, instance.type, pin)
    }
    return null
  }

  function addPickable(mesh: Mesh, pick: Pickable) {
    mesh.userData.pick = pick
    pickables.push(mesh)
  }

  function clearGroup(group: Group) {
    for (const child of [...group.children]) {
      group.remove(child)
      child.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose()
          const m = o.material as Material | Material[]
          if (!Array.isArray(m) && !(m as MeshStandardMaterial).map) m.dispose()
        }
      })
    }
  }

  function selectedEmissive(id: string, kind: BenchSelection["kind"]): number {
    return selection && selection.id === id && selection.kind === kind ? 0.35 : 0
  }

  function buildRigid(placement: BenchPlacement, type: string, state: string | undefined): Group {
    const g = new Group()
    const positions = Object.values(placement.holes).flatMap((h) => {
      const p = h ? holePosition(h) : null
      return p ? [p] : []
    })
    if (positions.length === 0) return g
    const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length
    const cz = positions.reduce((s, p) => s + p.z, 0) / positions.length
    const sel = selectedEmissive(placement.id, "part")
    for (const p of positions) {
      const leg = new Mesh(new CylinderGeometry(0.25, 0.25, 3), std(0xb8bcc2, { metalness: 0.8, roughness: 0.3 }))
      leg.position.set(p.x, 1.2, p.z)
      g.add(leg)
    }
    if (type === "switch") {
      const xs = positions.map((p) => p.x)
      const width = Math.max(...xs) - Math.min(...xs) + 4
      const body = new Mesh(new BoxGeometry(width, 4, 4.5), std(0x2b2f36, { emissive: COLOR.accent, emissiveIntensity: sel }))
      body.position.set(cx, 3.5, cz)
      g.add(body)
      addPickable(body, { kind: "part", id: placement.id })
      const on = state === "on"
      const lever = new Mesh(new BoxGeometry(2, 3, 2), std(on ? 0xe6edf3 : 0x93a4b5))
      lever.position.set(cx + (on ? width / 4 : -width / 4), 6.5, cz)
      g.add(lever)
      const tag = label(on ? "LIGA" : "DESL", 9)
      tag.position.set(cx, 11, cz)
      g.add(tag)
    } else if (type === "push_button") {
      const body = new Mesh(new BoxGeometry(6, 3.4, 6), std(0x2b2f36, { emissive: COLOR.accent, emissiveIntensity: sel }))
      body.position.set(cx, 2.9, cz)
      g.add(body)
      addPickable(body, { kind: "part", id: placement.id })
      const pressed = state === "pressed"
      const cap = new Mesh(new CylinderGeometry(1.8, 1.8, pressed ? 0.8 : 2), std(0xc62828))
      cap.position.set(cx, pressed ? 5 : 5.6, cz)
      g.add(cap)
      addPickable(cap, { kind: "part", id: placement.id })
    } else if (type.startsWith("chip_")) {
      const xs = positions.map((p) => p.x)
      const zs = positions.map((p) => p.z)
      const width = Math.max(...xs) - Math.min(...xs) + PITCH * 0.9
      const depth = Math.max(...zs) - Math.min(...zs) - PITCH * 0.6
      const body = new Mesh(new BoxGeometry(width, 3.4, depth), std(0x1b1d21, { roughness: 0.5, emissive: COLOR.accent, emissiveIntensity: sel }))
      body.position.set(cx, 3.2, cz)
      g.add(body)
      addPickable(body, { kind: "part", id: placement.id })
      const pin1 = placement.holes[catalog[type].pins[0]]
      const p1 = pin1 ? holePosition(pin1) : null
      if (p1) {
        const side = Math.sign(p1.x - cx) || -1
        const notch = new Mesh(new CylinderGeometry(1, 1, 0.4, 16, 1, false, 0, Math.PI), std(0x0e0f12))
        notch.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2
        notch.position.set(cx + side * (width / 2 - 0.05), 4.95, cz)
        g.add(notch)
        const dot = new Mesh(new CylinderGeometry(0.45, 0.45, 0.2, 12), std(0xd0d4d8))
        dot.position.set(p1.x, 5, p1.z + Math.sign(cz - p1.z) * 1.2)
        g.add(dot)
      }
      const code = label(CHIP_CODES[type] ?? type, 9, "#E6EDF3", "rgba(0,0,0,0)")
      code.position.set(cx, 5.6, cz)
      g.add(code)
    } else if (type === "logic_switch") {
      const xs = positions.map((p) => p.x)
      const width = Math.max(...xs) - Math.min(...xs) + 3.5
      const body = new Mesh(new BoxGeometry(width, 4, 4.5), std(0x23415f, { emissive: COLOR.accent, emissiveIntensity: sel }))
      body.position.set(cx, 3.5, cz)
      g.add(body)
      addPickable(body, { kind: "part", id: placement.id })
      const high = state === "1"
      const lever = new Mesh(new BoxGeometry(1.6, 3, 1.6), std(0xe6edf3))
      lever.position.set(cx + (high ? width / 4 : -width / 4), 6.5, cz)
      g.add(lever)
      const tag = label(high ? "1" : "0", 6, high ? "#FFD166" : "#93A4B5")
      tag.position.set(cx, 11, cz)
      g.add(tag)
    } else {
      const body = new Mesh(new BoxGeometry(5, 3, 5), std(0x555b63, { emissive: COLOR.accent, emissiveIntensity: sel }))
      body.position.set(cx, 3, cz)
      g.add(body)
      addPickable(body, { kind: "part", id: placement.id })
    }
    const tag = label(placement.id)
    tag.position.set(cx, type === "switch" || type === "logic_switch" ? 15 : 10, cz)
    g.add(tag)
    return g
  }

  function buildOffboard(placement: BenchPlacement, type: string, state: string | undefined, r: SolveResult | undefined): Group {
    const g = new Group()
    const shape = offboardShape(type)
    const base = placement.offboard ?? { x: 0, z: 0 }
    const [w, h, d] = shape.size
    const sel = selectedEmissive(placement.id, "part")
    const partState = r?.partState[placement.id]
    if (type === "battery") {
      const off = state === "off"
      const body = new Mesh(new BoxGeometry(w, h, d), std(0x1f2a36, { emissive: COLOR.accent, emissiveIntensity: sel }))
      body.position.set(base.x, MAT_Y + h / 2, base.z)
      g.add(body)
      addPickable(body, { kind: "part", id: placement.id })
      const band = new Mesh(new BoxGeometry(w + 0.2, h * 0.4, d * 0.5), std(0xe0954a))
      band.position.set(base.x, MAT_Y + h / 2, base.z + d * 0.15)
      g.add(band)
      for (const [pin, glyph, color] of [["+", "+", "#E5534B"], ["-", "−", "#5AA9E6"]] as const) {
        const p = offboardPin(placement, type, pin)
        const terminal = new Mesh(new CylinderGeometry(2.2, 2.2, 2), std(0xb8bcc2, { metalness: 0.8, roughness: 0.3 }))
        terminal.position.copy(p).setY(MAT_Y + h + 1)
        g.add(terminal)
        const t = label(glyph, 5, color)
        t.position.copy(p).setY(MAT_Y + h + 6)
        g.add(t)
      }
      const value = view?.doc.instances.find((i) => i.id === placement.id)?.actualValue ?? 9
      const tag = label(`${placement.id} ${String(value).replace(".", ",")} V`, 11)
      tag.position.set(base.x, MAT_Y + h + 9, base.z + 4)
      g.add(tag)
      const power = label(off ? "desligada" : "ligada", 9, off ? "#93A4B5" : "#4CC38A")
      power.position.set(base.x, MAT_Y + h + 4, base.z + 12)
      g.add(power)
      return g
    }
    if (type === "lamp") {
      const lit = partState?.kind === "lamp" ? partState.brightness : 0
      const socket = new Mesh(new CylinderGeometry(w / 2, w / 2, h), std(0x3a3f45, { emissive: COLOR.accent, emissiveIntensity: sel }))
      socket.position.set(base.x, MAT_Y + h / 2, base.z)
      g.add(socket)
      addPickable(socket, { kind: "part", id: placement.id })
      const bulb = new Mesh(
        new SphereGeometry(5, 24, 16),
        std(0xfff4d6, { emissive: 0xffd27a, emissiveIntensity: lit * 2.2, transparent: true, opacity: 0.85, roughness: 0.2 }),
      )
      bulb.position.set(base.x, MAT_Y + h + 4.5, base.z)
      g.add(bulb)
      if (lit > 0) {
        const halo = new Sprite(new SpriteMaterial({ map: glow(), transparent: true, depthWrite: false, opacity: Math.min(1, 0.25 + lit) }))
        const size = 14 + lit * 26
        halo.scale.set(size, size, 1)
        halo.position.copy(bulb.position)
        g.add(halo)
      }
      addPickable(bulb, { kind: "part", id: placement.id })
      const tag = label(placement.id)
      tag.position.set(base.x, MAT_Y + h + 14, base.z)
      g.add(tag)
      return g
    }
    if (type === "dc_motor") {
      const body = new Mesh(new CylinderGeometry(w / 2, w / 2, d, 24), std(0x9aa3ad, { metalness: 0.6, roughness: 0.35, emissive: COLOR.accent, emissiveIntensity: sel }))
      body.rotation.x = Math.PI / 2
      body.position.set(base.x, MAT_Y + w / 2, base.z)
      g.add(body)
      addPickable(body, { kind: "part", id: placement.id })
      const rotor = new Group()
      rotor.position.set(base.x, MAT_Y + w / 2, base.z + d / 2 + 3)
      const shaft = new Mesh(new CylinderGeometry(0.8, 0.8, 6), std(0xd0d4d8, { metalness: 0.8 }))
      shaft.rotation.x = Math.PI / 2
      rotor.add(shaft)
      for (let i = 0; i < 3; i++) {
        const blade = new Mesh(new BoxGeometry(2.4, 11, 0.6), std(0xe0954a))
        blade.position.y = 5.5
        const holder = new Group()
        holder.rotation.z = (i * Math.PI * 2) / 3
        holder.add(blade)
        rotor.add(holder)
      }
      const marker = new Mesh(new SphereGeometry(0.9), std(0x202020))
      marker.position.set(0, 9.5, 0.6)
      rotor.add(marker)
      g.add(rotor)
      if (partState?.kind === "motor" && partState.spinning) spinners.push({ obj: rotor, direction: partState.direction })
      const tag = label(placement.id)
      tag.position.set(base.x, MAT_Y + w + 8, base.z)
      g.add(tag)
      if (partState?.kind === "motor" && partState.spinning) {
        const turn = iconSprite(partState.direction > 0 ? "turnCw" : "turnCcw", "#FFD166", 6)
        turn.position.set(base.x + 9, MAT_Y + w + 8, base.z)
        g.add(turn)
      }
      return g
    }
    if (type === "buzzer") {
      const body = new Mesh(new CylinderGeometry(w / 2, w / 2, h, 24), std(0x202428, { emissive: COLOR.accent, emissiveIntensity: sel }))
      body.position.set(base.x, MAT_Y + h / 2, base.z)
      g.add(body)
      addPickable(body, { kind: "part", id: placement.id })
      const sounding = partState?.kind === "buzzer" && partState.sounding
      if (sounding) {
        for (let i = 1; i <= 3; i++) {
          const wave = new Mesh(new TorusGeometry(w / 2 + i * 2.2, 0.25, 6, 32), new MeshBasicMaterial({ color: COLOR.current }))
          wave.rotation.x = Math.PI / 2
          wave.position.set(base.x, MAT_Y + h + i * 0.8, base.z)
          g.add(wave)
        }
      }
      const tag = label(placement.id)
      tag.position.set(base.x, MAT_Y + h + 10, base.z)
      g.add(tag)
      return g
    }
    if (type === "logic_probe") {
      const body = new Mesh(new CylinderGeometry(w / 2, w / 2, d, 16), std(0x2b2f36, { emissive: COLOR.accent, emissiveIntensity: sel }))
      body.rotation.x = Math.PI / 2
      body.position.set(base.x, MAT_Y + h / 2, base.z)
      g.add(body)
      addPickable(body, { kind: "part", id: placement.id })
      const level = partState?.kind === "probe" ? partState.level : "undefined"
      const icon = level === 1 ? iconSprite("levelHigh", "#FFD166", 7) : level === 0 ? iconSprite("levelLow", "#5AA9E6", 7) : iconSprite("levelUnknown", "#93A4B5", 7)
      icon.position.set(base.x - 5, MAT_Y + h + 7, base.z)
      g.add(icon)
      const reading = label(level === "undefined" ? "?" : String(level), 7, level === 1 ? "#FFD166" : level === 0 ? "#5AA9E6" : "#93A4B5")
      reading.position.set(base.x + 4, MAT_Y + h + 7, base.z)
      g.add(reading)
      const tag = label(placement.id)
      tag.position.set(base.x, MAT_Y + h + 14, base.z)
      g.add(tag)
      return g
    }
    const body = new Mesh(new BoxGeometry(w, h, d), std(0x555b63))
    body.position.set(base.x, MAT_Y + h / 2, base.z)
    g.add(body)
    addPickable(body, { kind: "part", id: placement.id })
    return g
  }

  function leadColor(pin: string): number {
    if (pin === "+" || pin === "IN" || pin === "VCC") return 0xc62828
    if (pin === "-" || pin === "GND") return 0x202020
    return 0x8a9aab
  }

  function buildLeads(placement: BenchPlacement, type: string): Group {
    const g = new Group()
    for (const pin of catalog[type]?.pins ?? []) {
      const start = offboardPin(placement, type, pin)
      const hole = placement.holes[pin]
      const p = hole ? holePosition(hole) : null
      const end = p ? new Vector3(p.x, 0.6, p.z) : danglingEnd(placement, type, pin)
      const curve = wireCurve(start, end, 4)
      const tube = new Mesh(new TubeGeometry(curve, 32, 0.4, 8), std(leadColor(pin)))
      g.add(tube)
      const tip = new Mesh(new SphereGeometry(hole ? 0.9 : 1.3, 12, 8), std(hole ? 0xb8bcc2 : COLOR.accent, { metalness: 0.6 }))
      tip.position.copy(end)
      g.add(tip)
      addPickable(tip, { kind: "leadEnd", id: placement.id, pin })
    }
    return g
  }

  function buildWire(wire: Wire): Group {
    const g = new Group()
    const pa = holePosition(wire.a)
    const pb = holePosition(wire.b)
    if (!pa || !pb) return g
    const a = new Vector3(pa.x, 0.6, pa.z)
    const b = new Vector3(pb.x, 0.6, pb.z)
    const sel = selectedEmissive(wire.id, "wire")
    const tube = new Mesh(new TubeGeometry(wireCurve(a, b), 40, WIRE_RADIUS, 8), std(wire.color, { emissive: COLOR.accent, emissiveIntensity: sel }))
    g.add(tube)
    addPickable(tube, { kind: "wire", id: wire.id })
    for (const [end, pos] of [["a", a], ["b", b]] as const) {
      const tip = new Mesh(new SphereGeometry(0.75, 12, 8), std(0xb8bcc2, { metalness: 0.6 }))
      tip.position.copy(pos)
      g.add(tip)
      addPickable(tip, { kind: "wireEnd", id: wire.id, end })
    }
    return g
  }

  function buildDivergences(list: Divergence[]): Group {
    const g = new Group()
    if (!view) return g
    for (const d of list) {
      if (d.kind === "pending" || !d.pin) continue
      const point = view.benchNet.pinAt[`${d.partId}.${d.pin}`]
      const pos = point ? pointWorld(point) : null
      if (!pos) continue
      const ring = new Mesh(new RingGeometry(1.8, 2.4, 6, 1), new MeshBasicMaterial({ color: COLOR.warning, depthTest: false }))
      ring.rotation.x = -Math.PI / 2
      ring.position.copy(pos).setY(pos.y + 0.4)
      ring.renderOrder = 6
      g.add(ring)
    }
    return g
  }

  function rebuildParticles() {
    clearGroup(particleGroup)
    particles = []
    const r = result()
    if (!view || !r || !opts.currentView) return
    const sphere = new SphereGeometry(0.45, 8, 6)
    const sphereMat = new MeshBasicMaterial({ color: COLOR.current })
    const coneMat = new MeshBasicMaterial({ color: COLOR.current })
    for (const link of view.benchNet.links) {
      const current = r.linkCurrent[link.id] ?? 0
      const speed = particleSpeed(current)
      if (speed === 0) continue
      const a = pointWorld(link.a)
      const b = pointWorld(link.b)
      if (!a || !b || a.distanceTo(b) < 0.01) continue
      const curve: Curve<Vector3> =
        link.kind === "strip" ? new LineCurve3(a.clone().setY(0.25), b.clone().setY(0.25)) : wireCurve(a.clone().setY(0.6), b.clone().setY(0.6), link.kind === "lead" ? 4 : 0)
      const length = curve.getLength()
      const direction = current > 0 ? 1 : -1
      const mid = curve.getPointAt(0.5)
      const tangent = curve.getTangentAt(0.5).multiplyScalar(direction)
      const arrow = new Mesh(new ConeGeometry(0.7, 1.8, 8), coneMat)
      arrow.position.copy(mid).setY(mid.y + 0.9)
      arrow.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tangent.normalize())
      particleGroup.add(arrow)
      if (opts.reducedMotion) continue
      const count = Math.max(1, Math.floor(length / 6))
      for (let i = 0; i < count; i++) {
        const mesh = new Mesh(sphere, sphereMat)
        particleGroup.add(mesh)
        particles.push({ mesh, curve, length, t: i / count, speed, direction })
      }
    }
  }

  function rebuild() {
    clearGroup(partsGroup)
    pickables.length = 0
    spinners = []
    if (!view) return
    const r = result()
    const byId = new Map(view.doc.instances.map((i) => [i.id, i]))
    for (const placement of view.doc.bench.placements) {
      const instance = byId.get(placement.id)
      if (!instance) continue
      const def = catalog[instance.type]
      const state = pressedButton === placement.id ? "pressed" : instance.inputState
      if (def?.placement === "offboard") {
        partsGroup.add(buildOffboard(placement, instance.type, state, r))
        partsGroup.add(buildLeads(placement, instance.type))
      } else {
        partsGroup.add(buildRigid(placement, instance.type, state))
      }
    }
    for (const wire of view.doc.bench.wires) partsGroup.add(buildWire(wire))
    if (opts.divergences) partsGroup.add(buildDivergences(opts.divergences))
    rebuildParticles()
  }

  function paintHoles() {
    const strip = hoverHole ? stripOf(hoverHole) : null
    holes.forEach((h, i) => {
      const lit = strip !== null && stripOf(h) === strip
      holeMesh.setColorAt(i, new Color(lit ? COLOR.holeStrip : COLOR.hole))
    })
    if (holeMesh.instanceColor) holeMesh.instanceColor.needsUpdate = true
    const p = hoverHole ? holePosition(hoverHole) : null
    hoverRing.visible = p !== null
    if (p) hoverRing.position.set(p.x, 0.12, p.z)
  }

  function setPointer(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
  }

  function boardHit(): HoleId | null {
    const hit = new Vector3()
    if (!raycaster.ray.intersectPlane(boardPlane, hit)) return null
    if (Math.abs(hit.x) > BOARD_HALF_X || Math.abs(hit.z) > BOARD_HALF_Z) return null
    return nearestHole(hit.x, hit.z)
  }

  function matHit(): Vector3 | null {
    const hit = new Vector3()
    if (!raycaster.ray.intersectPlane(matPlane, hit)) return null
    return hit
  }

  function pickHit(): Pickable | null {
    const hits = raycaster.intersectObjects(pickables, false)
    const first = hits[0]?.object
    return first ? (first.userData.pick as Pickable) : null
  }

  function select(next: BenchSelection | null) {
    selection = next
    cb.onSelect?.(next)
    rebuild()
  }

  function pinName(pin: string): string {
    if (pin === "+") return "+"
    if (pin === "-") return "−"
    return pin === "a" ? "1" : pin === "b" ? "2" : pin
  }

  function hintFor(m: Mode): string | null {
    switch (m.kind) {
      case "wire":
        return m.start ? "Clique no furo de destino · Esc cancela" : "Clique no furo onde o fio começa"
      case "rigid":
        return "Clique num furo pra encaixar · R gira · Esc cancela"
      case "offboard":
        return "Clique na mesa, fora da protoboard, pra apoiar a peça"
      case "leads":
        return `Espete o cabinho ${pinName(m.pins[m.index] ?? "")} num furo · Esc deixa solto`
      default:
        return null
    }
  }

  let lastHint: string | null = null

  function emitHint() {
    const next = hintFor(mode)
    if (next !== lastHint) {
      lastHint = next
      cb.onHint?.(next)
    }
  }

  function updateGhost() {
    clearGroup(ghostGroup)
    emitHint()
    if (!view) return
    if (mode.kind === "wire" && mode.start && hoverHole && hoverHole !== mode.start) {
      const pa = holePosition(mode.start)!
      const pb = holePosition(hoverHole)!
      const curve = wireCurve(new Vector3(pa.x, 0.6, pa.z), new Vector3(pb.x, 0.6, pb.z))
      const ghost = new Mesh(new TubeGeometry(curve, 32, WIRE_RADIUS, 8), std(suggestedWireColor(mode.start), { transparent: true, opacity: 0.55 }))
      ghostGroup.add(ghost)
    }
    if (mode.kind === "rigid" && hoverHole) {
      const holesByPin = rigidHoles(mode.type, hoverHole, mode.rotation)
      const valid = rigidValid(mode.type, holesByPin, view.doc)
      const list = holesByPin ? Object.values(holesByPin) : [hoverHole]
      for (const h of list) {
        const p = holePosition(h)
        if (!p) continue
        const cell = new Mesh(
          new BoxGeometry(2.2, 0.3, 2.2),
          valid ? new MeshBasicMaterial({ color: COLOR.accent, transparent: true, opacity: 0.6 }) : new MeshBasicMaterial({ map: hatch(), transparent: true }),
        )
        cell.position.set(p.x, 0.3, p.z)
        ghostGroup.add(cell)
      }
      if (!valid) {
        const p = holePosition(hoverHole)!
        const forbid = iconSprite("forbidden", "#E5534B", 5)
        forbid.position.set(p.x, 6, p.z)
        ghostGroup.add(forbid)
      }
    }
    if (mode.kind === "leads") {
      const leadId = mode.id
      const placement = view.doc.bench.placements.find((p) => p.id === leadId)
      const instance = view.doc.instances.find((i) => i.id === leadId)
      const pin = mode.pins[mode.index]
      if (placement && instance && pin && hoverHole) {
        const p = holePosition(hoverHole)!
        const curve = wireCurve(offboardPin(placement, instance.type, pin), new Vector3(p.x, 0.6, p.z), 4)
        ghostGroup.add(new Mesh(new TubeGeometry(curve, 24, 0.4, 8), std(leadColor(pin), { transparent: true, opacity: 0.55 })))
        const hint = label(pin === "-" ? "−" : pin, 5)
        hint.position.set(p.x, 5, p.z)
        ghostGroup.add(hint)
      }
    }
  }

  function updateOffboardGhost(at: Vector3 | null) {
    if (mode.kind !== "offboard") return
    clearGroup(ghostGroup)
    if (!at) return
    const [w, h, d] = offboardShape(mode.type).size
    const insideBoard = Math.abs(at.x) < BOARD_HALF_X + w / 2 && Math.abs(at.z) < BOARD_HALF_Z + d / 2
    const ghost = new Mesh(
      new BoxGeometry(w, h, d),
      insideBoard ? new MeshBasicMaterial({ map: hatch(), transparent: true }) : new MeshBasicMaterial({ color: COLOR.accent, transparent: true, opacity: 0.4 }),
    )
    ghost.position.set(at.x, MAT_Y + h / 2, at.z)
    ghostGroup.add(ghost)
  }

  function finishPlacement() {
    mode = { kind: "idle" }
    tool = "select"
    clearGroup(ghostGroup)
    cb.onEvent("toolReset")
  }

  function claimInstance(d: CircuitDoc, type: string, value: number | undefined, existing: string | undefined): string {
    if (existing && d.instances.some((i) => i.id === existing)) return existing
    const id = nextInstanceId(d, prefixFor(type))
    const v = value ?? catalog[type]?.values?.[0] ?? 0
    d.instances.push({ id, type, value: v, actualValue: v })
    return id
  }

  function placeRigid(anchor: HoleId) {
    if (mode.kind !== "rigid" || !view) return
    const holesByPin = rigidHoles(mode.type, anchor, mode.rotation)
    if (!holesByPin || !rigidValid(mode.type, holesByPin, view.doc)) return
    const d = doc()
    const id = claimInstance(d, mode.type, mode.value, mode.id)
    d.bench.placements.push({ id, holes: holesByPin, rotation: mode.rotation })
    cb.onChange(d, true)
    cb.onEvent("partPlaced")
    finishPlacement()
  }

  function placeOffboard(at: Vector3) {
    if (mode.kind !== "offboard" || !view) return
    const [w, , d0] = offboardShape(mode.type).size
    if (Math.abs(at.x) < BOARD_HALF_X + w / 2 && Math.abs(at.z) < BOARD_HALF_Z + d0 / 2) return
    const d = doc()
    const def = catalog[mode.type]
    const id = claimInstance(d, mode.type, mode.value, mode.id)
    d.bench.placements.push({ id, holes: Object.fromEntries(def.pins.map((p) => [p, null])), rotation: 0, offboard: { x: Math.round(at.x), z: Math.round(at.z) } })
    cb.onChange(d, true)
    cb.onEvent("partPlaced")
    mode = { kind: "leads", id, pins: def.pins, index: 0 }
    clearGroup(ghostGroup)
  }

  function plugLead(hole: HoleId) {
    if (mode.kind !== "leads" || !view) return
    const leads = mode
    const d = doc()
    if (occupiedHoles(d).has(hole)) return
    const placement = d.bench.placements.find((p) => p.id === leads.id)
    const pin = leads.pins[leads.index]
    if (!placement || !pin) return finishPlacement()
    placement.holes[pin] = hole
    cb.onChange(d, true)
    if (leads.index + 1 >= leads.pins.length) finishPlacement()
    else mode = { ...leads, index: leads.index + 1 }
  }

  function clickWire(hole: HoleId) {
    if (mode.kind !== "wire" || !view) return
    const used = occupiedHoles(view.doc)
    if (used.has(hole)) return
    if (!mode.start) {
      mode = { kind: "wire", start: hole }
      return
    }
    if (hole === mode.start) return
    const d = doc()
    const ids = new Set(d.bench.wires.map((w) => w.id))
    let n = 1
    while (ids.has(`W${n}`)) n++
    d.bench.wires.push({ id: `W${n}`, a: mode.start, b: hole, color: suggestedWireColor(mode.start) })
    mode = { kind: "wire", start: null }
    cb.onChange(d, true)
    cb.onEvent("wireDrawn")
  }

  function toggleInput(id: string) {
    if (!view) return
    const instance = view.doc.instances.find((i) => i.id === id)
    if (!instance) return
    if (instance.type === "switch") {
      const d = doc()
      const target = d.instances.find((i) => i.id === id)!
      target.inputState = target.inputState === "on" ? "off" : "on"
      cb.onChange(d, true)
    } else if (instance.type === "logic_switch") {
      const d = doc()
      const target = d.instances.find((i) => i.id === id)!
      target.inputState = target.inputState === "1" ? "0" : "1"
      cb.onChange(d, true)
    } else if (instance.type === "battery") {
      const d = doc()
      const target = d.instances.find((i) => i.id === id)!
      target.inputState = target.inputState === "off" ? "on" : "off"
      cb.onChange(d, true)
    }
  }

  function setButton(id: string | null) {
    if (!view) return
    const target = id ?? pressedButton
    if (!target) return
    pressedButton = id
    const d = doc()
    const instance = d.instances.find((i) => i.id === target)
    if (!instance) return
    instance.inputState = id ? "pressed" : "released"
    // botão é momentâneo: não entra no histórico
    cb.onChange(d, false)
  }

  function applyDrag(hole: HoleId | null) {
    if (!drag || !view) return
    const d = structuredClone(drag.doc)
    const pick = drag.pick
    if (pick.kind === "wireEnd" && pick.end) {
      const wire = d.bench.wires.find((w) => w.id === pick.id)
      if (!wire) return
      const other = pick.end === "a" ? wire.b : wire.a
      const used = occupiedHoles(d, { wireEnd: `${wire.id}.${pick.end}` })
      if (!hole || used.has(hole) || hole === other) return
      wire[pick.end] = hole
    } else if (pick.kind === "leadEnd" && pick.pin) {
      const placement = d.bench.placements.find((p) => p.id === pick.id)
      if (!placement) return
      const used = occupiedHoles(d, { lead: `${pick.id}.${pick.pin}` })
      placement.holes[pick.pin] = hole && !used.has(hole) ? hole : null
    }
    drag.moved = true
    cb.onChange(d, false)
  }

  function onPointerMove(event: PointerEvent) {
    setPointer(event)
    const hole = boardHit()
    if (hole !== hoverHole) {
      hoverHole = hole
      paintHoles()
      if (hole && hole !== lastHoverEvent) {
        lastHoverEvent = hole
        cb.onEvent("holeHovered")
      }
      if (drag) applyDrag(hole)
      updateGhost()
    }
    if (mode.kind === "offboard") updateOffboardGhost(matHit())
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    setPointer(event)
    downAt = { x: event.clientX, y: event.clientY }
    if (mode.kind !== "idle" || !view) return
    const pick = pickHit()
    if (pick && (pick.kind === "wireEnd" || pick.kind === "leadEnd")) {
      drag = { pick, doc: doc(), moved: false }
      controls.enabled = false
      return
    }
    if (pick?.kind === "part") {
      const instance = view.doc.instances.find((i) => i.id === pick.id)
      if (instance?.type === "push_button") {
        controls.enabled = false
        setButton(pick.id)
      }
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (event.button !== 0) return
    controls.enabled = true
    if (pressedButton) setButton(null)
    if (drag) {
      const moved = drag.moved
      drag = null
      if (moved && view) cb.onChange(doc(), true)
      return
    }
    const click = downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) < 5
    downAt = null
    if (!click || !view) return
    setPointer(event)
    const hole = boardHit()
    if (mode.kind === "wire") return hole ? clickWire(hole) : undefined
    if (mode.kind === "rigid") return hole ? placeRigid(hole) : undefined
    if (mode.kind === "leads") return hole ? plugLead(hole) : undefined
    if (mode.kind === "offboard") {
      const at = matHit()
      return at ? placeOffboard(at) : undefined
    }
    const pick = pickHit()
    if (!pick) return select(null)
    if (pick.kind === "wire") return select({ kind: "wire", id: pick.id })
    if (pick.kind === "part") {
      select({ kind: "part", id: pick.id })
      toggleInput(pick.id)
    }
  }

  renderer.domElement.addEventListener("pointermove", onPointerMove)
  renderer.domElement.addEventListener("pointerdown", onPointerDown)
  renderer.domElement.addEventListener("pointerup", onPointerUp)
  renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault())

  let last = performance.now()
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    controls.update()
    for (const p of particles) {
      p.t = (p.t + (p.direction * p.speed * 6 * dt) / p.length + 1) % 1
      p.mesh.position.copy(p.curve.getPointAt(p.t))
    }
    if (!opts.reducedMotion) for (const s of spinners) s.obj.rotation.z -= s.direction * dt * 12
    renderer.render(scene, camera)
  })

  function setTool(next: BenchTool) {
    tool = next
    clearGroup(ghostGroup)
    if (next === "wire") mode = { kind: "wire", start: null }
    else if (typeof next === "object") {
      const def = catalog[next.place]
      if (!def) mode = { kind: "idle" }
      else if (def.placement === "offboard") mode = { kind: "offboard", type: next.place, value: next.value, id: next.id }
      else if (def.placement === "rigid") mode = { kind: "rigid", type: next.place, value: next.value, id: next.id, rotation: 0 }
      else mode = { kind: "idle" }
    } else mode = { kind: "idle" }
    updateGhost()
  }

  function deleteSelection() {
    if (!selection || !view) return
    const d = doc()
    if (selection.kind === "wire") {
      d.bench.wires = d.bench.wires.filter((w) => w.id !== selection!.id)
    } else {
      const id = selection.id
      d.bench.placements = d.bench.placements.filter((p) => p.id !== id)
      const inBlueprint = d.blueprint.placements.some((p) => p.id === id)
      if (!inBlueprint) d.instances = d.instances.filter((i) => i.id !== id)
    }
    selection = null
    cb.onSelect?.(null)
    cb.onChange(d, true)
  }

  function setWireColor(color: string) {
    if (!selection || selection.kind !== "wire" || !view) return
    const d = doc()
    const wire = d.bench.wires.find((w) => w.id === selection!.id)
    if (!wire) return
    wire.color = color
    cb.onChange(d, true)
  }

  function handleKey(event: KeyboardEvent): boolean {
    const k = event.key
    if (k === "Escape") {
      if (mode.kind === "wire" && mode.start) mode = { kind: "wire", start: null }
      else if (mode.kind !== "idle") finishPlacement()
      else select(null)
      updateGhost()
      return true
    }
    if (k === "r" || k === "R") {
      if (mode.kind === "rigid") {
        mode = { ...mode, rotation: ((mode.rotation + 90) % 360) as 0 | 90 | 180 | 270 }
        updateGhost()
        return true
      }
      return false
    }
    if (k === "Delete" || k === "Backspace") {
      deleteSelection()
      return true
    }
    if (k === "f" || k === "F") {
      frame()
      return true
    }
    return false
  }

  return {
    render(next: AppView, nextOpts: BenchRenderOpts) {
      view = next
      opts = nextOpts
      if (selection) {
        const s = selection
        const exists = s.kind === "wire" ? next.doc.bench.wires.some((w) => w.id === s.id) : next.doc.bench.placements.some((p) => p.id === s.id)
        if (!exists) {
          selection = null
          cb.onSelect?.(null)
        }
      }
      rebuild()
      updateGhost()
    },
    setTool,
    currentTool: () => tool,
    frame,
    handleKey,
    setWireColor,
    dispose() {
      renderer.setAnimationLoop(null)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

export type BenchView = ReturnType<typeof createBench>
