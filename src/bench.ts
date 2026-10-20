import {
  Box3,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LineCurve3,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
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
import {
  bandHex,
  chipLeg,
  CHIP_CODES,
  createFpsWatch,
  createStudio,
  glow,
  hatch,
  iconSprite,
  label,
  LED_COLORS,
  makeBattery,
  makeBreadboard,
  makeBulb,
  makeBuzzer,
  makeButton,
  makeChip,
  makeCuttingMat,
  makeDecor,
  makeLampBody,
  makeLedHead,
  makeMotor,
  makeResistorBody,
  makeSwitch,
  offboardShape,
  PART_COLORS,
  PITCH,
  resistorBands,
  shade,
  sparkTexture,
  std,
  wireCurve,
} from "./parts3d"

export { bandHex, PITCH, resistorBands }
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
  mat: 0xe7e1d6,
  board: 0xf2f0ea,
  hole: 0x3a3f45,
  holeStrip: 0x8a9aab,
  accent: 0xe0954a,
  positive: 0xe11d74,
  negative: 0x2563eb,
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

export function suggestedWireColor(start: HoleId, neutral: string = WIRE_COLORS.neutral): string {
  const strip = stripOf(start)
  if (strip === "rail-T+" || strip === "rail-B+") return WIRE_COLORS.positive
  if (strip === "rail-T-" || strip === "rail-B-") return WIRE_COLORS.negative
  return neutral
}

export type BenchCosmetics = { boardColor: string | null; wireColors: string[] | null; matColor: string | null }

// cada enfeite tem lugar fixo fora da placa, longe de onde a câmera padrão olha
const DECOR_SLOTS: Record<string, { x: number; z: number; rotY: number; scale: number }> = {
  "lamp-desk": { x: -122, z: -78, rotY: 0.6, scale: 1 },
  shelf: { x: 118, z: -92, rotY: -0.35, scale: 1 },
  poster: { x: 22, z: -118, rotY: 0, scale: 1 },
  tools: { x: 88, z: -52, rotY: -0.3, scale: 0.85 },
  trophy: { x: -52, z: -104, rotY: 0.3, scale: 1 },
}

const FLEX_MIN = PITCH * 0.99
const FLEX_MAX = PITCH * 8.01

type Pickable = { kind: "part" | "wire" | "wireEnd" | "leadEnd" | "probeEnd"; id: string; end?: "a" | "b"; pin?: string }
type Drag = { pick: Pickable; doc: CircuitDoc; moved: boolean }
type Mode =
  | { kind: "idle" }
  | { kind: "wire"; start: HoleId | null }
  | { kind: "rigid"; type: string; value?: number; id?: string; rotation: 0 | 90 | 180 | 270 }
  | { kind: "offboard"; type: string; value?: number; id?: string }
  | { kind: "leads"; id: string; pins: string[]; index: number }
  | { kind: "flexible"; type: string; value?: number; id?: string; first: HoleId | null }
  | { kind: "probes"; next: "red" | "black" }
type Particle = { mesh: Mesh; curve: Curve<Vector3>; length: number; t: number; speed: number; direction: number }
type Spinner = { obj: Object3D; direction: number; body: Object3D | null; baseX: number }
type Spark = { sprite: Sprite; velocity: Vector3; born: number }

export function createBench(container: HTMLElement, catalog: PartsCatalog, cb: BenchCallbacks) {
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
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

  const studio = createStudio(renderer, scene, MAT_Y)
  const breadboard = makeBreadboard({ halfX: BOARD_HALF_X, halfZ: BOARD_HALF_Z, height: BOARD_HEIGHT, pitch: PITCH, columns: COLUMNS, rowZ: ROW_Z, railZ: RAIL_Z })
  shade(breadboard, true)
  scene.add(breadboard)
  const boardBody = breadboard.getObjectByName("body")
  const decorGroup = new Group()
  const matGroup = new Group()
  scene.add(decorGroup, matGroup)
  let neutralWires: string[] | null = null
  let holeColor = COLOR.hole

  const holes = allHoles()
  const holeMesh = new InstancedMesh(new BoxGeometry(1.1, 0.06, 1.1), new MeshBasicMaterial({ color: 0xffffff }), holes.length)
  const dummy = new Object3D()
  holes.forEach((h, i) => {
    const p = holePosition(h)!
    dummy.position.set(p.x, 0.04, p.z)
    dummy.updateMatrix()
    holeMesh.setMatrixAt(i, dummy.matrix)
    holeMesh.setColorAt(i, new Color(holeColor))
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
  const sparkGroup = new Group()
  scene.add(partsGroup, ghostGroup, particleGroup, sparkGroup)

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
  let sparks: Spark[] = []
  let shortWas = false
  const pops = new Map<string, number>()
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

  let showcase = false
  function applyViewOffset() {
    // no título a cena vai pra direita pra não ficar atrás do painel
    const w = container.clientWidth
    const h = Math.max(container.clientHeight, 1)
    if (showcase && w > 900) camera.setViewOffset(w, h, -w * 0.2, 0, w, h)
    else camera.clearViewOffset()
  }

  function resize() {
    const w = container.clientWidth
    const h = Math.max(container.clientHeight, 1)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    applyViewOffset()
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

  function flexibleDistanceOk(a: HoleId, b: HoleId): boolean {
    const pa = holePosition(a)
    const pb = holePosition(b)
    if (!pa || !pb || a === b) return false
    const d = Math.hypot(pa.x - pb.x, pa.z - pb.z)
    return d >= FLEX_MIN && d <= FLEX_MAX
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

  function dress(g: Group, id: string, sel: number) {
    g.traverse((o) => {
      if (!(o instanceof Mesh)) return
      addPickable(o, { kind: "part", id })
      if (sel > 0 && o.name === "body" && !o.userData.glows && o.material instanceof MeshStandardMaterial) {
        o.material.emissive.setHex(COLOR.accent)
        o.material.emissiveIntensity = sel
      }
    })
    const body = g.getObjectByName("body")
    if (sel > 0 && body instanceof Group) body.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) {
        o.material.emissive.setHex(COLOR.accent)
        o.material.emissiveIntensity = sel
      }
    })
  }

  function nextWireColor(start: HoleId, d: CircuitDoc): string {
    const palette = neutralWires
    return suggestedWireColor(start, palette ? palette[d.bench.wires.length % palette.length] : undefined)
  }

  function popPart(id: string) {
    if (!opts.reducedMotion) pops.set(id, performance.now())
  }

  function spawnSparks(partId: string) {
    if (!view) return
    const placement = view.doc.bench.placements.find((p) => p.id === partId)
    const instance = view.doc.instances.find((i) => i.id === partId)
    if (!placement || !instance) return
    const at = pinWorld(placement, instance.type, catalog[instance.type]?.pins[0] ?? "+")
    if (catalog[instance.type]?.placement === "offboard") at.y = MAT_Y + offboardShape(instance.type).size[1] + 2
    const now = performance.now()
    for (let i = 0; i < 12; i++) {
      // fundo claro: brilho aditivo some, então a faísca é cor chapada com miolo branco
      const sprite = new Sprite(new SpriteMaterial({ map: sparkTexture(), color: i % 3 === 0 ? PART_COLORS.orange : PART_COLORS.yellow, transparent: true, depthWrite: false, toneMapped: false }))
      sprite.scale.setScalar(3 + Math.random() * 2)
      sprite.position.copy(at)
      const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.4
      const speed = 22 + Math.random() * 26
      sparkGroup.add(sprite)
      sparks.push({ sprite, velocity: new Vector3(Math.cos(angle) * speed, 30 + Math.random() * 30, Math.sin(angle) * speed), born: now })
    }
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
    const xs = positions.map((p) => p.x)
    const zs = positions.map((p) => p.z)
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanZ = Math.max(...zs) - Math.min(...zs)
    const sel = selectedEmissive(placement.id, "part")
    const chip = type.startsWith("chip_")
    for (const p of positions) {
      const leg = chip ? chipLeg() : new Mesh(new CylinderGeometry(0.25, 0.25, 3), std(0xb8bcc2, { metalness: 0.8, roughness: 0.3 }))
      leg.position.set(p.x, chip ? 1.7 : 1.2, p.z)
      g.add(leg)
    }
    let body: Group
    if (type === "switch" || type === "logic_switch") {
      const high = type === "switch" ? state === "on" : state === "1"
      body = type === "switch" ? makeSwitch(high, Math.max(spanX, spanZ) + 4) : makeSwitch(high, Math.max(spanX, spanZ) + 3.5, 0x1e3a5f, PART_COLORS.yellow)
      // chave em pé na placa: o corpo gira junto com as pernas
      if (spanZ > spanX) body.rotation.y = Math.PI / 2
      const tag = type === "switch" ? label(high ? "LIGA" : "DESL", 9) : label(high ? "1" : "0", 6, high ? "#FFD166" : "#93A4B5")
      tag.position.set(cx, 11, cz)
      g.add(tag)
    } else if (type === "push_button") {
      const n = Number.parseInt(placement.id.replace(/\D/g, ""), 10) || 1
      body = makeButton(n % 2 === 1 ? PART_COLORS.green : PART_COLORS.yellow, state === "pressed")
    } else if (chip) {
      const pin1 = placement.holes[catalog[type].pins[0]]
      const p1 = pin1 ? holePosition(pin1) : null
      const side = p1 ? Math.sign(p1.x - cx) || -1 : -1
      body = makeChip(CHIP_CODES[type] ?? type, spanX + PITCH * 0.9, spanZ - PITCH * 0.6, side)
      if (p1) {
        const dot = new Mesh(new CylinderGeometry(0.45, 0.45, 0.2, 12), std(0xd0d4d8))
        dot.position.set(p1.x, 4.95, p1.z + Math.sign(cz - p1.z) * 1.2)
        g.add(dot)
      }
    } else {
      body = new Group()
      const box = new Mesh(new BoxGeometry(5, 3, 5), std(0x555b63))
      box.name = "body"
      box.position.y = 3
      body.add(box)
    }
    body.position.set(cx, 0, cz)
    g.add(body)
    dress(g, placement.id, sel)
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
      const value = view?.doc.instances.find((i) => i.id === placement.id)?.actualValue ?? 9
      const body = makeBattery(PART_COLORS.blue, `${String(value).replace(".", ",")} V`)
      body.position.set(base.x, MAT_Y, base.z)
      dress(body, placement.id, sel)
      g.add(body)
      for (const [pin, glyph, color] of [["+", "+", "#E11D74"], ["-", "−", "#2563EB"]] as const) {
        const p = offboardPin(placement, type, pin)
        const t = label(glyph, 5, color, "rgba(255,255,255,0.92)")
        t.position.copy(p).setY(MAT_Y + h + 2)
        g.add(t)
      }
      const tag = label(`${placement.id} ${String(value).replace(".", ",")} V`, 11)
      tag.position.set(base.x, MAT_Y + h + 13, base.z - 6)
      g.add(tag)
      const power = label(off ? "desligada" : "ligada", 9, off ? "#93A4B5" : "#4CC38A")
      power.position.set(base.x, MAT_Y + h + 6, base.z - 6)
      g.add(power)
      return g
    }
    if (type === "lamp") {
      const lit = partState?.kind === "lamp" ? partState.brightness : 0
      const lamp = makeLampBody()
      const bulb = makeBulb()
      bulb.position.y = 9.2
      lamp.add(bulb)
      const filament = bulb.getObjectByName("filament")
      const glass = bulb.getObjectByName("glass")
      if (filament instanceof Mesh && filament.material instanceof MeshStandardMaterial) filament.material.emissiveIntensity = lit * 6
      if (glass instanceof Mesh && glass.material instanceof MeshStandardMaterial) glass.material.emissiveIntensity = lit * 0.6
      lamp.position.set(base.x, MAT_Y, base.z)
      dress(lamp, placement.id, sel)
      g.add(lamp)
      if (lit > 0) {
        const halo = new Sprite(new SpriteMaterial({ map: glow(), transparent: true, depthWrite: false, opacity: Math.min(1, 0.25 + lit), toneMapped: false }))
        const size = 14 + lit * 26
        halo.scale.set(size, size, 1)
        halo.position.set(base.x, MAT_Y + 16.6, base.z)
        g.add(halo)
      }
      const tag = label(placement.id)
      tag.position.set(base.x, MAT_Y + 27, base.z)
      g.add(tag)
      return g
    }
    if (type === "dc_motor") {
      const motor = makeMotor()
      motor.position.set(base.x, MAT_Y, base.z)
      dress(motor, placement.id, sel)
      g.add(motor)
      const rotor = motor.getObjectByName("rotor")
      const body = motor.getObjectByName("body") ?? null
      if (rotor && partState?.kind === "motor" && partState.spinning) spinners.push({ obj: rotor, direction: partState.direction, body, baseX: body?.position.x ?? 0 })
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
      const body = makeBuzzer()
      body.position.set(base.x, MAT_Y, base.z)
      dress(body, placement.id, sel)
      g.add(body)
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
      const body = new Mesh(new CylinderGeometry(w / 2, w / 2, d, 20), std(PART_COLORS.purple, { roughness: 0.45, emissive: COLOR.accent, emissiveIntensity: sel }))
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

  function buildFlexible(placement: BenchPlacement, type: string, r: SolveResult | undefined, instanceValue: number, variant?: string): Group {
    const g = new Group()
    const pins = catalog[type]?.pins ?? []
    const ha = placement.holes[pins[0]]
    const hb = placement.holes[pins[1]]
    const pa = ha ? holePosition(ha) : null
    const pb = hb ? holePosition(hb) : null
    if (!pa || !pb) return g
    const a = new Vector3(pa.x, 0, pa.z)
    const b = new Vector3(pb.x, 0, pb.z)
    const mid = a.clone().add(b).multiplyScalar(0.5)
    const sel = selectedEmissive(placement.id, "part")
    const legMat = std(0xb8bcc2, { metalness: 0.8, roughness: 0.3 })
    if (type === "resistor") {
      const top = 3.2
      for (const p of [a, b]) {
        const leg = new Mesh(new CylinderGeometry(0.22, 0.22, top), legMat)
        leg.position.set(p.x, top / 2, p.z)
        g.add(leg)
      }
      const span = new Mesh(new TubeGeometry(new LineCurve3(a.clone().setY(top), b.clone().setY(top)), 2, 0.22, 6), legMat)
      g.add(span)
      const length = Math.min(6.2, Math.max(2.2, a.distanceTo(b) - 1.2))
      const body = makeResistorBody(resistorBands(instanceValue), length)
      body.position.copy(mid).setY(top)
      body.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize())
      dress(body, placement.id, sel)
      g.add(body)
      const tag = label(placement.id)
      tag.position.copy(mid).setY(top + 5)
      g.add(tag)
      return g
    }
    const state = r?.partState[placement.id]
    const lit = state?.kind === "led" && state.lit ? state.brightness : 0
    const color = LED_COLORS[variant ?? "red"] ?? LED_COLORS.red
    const height = 6
    for (const [p, extra] of [[a, 1.2], [b, 0]] as const) {
      const leg = new Mesh(new TubeGeometry(new LineCurve3(p.clone().setY(0.2), mid.clone().add(p.clone().sub(mid).multiplyScalar(0.25)).setY(height - 1)), 2, 0.2, 6), legMat)
      g.add(leg)
      if (extra > 0) {
        const plus = label("+", 4, "#E5534B")
        plus.position.copy(p).setY(height + extra)
        g.add(plus)
      }
    }
    const head = makeLedHead(color, lit * 2 + sel)
    head.position.copy(mid).setY(height - 1)
    dress(head, placement.id, 0)
    g.add(head)
    const flat = new Mesh(new BoxGeometry(0.3, 0.7, 2.4), std(0x1b1b1b))
    const towardK = b.clone().sub(mid).normalize()
    flat.position.copy(mid.clone().add(towardK.multiplyScalar(1.7))).setY(height - 0.7)
    flat.lookAt(mid.clone().setY(height - 0.7))
    g.add(flat)
    if (lit > 0) {
      const halo = new Sprite(new SpriteMaterial({ map: glow(), transparent: true, depthWrite: false, opacity: Math.min(1, 0.3 + lit), color, toneMapped: false }))
      const size = 8 + lit * 14
      halo.scale.set(size, size, 1)
      halo.position.copy(mid).setY(height + 1.5)
      g.add(halo)
    }
    const tag = label(placement.id)
    tag.position.copy(mid).setY(height + 7)
    g.add(tag)
    return g
  }

  function buildProbes(): Group {
    const g = new Group()
    if (!view || view.doc.bench.meter.mode === "off") return g
    const meter = view.doc.bench.meter
    const offsets = { red: new Vector3(-6, 0, 10), black: new Vector3(6, 0, 10) }
    for (const color of ["red", "black"] as const) {
      const hole = meter[color]
      const p = hole ? holePosition(hole) : null
      const tip = p ? new Vector3(p.x, 0.6, p.z) : new Vector3(color === "red" ? 30 : 40, MAT_Y + 1, 40)
      const handleEnd = tip.clone().add(offsets[color]).setY(tip.y + 16)
      const shaft = new Mesh(new TubeGeometry(new LineCurve3(tip.clone().setY(tip.y + 1.5), handleEnd), 2, 0.35, 8), std(0xd0d4d8, { metalness: 0.7 }))
      g.add(shaft)
      const grip = new Mesh(new CylinderGeometry(1.1, 1.1, 9, 12), std(color === "red" ? 0xc62828 : 0x202020))
      const dir = handleEnd.clone().sub(tip).normalize()
      grip.position.copy(handleEnd.clone().add(dir.clone().multiplyScalar(4)))
      grip.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
      g.add(grip)
      addPickable(grip, { kind: "probeEnd", id: "METER", pin: color })
      const point = new Mesh(new SphereGeometry(0.7, 12, 8), std(color === "red" ? 0xe5534b : 0x93a4b5))
      point.position.copy(tip)
      g.add(point)
      addPickable(point, { kind: "probeEnd", id: "METER", pin: color })
      const glyph = label(color === "red" ? "+" : "−", 4, color === "red" ? "#E5534B" : "#93A4B5")
      glyph.position.copy(handleEnd).setY(handleEnd.y + 10)
      g.add(glyph)
    }
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
    const hold = (id: string, built: Group) => {
      // embrulha a peça pra poder dar o pulo escalando em volta do centro dela
      const holder = new Group()
      holder.userData.popId = id
      shade(built)
      holder.add(built)
      partsGroup.add(holder)
    }
    for (const placement of view.doc.bench.placements) {
      const instance = byId.get(placement.id)
      if (!instance) continue
      const def = catalog[instance.type]
      const state = pressedButton === placement.id ? "pressed" : instance.inputState
      if (def?.placement === "offboard") {
        hold(placement.id, buildOffboard(placement, instance.type, state, r))
        hold(`${placement.id}:leads`, buildLeads(placement, instance.type))
      } else if (def?.placement === "flexible") {
        hold(placement.id, buildFlexible(placement, instance.type, r, instance.actualValue, instance.variant))
      } else {
        hold(placement.id, buildRigid(placement, instance.type, state))
      }
    }
    for (const wire of view.doc.bench.wires) hold(wire.id, buildWire(wire))
    partsGroup.add(buildProbes())
    if (opts.divergences) partsGroup.add(buildDivergences(opts.divergences))
    rebuildParticles()
  }

  function paintHoles() {
    const strip = hoverHole ? stripOf(hoverHole) : null
    holes.forEach((h, i) => {
      const lit = strip !== null && stripOf(h) === strip
      holeMesh.setColorAt(i, new Color(lit ? COLOR.holeStrip : holeColor))
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
      case "flexible":
        if (m.type === "led") return m.first ? "Agora o furo da perna curta (cátodo, −) · Esc cancela" : "Primeiro clique: perna comprida (ânodo, +)"
        return m.first ? "Clique no furo da outra perna · Esc cancela" : "Clique no furo da primeira perna"
      case "probes":
        return m.next === "red" ? "Encoste a ponta vermelha num furo" : "Agora a ponta preta · Esc deixa como está"
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
      const ghost = new Mesh(new TubeGeometry(curve, 32, WIRE_RADIUS, 8), std(nextWireColor(mode.start, view.doc), { transparent: true, opacity: 0.55 }))
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
    if (mode.kind === "flexible" && mode.first && hoverHole) {
      const pa = holePosition(mode.first)!
      const pb = holePosition(hoverHole)!
      const valid = flexibleDistanceOk(mode.first, hoverHole) && !occupiedHoles(view.doc).has(hoverHole)
      const ghost = new Mesh(
        new TubeGeometry(new LineCurve3(new Vector3(pa.x, 3, pa.z), new Vector3(pb.x, 3, pb.z)), 2, 1, 10),
        valid ? new MeshBasicMaterial({ color: COLOR.accent, transparent: true, opacity: 0.5 }) : new MeshBasicMaterial({ map: hatch(), transparent: true }),
      )
      ghostGroup.add(ghost)
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

  function clickFlexible(hole: HoleId) {
    if (mode.kind !== "flexible" || !view) return
    if (occupiedHoles(view.doc).has(hole)) return
    if (!mode.first) {
      mode = { ...mode, first: hole }
      updateGhost()
      return
    }
    if (!flexibleDistanceOk(mode.first, hole)) return
    const d = doc()
    const id = claimInstance(d, mode.type, mode.value, mode.id)
    const pins = catalog[mode.type].pins
    d.bench.placements = d.bench.placements.filter((p) => p.id !== id)
    d.bench.placements.push({ id, holes: { [pins[0]]: mode.first, [pins[1]]: hole }, rotation: 0 })
    popPart(id)
    cb.onChange(d, true)
    cb.onEvent("partPlaced")
    finishPlacement()
  }

  function clickProbe(hole: HoleId) {
    if (mode.kind !== "probes" || !view) return
    const d = doc()
    d.bench.meter[mode.next] = hole
    const done = mode.next === "black"
    cb.onChange(d, true)
    if (d.bench.meter.red && d.bench.meter.black) cb.onEvent("meterPlaced")
    if (done) finishPlacement()
    else {
      mode = { kind: "probes", next: "black" }
      updateGhost()
    }
  }

  function finishPlacement() {
    mode = { kind: "idle" }
    tool = "select"
    clearGroup(ghostGroup)
    cb.onEvent("toolReset")
  }

  function claimInstance(d: CircuitDoc, type: string, value: number | undefined, existing: string | undefined): string {
    const found = existing ? d.instances.find((i) => i.id === existing) : undefined
    if (found) {
      // peça nova tirada da bandeja: valor físico escolhido (ou o do esquema) e sem defeito
      found.actualValue = value ?? found.value
      delete found.fault
      return found.id
    }
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
    popPart(id)
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
    popPart(id)
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
    popPart(`${leads.id}:leads`)
    cb.onChange(d, true)
    cb.onEvent("partSnapped")
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
    d.bench.wires.push({ id: `W${n}`, a: mode.start, b: hole, color: nextWireColor(mode.start, d) })
    popPart(`W${n}`)
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
      cb.onEvent("inputToggled")
    } else if (instance.type === "logic_switch") {
      const d = doc()
      const target = d.instances.find((i) => i.id === id)!
      target.inputState = target.inputState === "1" ? "0" : "1"
      cb.onChange(d, true)
      cb.onEvent("inputToggled")
    } else if (instance.type === "battery") {
      const d = doc()
      const target = d.instances.find((i) => i.id === id)!
      target.inputState = target.inputState === "off" ? "on" : "off"
      cb.onChange(d, true)
      cb.onEvent("inputToggled")
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
    if (id) cb.onEvent("inputToggled")
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
    } else if (pick.kind === "probeEnd" && (pick.pin === "red" || pick.pin === "black")) {
      d.bench.meter[pick.pin] = hole
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
    if (pick && (pick.kind === "wireEnd" || pick.kind === "leadEnd" || pick.kind === "probeEnd")) {
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
      const pick = drag.pick
      drag = null
      if (moved && view) {
        popPart(pick.kind === "leadEnd" ? `${pick.id}:leads` : pick.id)
        cb.onChange(doc(), true)
        cb.onEvent("partSnapped")
        const m = view.doc.bench.meter
        if (m.mode !== "off" && m.red && m.black) cb.onEvent("meterPlaced")
      }
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
    if (mode.kind === "flexible") return hole ? clickFlexible(hole) : undefined
    if (mode.kind === "probes") return hole ? clickProbe(hole) : undefined
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

  const fpsWatch = createFpsWatch()
  let lightOn = true
  const box = new Box3()
  const pivot = new Vector3()

  function animatePops(now: number) {
    for (const holder of partsGroup.children) {
      const start = pops.get(holder.userData.popId as string)
      if (start === undefined) continue
      const t = Math.min(1, (now - start) / 600)
      if (!holder.userData.pivot) {
        box.setFromObject(holder)
        holder.userData.pivot = box.getCenter(new Vector3()).setY(box.min.y)
      }
      pivot.copy(holder.userData.pivot as Vector3)
      // sobe rápido até 1,08 e volta devagar, cara de easeOutBack
      const s = 1 + 0.08 * Math.sin(Math.PI * Math.pow(t, 0.6))
      holder.scale.setScalar(t >= 1 ? 1 : s)
      holder.position.copy(pivot).multiplyScalar(t >= 1 ? 0 : 1 - s)
    }
    for (const [id, start] of pops) if (now - start >= 600) pops.delete(id)
  }

  function animateSparks(now: number, dt: number) {
    sparks = sparks.filter((spark) => {
      const age = (now - spark.born) / 600
      if (age >= 1) {
        sparkGroup.remove(spark.sprite)
        spark.sprite.material.dispose()
        return false
      }
      spark.velocity.y -= 140 * dt
      spark.sprite.position.addScaledVector(spark.velocity, dt)
      spark.sprite.material.opacity = 1 - age
      return true
    })
  }

  let last = performance.now()
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    controls.update()
    for (const p of particles) {
      p.t = (p.t + (p.direction * p.speed * 6 * dt) / p.length + 1) % 1
      p.mesh.position.copy(p.curve.getPointAt(p.t))
    }
    if (!opts.reducedMotion) {
      for (const s of spinners) {
        s.obj.rotation.z -= s.direction * dt * 12
        if (s.body) s.body.position.x = s.baseX + 0.15 * Math.sin((now / 1000) * Math.PI * 2 * 30)
      }
    }
    if (pops.size > 0) animatePops(now)
    if (sparks.length > 0) animateSparks(now, dt)
    if (lightOn && fpsWatch.sample(now) === "degrade") {
      lightOn = false
      studio.setLight(false)
      resize()
      rebuild()
      cb.onEvent("lightMode")
    }
    renderer.render(scene, camera)
  })

  function setTool(next: BenchTool) {
    tool = next
    clearGroup(ghostGroup)
    if (next === "wire") mode = { kind: "wire", start: null }
    else if (next === "meter") mode = { kind: "probes", next: "red" }
    else if (typeof next === "object") {
      const def = catalog[next.place]
      if (!def) mode = { kind: "idle" }
      else if (def.placement === "offboard") mode = { kind: "offboard", type: next.place, value: next.value, id: next.id }
      else if (def.placement === "rigid") mode = { kind: "rigid", type: next.place, value: next.value, id: next.id, rotation: 0 }
      else if (def.placement === "flexible") mode = { kind: "flexible", type: next.place, value: next.value, id: next.id, first: null }
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
      if (selection?.kind === "part" && view) {
        const instance = view.doc.instances.find((i) => i.id === selection!.id)
        if (instance?.type !== "led") return false
        const d = doc()
        const placement = d.bench.placements.find((p) => p.id === instance.id)
        if (!placement) return false
        placement.holes = { a: placement.holes.k ?? null, k: placement.holes.a ?? null }
        cb.onChange(d, true)
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
      const short = result()?.warnings.find((w) => w.kind === "shortCircuit")
      fpsWatch.reset()
      rebuild()
      updateGhost()
      if (short?.partId && !shortWas && !opts.reducedMotion) spawnSparks(short.partId)
      shortWas = short !== undefined
    },
    setTool,
    currentTool: () => tool,
    setShowcase(on: boolean, still = false) {
      // vitrine do título: câmera gira sozinha e o jogador não mexe
      controls.autoRotate = on && !still
      controls.autoRotateSpeed = 0.6
      controls.enabled = !on
      showcase = on
      applyViewOffset()
      if (on) frame()
    },
    frame,
    handleKey,
    setWireColor,
    setCosmetics(c: BenchCosmetics) {
      if (boardBody instanceof Mesh && boardBody.material instanceof MeshStandardMaterial) boardBody.material.color.set(c.boardColor ?? "#FBFBF8")
      // placa escura apaga os furos escuros, então eles clareiam
      holeColor = c.boardColor && new Color(c.boardColor).getHSL({ h: 0, s: 0, l: 0 }).l < 0.3 ? 0x9ca3af : COLOR.hole
      paintHoles()
      neutralWires = c.wireColors
      clearGroup(matGroup)
      if (c.matColor) {
        const mat = makeCuttingMat(BOARD_HALF_X * 2 + 18, BOARD_HALF_Z * 2 + 16, c.matColor)
        mat.position.set(0, MAT_Y, 0)
        matGroup.add(mat)
      }
    },
    setDecor(ids: string[]) {
      clearGroup(decorGroup)
      for (const id of ids) {
        const slot = DECOR_SLOTS[id]
        if (!slot) continue
        const item = makeDecor(id)
        item.position.set(slot.x, MAT_Y, slot.z)
        item.rotation.y = slot.rotY
        item.scale.setScalar(slot.scale)
        shade(item)
        decorGroup.add(item)
      }
    },
    setLight(on: boolean) {
      lightOn = on
      studio.setLight(on)
      resize()
      rebuild()
    },
    dispose() {
      renderer.setAnimationLoop(null)
      studio.dispose()
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

export type BenchView = ReturnType<typeof createBench>
