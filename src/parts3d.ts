import {
  ACESFilmicToneMapping,
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CubicBezierCurve3,
  CurvePath,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  LatheGeometry,
  LineCurve3,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  type Curve,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"

export const PITCH = 2.54

export type OffboardShape = { size: [number, number, number]; pins: Record<string, [number, number, number]> }

export const OFFBOARD: Record<string, OffboardShape> = {
  battery: { size: [26, 17, 46], pins: { "+": [-6, 9, -23], "-": [6, 9, -23] } },
  lamp: { size: [14, 8, 14], pins: { a: [-7, 2, 0], b: [7, 2, 0] } },
  logic_probe: { size: [8, 8, 34], pins: { IN: [-2, 4, -17], GND: [3, 4, -17] } },
  dc_motor: { size: [20, 20, 26], pins: { "+": [-5, 4, -13], "-": [5, 4, -13] } },
  buzzer: { size: [12, 9, 12], pins: { "+": [-6, 2, 0], "-": [6, 2, 0] } },
}

export function offboardShape(type: string): OffboardShape {
  return OFFBOARD[type] ?? { size: [10, 8, 10], pins: {} }
}

const BAND_COLORS = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "gray", "white"]
const BAND_HEX: Record<string, string> = {
  black: "#1b1b1b",
  brown: "#7a4a24",
  red: "#c62828",
  orange: "#ef7d22",
  yellow: "#f2c630",
  green: "#2e9e5b",
  blue: "#2f6fd6",
  violet: "#8a4fc8",
  gray: "#8c8c8c",
  white: "#f2f2f2",
  gold: "#c9a227",
}

export function resistorBands(ohms: number): [string, string, string, string] {
  if (!(ohms > 0)) return ["black", "black", "black", "gold"]
  const exponent = Math.floor(Math.log10(ohms)) - 1
  const digits = Math.round(ohms / 10 ** exponent)
  const normalized = digits >= 100 ? { d: Math.round(digits / 10), e: exponent + 1 } : { d: digits, e: exponent }
  const first = Math.floor(normalized.d / 10)
  const second = normalized.d % 10
  const multiplier = normalized.e < 0 ? "gold" : BAND_COLORS[normalized.e]
  return [BAND_COLORS[first], BAND_COLORS[second], multiplier, "gold"]
}

export function bandHex(color: string): string {
  return BAND_HEX[color] ?? "#888888"
}

export const LED_COLORS: Record<string, number> = { red: 0xff3b30, green: 0x34d058, yellow: 0xffd60a }

export const CHIP_CODES: Record<string, string> = {
  chip_nand: "7400",
  chip_nor: "7402",
  chip_not: "7404",
  chip_and: "7408",
  chip_or: "7432",
  chip_xor: "7486",
  chip_xnor: "XNOR",
}

const labelCache = new Map<string, CanvasTexture>()

export function textTexture(text: string, color = "#E6EDF3", background = "rgba(14,20,27,0.85)"): CanvasTexture {
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

export function label(text: string, scale = 7, color?: string, background?: string): Sprite {
  const sprite = new Sprite(new SpriteMaterial({ map: textTexture(text, color, background), depthTest: false, toneMapped: false }))
  sprite.scale.set(scale, scale / 2, 1)
  sprite.renderOrder = 10
  return sprite
}

export type IconName = "forbidden" | "turnCw" | "turnCcw" | "levelHigh" | "levelLow" | "levelUnknown"
const iconCache = new Map<string, CanvasTexture>()

export function iconTexture(name: IconName, color: string): CanvasTexture {
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

export function iconSprite(name: IconName, color: string, size = 5): Sprite {
  const sprite = new Sprite(new SpriteMaterial({ map: iconTexture(name, color), depthTest: false, toneMapped: false }))
  sprite.scale.set(size, size, 1)
  sprite.renderOrder = 10
  return sprite
}

let glowTexture: CanvasTexture | null = null

export function glow(): CanvasTexture {
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

let sparkTex: CanvasTexture | null = null

export function sparkTexture(): CanvasTexture {
  if (sparkTex) return sparkTex
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext("2d")!
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30)
  gradient.addColorStop(0, "rgba(255,255,255,1)")
  gradient.addColorStop(0.3, "rgba(255,255,255,1)")
  gradient.addColorStop(0.45, "rgba(255,255,255,0.9)")
  gradient.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  sparkTex = new CanvasTexture(canvas)
  return sparkTex
}

let hatchTexture: CanvasTexture | null = null

export function hatch(): CanvasTexture {
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

export function wireCurve(a: Vector3, b: Vector3, liftBase = 0): CubicBezierCurve3 {
  const height = Math.max(PITCH, 0.35 * a.distanceTo(b)) + liftBase
  return new CubicBezierCurve3(a, a.clone().setY(a.y + height), b.clone().setY(b.y + height), b)
}

export type WireLook = { style: "arc" | "angle"; mid: Vector3 | null }

export function wirePath(a: Vector3, b: Vector3, look: WireLook): Curve<Vector3> {
  if (look.style === "angle") return anglePath(a, b, look.mid)
  if (!look.mid) return wireCurve(a, b)
  // mesma altura do arco sem ponto do meio: fio comprido sobe mais
  const height = Math.max(PITCH, 0.35 * a.distanceTo(b))
  const top = new Vector3(look.mid.x, Math.max(a.y, b.y) + height, look.mid.z)
  return new CatmullRomCurve3([a, a.clone().setY(a.y + height * 0.6), top, b.clone().setY(b.y + height * 0.6), b], false, "centripetal")
}

function anglePath(a: Vector3, b: Vector3, mid: Vector3 | null): CurvePath<Vector3> {
  const y = Math.max(a.y, b.y) + Math.max(PITCH, 0.15 * a.distanceTo(b))
  const m = mid ?? a.clone().add(b).multiplyScalar(0.5)
  const points = [a, new Vector3(a.x, y, a.z), new Vector3(m.x, y, a.z), new Vector3(m.x, y, m.z), new Vector3(b.x, y, m.z), new Vector3(b.x, y, b.z), b]
  const path = new CurvePath<Vector3>()
  for (let i = 1; i < points.length; i++) if (points[i].distanceTo(points[i - 1]) > 1e-6) path.add(new LineCurve3(points[i - 1], points[i]))
  return path
}

export function std(color: number | string, extra: Partial<{ emissive: number; emissiveIntensity: number; roughness: number; metalness: number; transparent: boolean; opacity: number }> = {}) {
  return new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...extra })
}


export const PART_COLORS = { green: 0x22c55e, yellow: 0xffc21a, blue: 0x3b82f6, pink: 0xec4899, coral: 0xef4444, purple: 0x8b5cf6, orange: 0xf97316 }
const METAL = { color: 0xc9ced4, metalness: 0.9, roughness: 0.28 }
const FLOOR = 0xe7e1d6
// vidro com transmissão renderiza a cena de novo; no modo leve vira transparência simples
let lite = false
const BACKDROP = 0xf6f1e8

export function createStudio(renderer: WebGLRenderer, scene: Scene, floorY: number) {
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setClearColor(BACKDROP)
  renderer.shadowMap.type = PCFSoftShadowMap
  scene.fog = new Fog(BACKDROP, 320, 820)

  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()

  const hemi = new HemisphereLight(0xffffff, 0xd9cfbf, 0.9)
  scene.add(hemi)
  const key = new DirectionalLight(0xfff4e5, 2.2)
  key.position.set(-70, 170, 95)
  key.target.position.set(0, floorY, 0)
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = key.shadow.camera.bottom = -130
  key.shadow.camera.right = key.shadow.camera.top = 130
  key.shadow.camera.near = 20
  key.shadow.camera.far = 420
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.25
  key.shadow.radius = 4
  scene.add(key, key.target)

  const floor = new Mesh(new PlaneGeometry(2400, 2400), new MeshStandardMaterial({ color: FLOOR, roughness: 0.95 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = floorY - 0.05
  scene.add(floor)
  const catcher = new Mesh(new PlaneGeometry(420, 420), new ShadowMaterial({ opacity: 0.25 }))
  catcher.rotation.x = -Math.PI / 2
  catcher.position.y = floorY + 0.02
  catcher.receiveShadow = true
  scene.add(catcher)

  function setLight(on: boolean) {
    // modo leve: sem sombra e sem ambiente, a hemisférica segura a cena sozinha
    lite = !on
    renderer.setPixelRatio(on ? Math.min(window.devicePixelRatio, 2) : 1)
    renderer.shadowMap.enabled = on
    key.castShadow = on
    catcher.visible = on
    scene.environment = on ? environment : null
    scene.environmentIntensity = 0.55
    hemi.intensity = on ? 0.9 : 2.1
    scene.traverse((o) => {
      if (o instanceof Mesh) for (const m of [o.material].flat() as Material[]) m.needsUpdate = true
    })
  }
  setLight(true)

  return {
    setLight,
    dispose() {
      environment.dispose()
      floor.geometry.dispose()
      catcher.geometry.dispose()
    },
  }
}

export function shade(obj: Group | Mesh, receive = false): void {
  obj.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true
      o.receiveShadow = receive
    }
  })
}

function rounded(w: number, h: number, d: number, r: number, material: Material): Mesh {
  return new Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), material)
}

function satin(color: number, extra: Partial<{ roughness: number; metalness: number; emissive: number; emissiveIntensity: number }> = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.02, ...extra })
}

function metal(): MeshStandardMaterial {
  return new MeshStandardMaterial(METAL)
}

function lathe(profile: [number, number][], segments = 32): LatheGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), segments)
}

const decalCache = new Map<string, CanvasTexture>()

function decal(key: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const cached = decalCache.get(key)
  if (cached) return cached
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext("2d")!)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  decalCache.set(key, texture)
  return texture
}

function printed(texture: CanvasTexture, w: number, d: number): Mesh {
  const mesh = new Mesh(new PlaneGeometry(w, d), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

function named<T extends Mesh | Group>(obj: T, name: string): T {
  obj.name = name
  return obj
}

export function makeBattery(color: number, text: string): Group {
  const g = new Group()
  const body = named(rounded(26, 17, 46, 3, satin(color, { roughness: 0.45 })), "body")
  body.position.y = 8.5
  g.add(body)
  const band = rounded(26.6, 17.6, 15, 1.5, satin(0xf8fafc, { roughness: 0.55 }))
  band.position.set(0, 8.5, 11)
  g.add(band)
  const tex = decal(`battery|${text}`, 256, 160, (ctx) => {
    ctx.fillStyle = "#1E3A8A"
    ctx.font = "700 92px Rubik, sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(text, 128, 84)
  })
  const print = printed(tex, 18, 11.25)
  print.position.set(0, 17.35, 11)
  g.add(print)
  const shoulder = rounded(22, 4, 4, 1.2, satin(0x1f2937, { roughness: 0.6 }))
  shoulder.position.set(0, 9, -23.4)
  g.add(shoulder)
  for (const [x, c] of [[-6, PART_COLORS.coral], [6, 0x1f2937]] as const) {
    const cap = rounded(10.5, 8, 5.2, 1.6, satin(c, { roughness: 0.42 }))
    cap.position.set(x, 9, -25.2)
    g.add(cap)
  }
  return g
}

export function makeLampBody(): Group {
  const g = new Group()
  const base = named(rounded(17, 3.2, 15, 1.4, satin(PART_COLORS.green)), "body")
  base.position.y = 1.6
  g.add(base)
  for (const x of [-6.2, 6.2]) {
    const screw = new Mesh(new CylinderGeometry(1.1, 1.1, 0.8, 16), metal())
    screw.position.set(x, 3.5, 0)
    g.add(screw)
  }
  const thread: [number, number][] = [[0, 0], [3.4, 0]]
  for (let i = 0; i < 5; i++) thread.push([3.6, 0.5 + i], [3.2, 1 + i])
  thread.push([3.4, 5.6], [2.8, 6], [0, 6])
  const socket = new Mesh(lathe(thread), metal())
  socket.position.y = 3.2
  g.add(socket)
  return g
}

export function makeBulb(): Group {
  const g = new Group()
  const profile: [number, number][] = [[0, 0], [2.7, 0]]
  for (let i = 0; i <= 16; i++) {
    const a = -Math.PI / 2 + (i / 16) * Math.PI
    const r = 5.2 * Math.cos(a)
    profile.push([Math.max(r, 2.7 * (1 - i / 16)), 7 + 5.2 * Math.sin(a)])
  }
  const glass = named(
    new Mesh(lathe(profile, 36), new MeshPhysicalMaterial({ color: 0xffffff, transmission: lite ? 0 : 0.6, opacity: lite ? 0.45 : 1, roughness: 0.05, thickness: 0.6, ior: 1.45, transparent: true, emissive: 0xffd27a, emissiveIntensity: 0 })),
    "glass",
  )
  g.add(glass)
  const points: Vector3[] = []
  for (let i = 0; i <= 80; i++) {
    const t = i / 80
    const a = t * Math.PI * 2 * 7
    points.push(new Vector3(-2.2 + 4.4 * t, 7.4 + Math.sin(a) * 0.55, Math.cos(a) * 0.55))
  }
  const filament = named(new Mesh(new TubeGeometry(new CatmullRomCurve3(points), 160, 0.12, 5), satin(0x7c5a3a, { emissive: 0xffb347, emissiveIntensity: 0 })), "filament")
  g.add(filament)
  for (const x of [-2.2, 2.2]) {
    const post = new Mesh(new CylinderGeometry(0.12, 0.12, 6.4, 6), metal())
    post.position.set(x, 4.2, 0)
    g.add(post)
  }
  return g
}

export function makeSwitch(on: boolean, width: number, body = 0x2b2f36, lever = PART_COLORS.orange): Group {
  const g = new Group()
  const box = named(rounded(width, 4, 4.6, 0.8, satin(body)), "body")
  box.position.y = 3.5
  g.add(box)
  const slot = rounded(width * 0.62, 0.4, 1.6, 0.2, satin(0x111316, { roughness: 0.8 }))
  slot.position.y = 5.5
  g.add(slot)
  const knob = rounded(2.2, 3, 2.2, 0.7, satin(lever, { roughness: 0.4 }))
  knob.position.set(on ? width / 4 : -width / 4, 6.8, 0)
  g.add(knob)
  return g
}

export function makeButton(color: number, pressed: boolean): Group {
  const g = new Group()
  const box = named(rounded(6.2, 3.4, 6.2, 0.7, satin(0x2b2f36)), "body")
  box.position.y = 2.9
  g.add(box)
  const ring = new Mesh(new CylinderGeometry(2.5, 2.5, 0.3, 24), metal())
  ring.position.y = 4.7
  g.add(ring)
  const cap = new Mesh(lathe([[0, 0], [2, 0], [2.05, 1.2], [1.8, 1.8], [1.1, 2.15], [0, 2.25]]), satin(color, { roughness: 0.38 }))
  cap.position.y = pressed ? 4.3 : 4.9
  g.add(cap)
  return g
}

export function makeChip(code: string, width: number, depth: number, notchSide: number): Group {
  const g = new Group()
  const box = named(rounded(width, 3.2, depth, 0.45, satin(0x1c1e22, { roughness: 0.78 })), "body")
  box.position.y = 3.3
  g.add(box)
  const notch = new Mesh(new CylinderGeometry(1, 1, 0.5, 16, 1, false, 0, Math.PI), satin(0x0b0c0e, { roughness: 0.9 }))
  notch.rotation.y = notchSide > 0 ? Math.PI / 2 : -Math.PI / 2
  notch.position.set(notchSide * (width / 2 - 0.02), 4.7, 0)
  g.add(notch)
  const tex = decal(`chip|${code}`, 256, 96, (ctx) => {
    ctx.fillStyle = "rgba(226,232,240,0.85)"
    ctx.font = "600 56px 'IBM Plex Mono', monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(code, 128, 50)
  })
  const print = printed(tex, Math.min(width * 0.7, 12), Math.min(width * 0.7, 12) * 0.375)
  print.position.y = 4.92
  g.add(print)
  return g
}

export function chipLeg(): Mesh {
  return new Mesh(new BoxGeometry(0.9, 3.4, 0.3), metal())
}

export function makeMotor(blade = PART_COLORS.pink): Group {
  const g = new Group()
  const can: [number, number][] = [[0, -13], [8.6, -13], [9.6, -12.2], [10, -11], [10, 11], [9.4, 12.4], [5, 13], [0, 13]]
  const body = named(new Group(), "body")
  const shell = new Mesh(lathe(can, 40), new MeshStandardMaterial({ color: 0xc7ccd3, metalness: 0.85, roughness: 0.32 }))
  shell.rotation.x = Math.PI / 2
  body.add(shell)
  const band = new Mesh(new CylinderGeometry(10.15, 10.15, 7, 40, 1, true), satin(PART_COLORS.blue))
  band.rotation.x = Math.PI / 2
  band.position.z = -3
  body.add(band)
  const boss = new Mesh(new CylinderGeometry(2.6, 3.2, 1.6, 24), metal())
  boss.rotation.x = Math.PI / 2
  boss.position.z = 13.6
  body.add(boss)
  for (const x of [-5, 5]) {
    const tab = new Mesh(new BoxGeometry(1.6, 3, 0.4), new MeshStandardMaterial({ color: 0xd4a256, metalness: 0.9, roughness: 0.3 }))
    tab.position.set(x, -6, -13.3)
    body.add(tab)
  }
  body.position.y = 10
  g.add(body)
  for (const z of [-7, 7]) {
    const foot = rounded(16, 2.2, 4, 0.8, satin(0x374151))
    foot.position.set(0, 1.1, z)
    g.add(foot)
  }
  const rotor = named(new Group(), "rotor")
  rotor.position.set(0, 10, 16)
  const shaft = new Mesh(new CylinderGeometry(0.8, 0.8, 5, 12), metal())
  shaft.rotation.x = Math.PI / 2
  shaft.position.z = -1.5
  rotor.add(shaft)
  const hub = new Mesh(new CylinderGeometry(2.2, 2.2, 2.2, 24), satin(blade, { roughness: 0.4 }))
  hub.rotation.x = Math.PI / 2
  rotor.add(hub)
  for (let i = 0; i < 3; i++) {
    const holder = new Group()
    holder.rotation.z = (i * Math.PI * 2) / 3
    const fin = rounded(3.6, 11, 0.9, 0.45, satin(blade, { roughness: 0.4 }))
    fin.position.y = 6.5
    fin.rotation.y = 0.35
    holder.add(fin)
    rotor.add(holder)
  }
  const marker = new Mesh(new CylinderGeometry(0.9, 0.9, 1.1, 12), satin(0xffffff))
  marker.rotation.x = Math.PI / 2
  marker.position.set(0, 10, 0.4)
  rotor.add(marker)
  g.add(rotor)
  return g
}

export function makeBuzzer(): Group {
  const g = new Group()
  const body = named(new Mesh(lathe([[0, 0], [5.8, 0], [6, 0.4], [6, 8.4], [5.6, 9], [0, 9]], 40), satin(0x1d1f23, { roughness: 0.55 })), "body")
  g.add(body)
  const rim = new Mesh(new TorusGeometry(1.7, 0.35, 10, 28), satin(0x2c2f35))
  rim.rotation.x = Math.PI / 2
  rim.position.y = 9.05
  g.add(rim)
  const hole = new Mesh(new CircleGeometry(1.5, 24), new MeshBasicMaterial({ color: 0x050506 }))
  hole.rotation.x = -Math.PI / 2
  hole.position.y = 9.03
  g.add(hole)
  const tex = decal("buzzer|+", 64, 64, (ctx) => {
    ctx.fillStyle = "rgba(255,255,255,0.8)"
    ctx.font = "700 48px Rubik, sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("+", 32, 34)
  })
  const plus = printed(tex, 2.6, 2.6)
  plus.position.set(-3.6, 9.04, 0)
  g.add(plus)
  return g
}

export function makeLedHead(color: number, glowLevel: number): Group {
  const g = new Group()
  const material = new MeshPhysicalMaterial({ color, roughness: 0.18, transmission: lite ? 0 : 0.25, thickness: 1, transparent: true, opacity: 0.88, emissive: color, emissiveIntensity: glowLevel })
  const profile: [number, number][] = [[0, 0], [1.85, 0], [1.9, 0.15], [1.9, 0.5], [1.55, 0.65], [1.5, 0.75], [1.5, 2.9]]
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2)
    profile.push([1.5 * Math.cos(a), 2.9 + 1.5 * Math.sin(a)])
  }
  const head = named(new Mesh(lathe(profile, 28), material), "body")
  head.userData.glows = true
  g.add(head)
  return g
}

export function makeDiodeBody(length: number): Group {
  const g = new Group()
  const h = length / 2
  const profile: [number, number][] = [[0, -h], [0.8, -h], [0.95, -h + 0.2], [0.95, h - 0.2], [0.8, h], [0, h]]
  g.add(named(new Mesh(lathe(profile, 24), satin(0x16181d, { roughness: 0.4 })), "body"))
  const band = new Mesh(new CylinderGeometry(0.99, 0.99, 0.55, 24, 1, true), satin(0xd6d3d1, { roughness: 0.3, metalness: 0.6 }))
  band.position.y = h - 0.75
  g.add(band)
  return g
}

export function makeResistorBody(bands: string[], length: number): Group {
  const g = new Group()
  const h = length / 2
  const profile: [number, number][] = [[0, -h], [0.7, -h], [1.12, -h + 0.25], [1.18, -h + 1], [0.98, -h + 1.6], [0.98, h - 1.6], [1.18, h - 1], [1.12, h - 0.25], [0.7, h], [0, h]]
  const body = named(new Mesh(lathe(profile, 24), satin(0xe9d6ab, { roughness: 0.55 })), "body")
  g.add(body)
  bands.forEach((band, i) => {
    const t = -0.32 + i * 0.2 + (i === 3 ? 0.08 : 0)
    const y = t * length
    const r = Math.abs(y) > h - 1.6 ? 1.2 : 1.01
    const ring = new Mesh(new CylinderGeometry(r, r, 0.42, 24, 1, true), satin(Number.parseInt(bandHex(band).slice(1), 16), { roughness: 0.45 }))
    ring.position.y = y
    g.add(ring)
  })
  return g
}

export type BreadboardLayout = { halfX: number; halfZ: number; height: number; pitch: number; columns: number; rowZ: Record<string, number>; railZ: Record<string, number> }

export function makeBreadboard(layout: BreadboardLayout): Group {
  const g = new Group()
  const { halfX, halfZ, height, pitch, columns } = layout
  const board = named(rounded(halfX * 2, height, halfZ * 2, 1.4, satin(0xfbfbf8, { roughness: 0.62 })), "body")
  board.position.y = -height / 2
  board.receiveShadow = true
  g.add(board)
  const channel = new Mesh(new BoxGeometry(halfX * 2 - 4, 0.3, pitch * 0.85), satin(0xe4e2dc, { roughness: 0.8 }))
  channel.position.y = -0.1
  channel.receiveShadow = true
  g.add(channel)
  const scale = 16
  const w = Math.round(halfX * 2 * scale)
  const d = Math.round(halfZ * 2 * scale)
  const tex = decal(`board|${columns}`, w, d, (ctx) => {
    const x = (col: number) => ((col - (columns + 1) / 2) * pitch + halfX) * scale
    const z = (rowUnits: number) => (rowUnits * pitch + halfZ) * scale
    for (const [rail, rz] of Object.entries(layout.railZ)) {
      const positive = rail.endsWith("+")
      const offset = rail.startsWith("T") ? -0.6 : 0.6
      ctx.fillStyle = positive ? "#E11D74" : "#2563EB"
      ctx.fillRect(x(1) - pitch * scale * 0.5, z(rz + offset) - 3, columns * pitch * scale, 6)
      ctx.font = "700 44px Rubik, sans-serif"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      for (const side of [-1, 1]) ctx.fillText(positive ? "+" : "−", halfX * scale + side * (columns / 2 + 0.95) * pitch * scale, z(rz))
    }
    ctx.fillStyle = "#8A8F98"
    ctx.font = "500 22px 'IBM Plex Mono', monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    const top = Math.min(...Object.values(layout.rowZ))
    const bottom = Math.max(...Object.values(layout.rowZ))
    for (let col = 1; col <= columns; col++) {
      if (col !== 1 && col % 5 !== 0) continue
      ctx.fillText(String(col), x(col), z(top - 0.85))
      ctx.fillText(String(col), x(col), z(bottom + 0.85))
    }
    for (const [row, rz] of Object.entries(layout.rowZ)) {
      ctx.fillText(row, x(0) + 6, z(rz))
      ctx.fillText(row, x(columns + 1) - 6, z(rz))
    }
  })
  const print = printed(tex, halfX * 2, halfZ * 2)
  print.position.y = 0.02
  g.add(print)
  return g
}

export type FpsWatchOpts = { warmupMs: number; windowMs: number; minFps: number }

export function createFpsWatch(opts: FpsWatchOpts = { warmupMs: 3000, windowMs: 2000, minFps: 40 }) {
  let start: number | null = null
  let last = 0
  let windowStart: number | null = null
  let frames = 0
  let fired = false
  return {
    reset() {
      windowStart = null
    },
    sample(nowMs: number): "ok" | "degrade" {
      if (fired) return "ok"
      if (start === null) start = nowMs
      // aba escondida ou montagem pesada de fase travam um quadro; isso não é fps baixo de verdade
      if (nowMs - last > 1000) windowStart = null
      last = nowMs
      if (nowMs - start < opts.warmupMs) return "ok"
      if (windowStart === null) {
        windowStart = nowMs
        frames = 0
        return "ok"
      }
      frames++
      const elapsed = nowMs - windowStart
      if (elapsed < opts.windowMs) return "ok"
      const fps = (frames * 1000) / elapsed
      windowStart = nowMs
      frames = 0
      if (fps >= opts.minFps) return "ok"
      fired = true
      return "degrade"
    },
  }
}

export function makeCuttingMat(w: number, d: number, color: string): Group {
  const g = new Group()
  const base = new Mesh(new RoundedBoxGeometry(w, 0.8, d, 2, 0.4), satin(new Color(color).getHex(), { roughness: 0.85 }))
  base.position.y = 0.4
  base.receiveShadow = true
  g.add(base)
  const scale = 8
  const tex = decal(`mat|${w}|${d}`, Math.round(w * scale), Math.round(d * scale), (ctx) => {
    ctx.strokeStyle = "rgba(255,255,255,0.35)"
    ctx.lineWidth = 1.5
    for (let x = 10; x < w; x += 10) {
      ctx.beginPath()
      ctx.moveTo(x * scale, 0)
      ctx.lineTo(x * scale, d * scale)
      ctx.stroke()
    }
    for (let z = 10; z < d; z += 10) {
      ctx.beginPath()
      ctx.moveTo(0, z * scale)
      ctx.lineTo(w * scale, z * scale)
      ctx.stroke()
    }
  })
  const grid = printed(tex, w - 2, d - 2)
  grid.position.y = 0.82
  g.add(grid)
  return g
}

function deskLamp(): Group {
  const g = new Group()
  const shell = satin(PART_COLORS.yellow, { roughness: 0.4 })
  const base = new Mesh(lathe([[0, 0], [11, 0], [11, 2.2], [9, 3.4], [0, 3.4]], 40), shell)
  g.add(base)
  const joint = (y: number) => {
    const ball = new Mesh(new CylinderGeometry(1.8, 1.8, 3.4, 20), metal())
    ball.rotation.z = Math.PI / 2
    ball.position.y = y
    return ball
  }
  const lower = new Group()
  lower.position.y = 3.4
  lower.rotation.z = -0.35
  const arm1 = new Mesh(new CylinderGeometry(1.1, 1.1, 34, 14), shell)
  arm1.position.y = 17
  lower.add(joint(0), arm1)
  const upper = new Group()
  upper.position.y = 34
  upper.rotation.z = 1.5
  const arm2 = new Mesh(new CylinderGeometry(1.1, 1.1, 28, 14), shell)
  arm2.position.y = 14
  upper.add(joint(0), arm2)
  const head = new Group()
  head.position.y = 28
  head.rotation.z = 0.9
  const shade = new Mesh(lathe([[2.2, 0], [3.4, 1.5], [7.5, 9], [7.9, 10]], 32), satin(PART_COLORS.yellow, { roughness: 0.4 }))
  shade.material.side = DoubleSide
  shade.rotation.x = Math.PI
  head.add(joint(0), shade)
  const bulb = new Mesh(new CylinderGeometry(2.6, 2.6, 0.4, 20), satin(0xfff7e0, { emissive: 0xffe2a8, emissiveIntensity: 1.4 }))
  bulb.position.y = -8.6
  head.add(bulb)
  upper.add(head)
  lower.add(upper)
  g.add(lower)
  return g
}

function shelf(): Group {
  const g = new Group()
  const wood = satin(0xd9b48a, { roughness: 0.7 })
  const w = 56
  const h = 64
  const d = 22
  for (const x of [-w / 2, w / 2]) {
    const side = rounded(2.4, h, d, 0.6, wood)
    side.position.set(x, h / 2, 0)
    g.add(side)
  }
  for (const y of [1.2, h / 3, (2 * h) / 3, h - 1.2]) {
    const board = rounded(w, 2.4, d, 0.6, wood)
    board.position.y = y
    g.add(board)
  }
  const back = new Mesh(new BoxGeometry(w, h, 0.8), satin(0xc9a37a, { roughness: 0.8 }))
  back.position.set(0, h / 2, -d / 2 + 0.4)
  g.add(back)
  const colors = [PART_COLORS.blue, PART_COLORS.coral, PART_COLORS.green, PART_COLORS.purple, PART_COLORS.orange, PART_COLORS.pink]
  let n = 0
  for (const y of [2.4, h / 3 + 1.2, (2 * h) / 3 + 1.2]) {
    for (let i = 0; i < 3; i++) {
      const box = rounded(14, 12, 16, 1.2, satin(colors[n++ % colors.length], { roughness: 0.45 }))
      box.position.set(-17 + i * 17, y + 6, 1)
      g.add(box)
      const label = new Mesh(new BoxGeometry(7, 3, 0.3), satin(0xffffff))
      label.position.set(-17 + i * 17, y + 7, 9.1)
      g.add(label)
    }
  }
  return g
}

function poster(): Group {
  const g = new Group()
  const wood = satin(0x8b5e3c, { roughness: 0.7 })
  for (const [x, z, r] of [[-14, 4, 0.12], [14, 4, -0.12], [0, -10, 0]] as const) {
    const leg = new Mesh(new CylinderGeometry(0.9, 0.9, 72, 10), wood)
    leg.position.set(x, 35, z)
    leg.rotation.z = r
    if (z < 0) leg.rotation.x = -0.28
    else leg.rotation.x = 0.1
    g.add(leg)
  }
  const tex = decal("poster", 400, 520, (ctx) => {
    ctx.fillStyle = "#0B2540"
    ctx.fillRect(0, 0, 400, 520)
    ctx.strokeStyle = "rgba(159,211,255,0.18)"
    ctx.lineWidth = 1
    for (let i = 0; i < 400; i += 20) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, 520)
      ctx.stroke()
    }
    for (let i = 0; i < 520; i += 20) {
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(400, i)
      ctx.stroke()
    }
    ctx.strokeStyle = "#9FD3FF"
    ctx.lineWidth = 5
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.beginPath()
    ctx.moveTo(100, 140)
    ctx.lineTo(300, 140)
    ctx.lineTo(300, 200)
    for (let i = 0; i < 4; i++) ctx.lineTo(i % 2 ? 280 : 320, 215 + i * 15)
    ctx.lineTo(300, 275)
    ctx.lineTo(300, 340)
    ctx.lineTo(100, 340)
    ctx.lineTo(100, 270)
    ctx.moveTo(100, 210)
    ctx.lineTo(100, 140)
    ctx.moveTo(70, 210)
    ctx.lineTo(130, 210)
    ctx.moveTo(85, 270)
    ctx.lineTo(115, 270)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(200, 340, 22, 0, Math.PI * 2)
    ctx.fillStyle = "#0B2540"
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(185, 325)
    ctx.lineTo(215, 355)
    ctx.moveTo(215, 325)
    ctx.lineTo(185, 355)
    ctx.stroke()
    ctx.fillStyle = "#9FD3FF"
    ctx.font = "700 34px Rubik, sans-serif"
    ctx.textAlign = "center"
    ctx.fillText("Fio Contínuo", 200, 440)
    ctx.font = "500 18px 'IBM Plex Mono', monospace"
    ctx.fillText("9 V · 2 × 220 Ω · L1", 200, 475)
  })
  const board = new Group()
  board.position.set(0, 46, 2.5)
  board.rotation.x = -0.1
  const frame = rounded(42, 54, 1.6, 0.6, satin(0xf8fafc))
  board.add(frame)
  const art = new Mesh(new PlaneGeometry(38, 49.4), new MeshBasicMaterial({ map: tex, toneMapped: false }))
  art.position.z = 0.82
  board.add(art)
  g.add(board)
  return g
}

function tools(): Group {
  const g = new Group()
  const handle = new Mesh(lathe([[0, 0], [2.4, 0.3], [2.8, 3], [2.6, 14], [2, 16], [0, 16.4]], 20), satin(PART_COLORS.coral, { roughness: 0.4 }))
  handle.rotation.z = Math.PI / 2
  handle.position.set(-6, 2.8, 0)
  g.add(handle)
  const shaft = new Mesh(new CylinderGeometry(0.7, 0.7, 22, 10), metal())
  shaft.rotation.z = Math.PI / 2
  shaft.position.set(-33, 2.8, 0)
  g.add(shaft)
  const pliers = new Group()
  pliers.position.set(-10, 1.1, 18)
  pliers.rotation.y = 0.5
  for (const side of [-1, 1]) {
    const grip = rounded(26, 2.2, 3.6, 1, satin(PART_COLORS.blue, { roughness: 0.4 }))
    grip.position.set(-6, 0, side * 4)
    grip.rotation.y = side * -0.18
    pliers.add(grip)
    const jaw = rounded(14, 2, 2.6, 0.6, metal())
    jaw.position.set(-25, 0, side * 1.2)
    jaw.rotation.y = side * 0.05
    pliers.add(jaw)
  }
  g.add(pliers)
  return g
}

function trophy(): Group {
  const g = new Group()
  const gold = new MeshStandardMaterial({ color: 0xffc21a, metalness: 0.85, roughness: 0.25 })
  const base = rounded(18, 6, 18, 1.2, satin(0x1f2937, { roughness: 0.5 }))
  base.position.y = 3
  g.add(base)
  const cup = new Mesh(lathe([[0, 0], [4, 0], [4, 1.2], [1.4, 2.4], [1.2, 9], [3, 11], [7.5, 15], [9, 24], [8.4, 24.4], [0, 16]], 40), gold)
  cup.position.y = 6
  g.add(cup)
  for (const side of [-1, 1]) {
    const ear = new Mesh(new TorusGeometry(3.6, 0.8, 10, 24, Math.PI * 1.2), gold)
    ear.position.set(side * 8.6, 25, 0)
    ear.rotation.z = side > 0 ? -Math.PI * 0.6 : Math.PI * 1.6
    g.add(ear)
  }
  return g
}

export function makeDecor(id: string, color = 0xb87333): Group {
  if (id === "lamp-desk") return deskLamp()
  if (id === "shelf") return shelf()
  if (id === "poster") return poster()
  if (id === "tools") return tools()
  if (id === "trophy") return trophy()
  const g = new Group()
  const box = rounded(16, 16, 16, 2, satin(color))
  box.position.y = 8
  g.add(box)
  return g
}
