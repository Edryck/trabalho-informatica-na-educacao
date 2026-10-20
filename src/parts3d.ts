import { CanvasTexture, CubicBezierCurve3, MeshStandardMaterial, Sprite, SpriteMaterial, Vector3 } from "three"

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
  const sprite = new Sprite(new SpriteMaterial({ map: textTexture(text, color, background), depthTest: false }))
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
  const sprite = new Sprite(new SpriteMaterial({ map: iconTexture(name, color), depthTest: false }))
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

export function std(color: number | string, extra: Partial<{ emissive: number; emissiveIntensity: number; roughness: number; metalness: number; transparent: boolean; opacity: number }> = {}) {
  return new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...extra })
}

