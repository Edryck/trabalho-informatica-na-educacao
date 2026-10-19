import type { BenchCallbacks, BenchTool } from "./bench"
import type { Divergence, PartsCatalog, PointId } from "./netlist"
import type { PartState, SolveResult } from "./solver"
import { nextInstanceId, prefixFor, type AppView, type BlueprintPlacement, type CircuitDoc } from "./state"
import { formatValue, particleSpeed } from "./ui"

export type SymbolStandard = "IEC" | "ANSI"
export type BlueprintRenderOpts = {
  currentView: boolean
  reducedMotion: boolean
  standard: SymbolStandard
  preview?: SolveResult
  divergences?: Divergence[]
}

const GRID = 20
const SVG_NS = "http://www.w3.org/2000/svg"
const LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,5}$/

type Rotation = BlueprintPlacement["rotation"]
type Pick = { kind: "part" | "segment" | "label"; id: string }
type Mode =
  | { kind: "idle" }
  | { kind: "wire"; points: [number, number][] }
  | { kind: "place"; type: string; value?: number; id?: string; rotation: Rotation }

const CHIP_TITLES: Record<string, string> = {
  chip_nand: "7400 NAND",
  chip_nor: "7402 NOR",
  chip_not: "7404 NOT",
  chip_and: "7408 AND",
  chip_or: "7432 OR",
  chip_xor: "7486 XOR",
  chip_xnor: "XNOR",
}

const lead = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`

export const SYMBOLS: Record<string, (state: PartState | undefined, input: string | undefined, standard: SymbolStandard) => string> = {
  resistor: () => `${lead(-40, 0, -24, 0)}<rect x="-24" y="-9" width="48" height="18"/>${lead(24, 0, 40, 0)}`,
  lamp: (state) => {
    const on = state?.kind === "lamp" && state.lit
    return `${lead(-40, 0, -18, 0)}${lead(18, 0, 40, 0)}<circle class="${on ? "lit" : ""}" r="18"/><line x1="-12.7" y1="-12.7" x2="12.7" y2="12.7"/><line x1="-12.7" y1="12.7" x2="12.7" y2="-12.7"/>`
  },
  battery: () =>
    `${lead(0, -40, 0, -6)}${lead(0, 6, 0, 40)}<line class="plate" x1="-22" y1="-6" x2="22" y2="-6"/><line class="plate thick" x1="-11" y1="6" x2="11" y2="6"/><text class="pole" x="18" y="-14">+</text><text class="pole" x="18" y="24">−</text>`,
  switch: (_state, input) => {
    const closed = input === "on"
    return `${lead(-40, 0, -20, 0)}${lead(20, 0, 40, 0)}<circle class="node" cx="-20" cy="0" r="2.5"/><circle class="node" cx="20" cy="0" r="2.5"/><line x1="-20" y1="0" x2="${closed ? 20 : 16}" y2="${closed ? 0 : -16}"/>`
  },
  push_button: (_state, input) => {
    const closed = input === "pressed"
    return `${lead(-40, -20, -20, -20)}${lead(-40, 20, -20, 20)}${lead(20, -20, 40, -20)}${lead(20, 20, 40, 20)}<line x1="-20" y1="-20" x2="-20" y2="20"/><line x1="20" y1="-20" x2="20" y2="20"/><line x1="-20" y1="${closed ? 0 : 4}" x2="20" y2="${closed ? 0 : 4}"/><line x1="0" y1="${closed ? 0 : 4}" x2="0" y2="-12"/><line x1="-7" y1="-12" x2="7" y2="-12"/>`
  },
  dc_motor: (state) => {
    const on = state?.kind === "motor" && state.spinning
    return `${lead(-40, 0, -18, 0)}${lead(18, 0, 40, 0)}<circle class="${on ? "lit" : ""}" r="18"/><text class="glyph" y="7">M</text><text class="pole" x="-34" y="-8">+</text>`
  },
  buzzer: (state) => {
    const on = state?.kind === "buzzer" && state.sounding
    const waves = on ? `<path class="wave" d="M24 -22a14 14 0 010 20"/><path class="wave" d="M30 -28a22 22 0 010 32"/>` : ""
    return `${lead(-40, 0, -14, 0)}${lead(14, 0, 40, 0)}<path class="${on ? "lit" : ""}" d="M-14 6v-6a14 14 0 0128 0v6z"/><text class="pole" x="-34" y="-8">+</text>${waves}`
  },
  logic_switch: (_state, input) => {
    const high = input === "1"
    return `${lead(0, -40, 0, -20)}${lead(0, 20, 0, 40)}${lead(20, 0, 40, 0)}<circle class="node" cx="0" cy="-20" r="2.5"/><circle class="node" cx="0" cy="20" r="2.5"/><circle class="node" cx="20" cy="0" r="2.5"/><line x1="20" y1="0" x2="${high ? 3 : 3}" y2="${high ? -17 : 17}"/><text class="pole" x="-12" y="-16">1</text><text class="pole" x="-12" y="26">0</text>`
  },
  led: (state) => {
    const on = state?.kind === "led" && state.lit
    return `${lead(-40, 0, -10, 0)}${lead(10, 0, 40, 0)}<path class="${on ? "lit" : ""}" d="M-10 -12L10 0L-10 12Z"/><line x1="10" y1="-12" x2="10" y2="12"/><path d="M2 -16l8 -8M6 -24h4v4M10 -12l8 -8M14 -20h4v4"/>`
  },
}

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

function parsePoint(point: PointId): [number, number] | null {
  if (!point.startsWith("g:")) return null
  const [x, y] = point.slice(2).split(",").map(Number)
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}

function rotatePin([x, y]: [number, number], rotation: number): [number, number] {
  switch (rotation) {
    case 90:
      return [-y, x]
    case 180:
      return [-x, -y]
    case 270:
      return [y, -x]
    default:
      return [x, y]
  }
}

function valueText(type: string, value: number): string | null {
  if (type === "resistor") return formatValue(value, "Ω")
  if (type === "battery") return formatValue(value, "V")
  return null
}

type Particle = { node: SVGCircleElement; from: [number, number]; to: [number, number]; t: number; speed: number }

export function createBlueprint(container: HTMLElement, catalog: PartsCatalog, cb: BenchCallbacks & { onHint?(text: string | null): void }) {
  const svg = el("svg", { class: "blueprint", role: "img", "aria-label": "Blueprint do circuito" })
  const defs = el("defs")
  const pattern = el("pattern", { id: "bp-grid", width: GRID, height: GRID, patternUnits: "userSpaceOnUse" })
  pattern.appendChild(el("path", { d: `M${GRID} 0H0V${GRID}`, class: "grid-line" }))
  const major = el("pattern", { id: "bp-grid-major", width: GRID * 5, height: GRID * 5, patternUnits: "userSpaceOnUse" })
  major.appendChild(el("rect", { width: GRID * 5, height: GRID * 5, fill: "url(#bp-grid)" }))
  major.appendChild(el("path", { d: `M${GRID * 5} 0H0V${GRID * 5}`, class: "grid-line major" }))
  defs.append(pattern, major)
  svg.appendChild(defs)
  const background = el("rect", { class: "grid", x: -5000, y: -5000, width: 10000, height: 10000, fill: "url(#bp-grid-major)" })
  const wiresLayer = el("g", { class: "wires" })
  const junctionLayer = el("g", { class: "junctions" })
  const partsLayer = el("g", { class: "parts" })
  const flowLayer = el("g", { class: "flow" })
  const markerLayer = el("g", { class: "markers" })
  const ghostLayer = el("g", { class: "ghost" })
  svg.append(background, wiresLayer, junctionLayer, partsLayer, flowLayer, markerLayer, ghostLayer)
  container.appendChild(svg)

  const labelInput = document.createElement("input")
  labelInput.className = "label-editor"
  labelInput.setAttribute("aria-label", "Nome da peça")
  labelInput.maxLength = 6
  labelInput.hidden = true
  container.appendChild(labelInput)

  let view: AppView | null = null
  let opts: BlueprintRenderOpts = { currentView: false, reducedMotion: false, standard: "IEC" }
  let mode: Mode = { kind: "idle" }
  let selection: Pick | null = null
  let cursor: [number, number] | null = null
  let camera = { x: -10 * GRID, y: -6 * GRID, scale: 1 }
  let pan: { x: number; y: number; cam: typeof camera } | null = null
  let drag: { id: string; start: [number, number]; origin: [number, number]; doc: CircuitDoc; moved: boolean } | null = null
  let pressedButton: string | null = null
  let editing: string | null = null
  let particles: Particle[] = []
  let lastHint: string | null = null
  let lockedIds = new Set<string>()

  function applyCamera() {
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    svg.setAttribute("viewBox", `${camera.x} ${camera.y} ${w / camera.scale} ${h / camera.scale}`)
  }

  function frame() {
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    const placements = view?.doc.blueprint.placements ?? []
    if (placements.length === 0) {
      camera = { x: -w / 2, y: -h / 2, scale: 1 }
    } else {
      const xs = placements.map((p) => p.x * GRID)
      const ys = placements.map((p) => p.y * GRID)
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2
      camera = { x: cx - w / 2, y: cy - h / 2, scale: 1 }
    }
    applyCamera()
  }

  const resizeObserver = new ResizeObserver(applyCamera)
  resizeObserver.observe(container)

  function toGrid(event: PointerEvent | MouseEvent): [number, number] {
    const rect = svg.getBoundingClientRect()
    const x = camera.x + (event.clientX - rect.left) / camera.scale
    const y = camera.y + (event.clientY - rect.top) / camera.scale
    return [Math.round(x / GRID), Math.round(y / GRID)]
  }

  function doc(): CircuitDoc {
    return structuredClone(view!.doc)
  }

  function result(): SolveResult | undefined {
    return opts.preview ?? view?.blueprintResult
  }

  function pinPositions(d: CircuitDoc): Map<string, [number, number]> {
    const map = new Map<string, [number, number]>()
    const types = new Map(d.instances.map((i) => [i.id, i.type]))
    for (const p of d.blueprint.placements) {
      const def = catalog[types.get(p.id) ?? ""]
      if (!def) continue
      for (const pin of def.pins) {
        const [dx, dy] = rotatePin(def.symbolPins[pin], p.rotation)
        map.set(`${p.id}.${pin}`, [p.x + dx, p.y + dy])
      }
    }
    return map
  }

  function touchesCircuit(d: CircuitDoc, [x, y]: [number, number], ignoreLast = false): boolean {
    for (const pos of pinPositions(d).values()) if (pos[0] === x && pos[1] === y) return true
    const segments = ignoreLast ? d.blueprint.segments.slice(0, -1) : d.blueprint.segments
    return segments.some((s) => {
      const minX = Math.min(s.x1, s.x2)
      const maxX = Math.max(s.x1, s.x2)
      const minY = Math.min(s.y1, s.y2)
      const maxY = Math.max(s.y1, s.y2)
      return x >= minX && x <= maxX && y >= minY && y <= maxY && (s.x1 === s.x2 || s.y1 === s.y2)
    })
  }

  function chipSymbol(type: string, state: PartState | undefined): string {
    const def = catalog[type]
    if (!def) return ""
    const outputs = state?.kind === "logic" ? state.outputs : {}
    const parts: string[] = [`<rect x="-44" y="-136" width="88" height="272" rx="3"/><path class="notch" d="M-10 -136a10 10 0 0020 0"/>`]
    parts.push(`<text class="chip-code" x="0" y="4" transform="rotate(-90)">${CHIP_TITLES[type] ?? type}</text>`)
    def.pins.forEach((pin, i) => {
      const [gx, gy] = def.symbolPins[pin]
      const x = gx * GRID
      const y = gy * GRID
      const inner = x < 0 ? -44 : 44
      const high = outputs[pin] === 1
      parts.push(`<line class="${high ? "lit" : ""}" x1="${x}" y1="${y}" x2="${inner}" y2="${y}"/>`)
      parts.push(`<text class="pin-name" x="${x < 0 ? -38 : 38}" y="${y + 4}" style="text-anchor:${x < 0 ? "start" : "end"}">${pin}</text>`)
      parts.push(`<text class="pin-number" x="${x < 0 ? -52 : 52}" y="${y - 4}">${i + 1}</text>`)
    })
    return parts.join("")
  }

  function symbolGroup(type: string, state: PartState | undefined, input: string | undefined): SVGGElement {
    const g = el("g", { class: `symbol symbol-${type}` })
    if (type.startsWith("chip_")) {
      g.innerHTML = chipSymbol(type, state)
      return g
    }
    const draw = SYMBOLS[type]
    g.innerHTML = draw ? draw(state, input, opts.standard) : `<rect x="-20" y="-12" width="40" height="24"/>`
    return g
  }

  function renderParts() {
    partsLayer.replaceChildren()
    if (!view) return
    const r = result()
    const byId = new Map(view.doc.instances.map((i) => [i.id, i]))
    for (const placement of view.doc.blueprint.placements) {
      const instance = byId.get(placement.id)
      if (!instance) continue
      const input = pressedButton === placement.id ? "pressed" : instance.inputState
      const g = el("g", { class: "part", transform: `translate(${placement.x * GRID} ${placement.y * GRID})`, "data-id": placement.id })
      if (selection?.kind === "part" && selection.id === placement.id) g.classList.add("selected")
      const chip = instance.type.startsWith("chip_")
      const hit = chip ? el("rect", { class: "hit", x: -64, y: -142, width: 128, height: 284 }) : el("rect", { class: "hit", x: -44, y: -26, width: 88, height: 52 })
      const sym = symbolGroup(instance.type, r?.partState[placement.id], input)
      sym.setAttribute("transform", `rotate(${placement.rotation})`)
      g.append(hit, sym)
      const pins = catalog[instance.type]?.symbolPins ?? {}
      const spread = Object.values(pins).map((pin) => rotatePin(pin, placement.rotation))
      const vertical = spread.length > 0 && Math.max(...spread.map(([, y]) => Math.abs(y))) > Math.max(...spread.map(([x]) => Math.abs(x)))
      const labelX = vertical ? 30 : 0
      const labelY = chip ? -150 : vertical ? -6 : -24
      const anchor = vertical ? "start" : "middle"
      const name = el("text", { class: "label", x: labelX, y: labelY, "text-anchor": anchor, "data-label": placement.id })
      name.textContent = placement.id
      g.appendChild(name)
      const value = valueText(instance.type, instance.value)
      if (value) {
        const v = el("text", { class: "value", x: labelX, y: vertical ? 10 : 36, "text-anchor": anchor })
        v.textContent = value
        g.appendChild(v)
      }
      partsLayer.appendChild(g)
    }
  }

  function renderWires() {
    wiresLayer.replaceChildren()
    junctionLayer.replaceChildren()
    if (!view) return
    for (const s of view.doc.blueprint.segments) {
      const line = el("line", { class: "wire", x1: s.x1 * GRID, y1: s.y1 * GRID, x2: s.x2 * GRID, y2: s.y2 * GRID, "data-segment": s.id })
      if (selection?.kind === "segment" && selection.id === s.id) line.classList.add("selected")
      const hit = el("line", { class: "wire-hit", x1: s.x1 * GRID, y1: s.y1 * GRID, x2: s.x2 * GRID, y2: s.y2 * GRID, "data-segment": s.id })
      wiresLayer.append(line, hit)
    }
    const ends = new Map<string, number>()
    for (const link of view.blueprintNet.links) for (const p of [link.a, link.b]) ends.set(p, (ends.get(p) ?? 0) + 1)
    const pins = new Set(Object.values(view.blueprintNet.pinAt))
    for (const [point, count] of ends) {
      const pos = parsePoint(point)
      if (!pos || count + (pins.has(point) ? 1 : 0) < 3) continue
      junctionLayer.appendChild(el("circle", { class: "junction", cx: pos[0] * GRID, cy: pos[1] * GRID, r: 4 }))
    }
  }

  function renderFlow() {
    flowLayer.replaceChildren()
    particles = []
    const r = result()
    if (!view || !r || !opts.currentView) return
    for (const link of view.blueprintNet.links) {
      const current = r.linkCurrent[link.id] ?? 0
      const speed = particleSpeed(current)
      const a = parsePoint(link.a)
      const b = parsePoint(link.b)
      if (speed === 0 || !a || !b) continue
      const [from, to] = current > 0 ? [a, b] : [b, a]
      const mx = ((from[0] + to[0]) / 2) * GRID
      const my = ((from[1] + to[1]) / 2) * GRID
      const angle = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI
      flowLayer.appendChild(el("path", { class: "arrow", d: "M-5 -5L5 0L-5 5Z", transform: `translate(${mx} ${my}) rotate(${angle})` }))
      if (opts.reducedMotion) continue
      const length = Math.hypot(to[0] - from[0], to[1] - from[1])
      const count = Math.max(1, Math.floor(length / 2))
      for (let i = 0; i < count; i++) {
        const node = el("circle", { class: "particle", r: 3 })
        flowLayer.appendChild(node)
        particles.push({ node, from, to, t: i / count, speed: speed / Math.max(length, 0.5) })
      }
    }
  }

  function renderMarkers() {
    markerLayer.replaceChildren()
    if (!view || !opts.divergences) return
    for (const d of opts.divergences) {
      if (d.kind === "pending" || !d.pin) continue
      const pos = parsePoint(view.blueprintNet.pinAt[`${d.partId}.${d.pin}`] ?? "")
      if (!pos) continue
      markerLayer.appendChild(el("circle", { class: "divergence", cx: pos[0] * GRID, cy: pos[1] * GRID, r: 10 }))
    }
  }

  function renderGhost() {
    ghostLayer.replaceChildren()
    if (!view || !cursor) return
    if (mode.kind === "place") {
      const g = el("g", { class: "ghost-part", transform: `translate(${cursor[0] * GRID} ${cursor[1] * GRID}) rotate(${mode.rotation})` })
      g.appendChild(symbolGroup(mode.type, undefined, undefined))
      ghostLayer.appendChild(g)
    }
    if (mode.kind === "wire") {
      ghostLayer.appendChild(el("circle", { class: "wire-cursor", cx: cursor[0] * GRID, cy: cursor[1] * GRID, r: 4 }))
      const last = mode.points.at(-1)
      if (last) {
        const end = dominant(last, cursor)
        ghostLayer.appendChild(el("line", { class: "wire ghost-wire", x1: last[0] * GRID, y1: last[1] * GRID, x2: end[0] * GRID, y2: end[1] * GRID }))
      }
    }
  }

  function dominant(from: [number, number], to: [number, number]): [number, number] {
    return Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]) ? [to[0], from[1]] : [from[0], to[1]]
  }

  function hintFor(m: Mode): string | null {
    if (m.kind === "wire") return m.points.length === 0 ? "Clique num ponto da grade pra começar o fio" : "Clique pra dobrar · duplo clique ou Esc termina"
    if (m.kind === "place") return "Clique na grade pra colocar · R gira · Esc cancela"
    return null
  }

  function emitHint() {
    const next = hintFor(mode)
    if (next !== lastHint) {
      lastHint = next
      cb.onHint?.(next)
    }
  }

  function renderAll() {
    renderWires()
    renderParts()
    renderFlow()
    renderMarkers()
    renderGhost()
    emitHint()
  }

  function nextSegmentId(d: CircuitDoc): string {
    const used = new Set(d.blueprint.segments.map((s) => s.id))
    let n = 1
    while (used.has(`F${n}`)) n++
    return `F${n}`
  }

  function finishWire() {
    if (mode.kind === "wire") mode = { kind: "wire", points: [] }
    renderGhost()
    emitHint()
  }

  function clickWire(point: [number, number]) {
    if (mode.kind !== "wire" || !view) return
    const last = mode.points.at(-1)
    if (!last) {
      mode = { kind: "wire", points: [point] }
      renderGhost()
      emitHint()
      return
    }
    const end = dominant(last, point)
    if (end[0] === last[0] && end[1] === last[1]) return
    const d = doc()
    d.blueprint.segments.push({ id: nextSegmentId(d), x1: last[0], y1: last[1], x2: end[0], y2: end[1] })
    const closes = touchesCircuit(view.doc, end)
    mode = { kind: "wire", points: [...mode.points, end] }
    cb.onChange(d, true)
    cb.onEvent("wireDrawn")
    if (closes) finishWire()
  }

  function placePart(point: [number, number]) {
    if (mode.kind !== "place" || !view) return
    const d = doc()
    const wanted = mode.id
    let id = wanted && d.instances.some((i) => i.id === wanted) ? wanted : null
    if (!id) {
      id = nextInstanceId(d, prefixFor(mode.type))
      const value = mode.value ?? catalog[mode.type]?.values?.[0] ?? 0
      d.instances.push({ id, type: mode.type, value, actualValue: value })
    }
    d.blueprint.placements.push({ id, x: point[0], y: point[1], rotation: mode.rotation })
    cb.onChange(d, true)
    cb.onEvent("partPlaced")
    mode = { kind: "idle" }
    cb.onEvent("toolReset")
    renderGhost()
    emitHint()
  }

  function toggleInput(id: string) {
    if (!view) return
    const instance = view.doc.instances.find((i) => i.id === id)
    if (!instance || !["switch", "battery", "logic_switch"].includes(instance.type)) return
    const d = doc()
    const target = d.instances.find((i) => i.id === id)!
    if (target.type === "switch") target.inputState = target.inputState === "on" ? "off" : "on"
    else if (target.type === "logic_switch") target.inputState = target.inputState === "1" ? "0" : "1"
    else target.inputState = target.inputState === "off" ? "on" : "off"
    cb.onChange(d, true)
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
    cb.onChange(d, false)
  }

  function pickAt(event: Event): Pick | null {
    const target = event.target as Element | null
    const label = target?.closest("[data-label]")
    if (label) return { kind: "label", id: label.getAttribute("data-label")! }
    const part = target?.closest(".part")
    if (part) return { kind: "part", id: part.getAttribute("data-id")! }
    const segment = target?.closest("[data-segment]")
    if (segment) return { kind: "segment", id: segment.getAttribute("data-segment")! }
    return null
  }

  function select(next: Pick | null) {
    selection = next
    renderParts()
    renderWires()
  }

  function startEditing(id: string) {
    if (lockedIds.has(id)) {
      cb.onEvent("lockedLabel")
      return
    }
    const node = partsLayer.querySelector(`[data-label="${CSS.escape(id)}"]`)
    if (!node) return
    const box = node.getBoundingClientRect()
    const host = container.getBoundingClientRect()
    editing = id
    labelInput.value = id
    labelInput.style.left = `${box.left - host.left - 8}px`
    labelInput.style.top = `${box.top - host.top - 6}px`
    labelInput.hidden = false
    labelInput.classList.remove("invalid")
    labelInput.focus()
    labelInput.select()
  }

  function commitLabel() {
    if (!editing || !view) return
    const from = editing
    const to = labelInput.value.trim()
    const taken = view.doc.instances.some((i) => i.id === to && i.id !== from)
    const locked = lockedIds.has(from) && to !== from
    if (!LABEL_PATTERN.test(to) || taken || locked) {
      labelInput.classList.add("invalid")
      labelInput.title = locked
        ? "A fase usa esse nome pra conferir o circuito, então ele fica assim"
        : taken
          ? "Esse nome já está em uso"
          : "Use letras e números, começando por letra (até 6)"
      labelInput.setAttribute("aria-invalid", "true")
      return
    }
    editing = null
    labelInput.hidden = true
    if (to === from) return
    const d = doc()
    for (const i of d.instances) if (i.id === from) i.id = to
    for (const p of d.blueprint.placements) if (p.id === from) p.id = to
    for (const p of d.bench.placements) if (p.id === from) p.id = to
    cb.onChange(d, true)
  }

  labelInput.addEventListener("keydown", (event) => {
    event.stopPropagation()
    if (event.key === "Enter") commitLabel()
    if (event.key === "Escape") {
      editing = null
      labelInput.hidden = true
    }
  })
  labelInput.addEventListener("blur", () => {
    if (editing) commitLabel()
    if (editing) {
      editing = null
      labelInput.hidden = true
    }
  })

  svg.addEventListener("pointermove", (event) => {
    const point = toGrid(event)
    if (pan) {
      camera = { ...pan.cam, x: pan.cam.x - (event.clientX - pan.x) / camera.scale, y: pan.cam.y - (event.clientY - pan.y) / camera.scale }
      applyCamera()
      return
    }
    if (drag && view) {
      const dx = point[0] - drag.start[0]
      const dy = point[1] - drag.start[1]
      const d = structuredClone(drag.doc)
      const placement = d.blueprint.placements.find((p) => p.id === drag!.id)
      if (placement && (dx !== 0 || dy !== 0 || drag.moved)) {
        placement.x = drag.origin[0] + dx
        placement.y = drag.origin[1] + dy
        drag.moved = true
        cb.onChange(d, false)
      }
      return
    }
    if (!cursor || cursor[0] !== point[0] || cursor[1] !== point[1]) {
      cursor = point
      renderGhost()
    }
  })

  svg.addEventListener("pointerdown", (event) => {
    if (event.button === 1 || event.button === 2) {
      pan = { x: event.clientX, y: event.clientY, cam: { ...camera } }
      svg.setPointerCapture(event.pointerId)
      return
    }
    if (event.button !== 0 || !view) return
    const point = toGrid(event)
    if (mode.kind === "wire") return clickWire(point)
    if (mode.kind === "place") return placePart(point)
    const pick = pickAt(event)
    if (pick?.kind === "part") {
      const instance = view.doc.instances.find((i) => i.id === pick.id)
      if (instance?.type === "push_button") {
        setButton(pick.id)
        return
      }
      const placement = view.doc.blueprint.placements.find((p) => p.id === pick.id)!
      drag = { id: pick.id, start: point, origin: [placement.x, placement.y], doc: doc(), moved: false }
      svg.setPointerCapture(event.pointerId)
    }
  })

  svg.addEventListener("pointerup", (event) => {
    if (pan) {
      pan = null
      return
    }
    if (pressedButton) {
      setButton(null)
      return
    }
    if (drag) {
      const { moved, id } = drag
      drag = null
      if (moved && view) {
        cb.onChange(doc(), true)
        select({ kind: "part", id })
        return
      }
      select({ kind: "part", id })
      toggleInput(id)
      return
    }
    if (mode.kind !== "idle") return
    const pick = pickAt(event)
    if (!pick) return select(null)
    if (pick.kind === "segment") select(pick)
    else if (pick.kind === "label") select({ kind: "part", id: pick.id })
  })

  svg.addEventListener("dblclick", (event) => {
    if (mode.kind === "wire") return finishWire()
    const pick = pickAt(event)
    if (pick?.kind === "label") startEditing(pick.id)
  })

  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault()
      const rect = svg.getBoundingClientRect()
      const mx = camera.x + (event.clientX - rect.left) / camera.scale
      const my = camera.y + (event.clientY - rect.top) / camera.scale
      const scale = Math.min(3, Math.max(0.4, camera.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))
      camera = { scale, x: mx - (event.clientX - rect.left) / scale, y: my - (event.clientY - rect.top) / scale }
      applyCamera()
    },
    { passive: false },
  )
  svg.addEventListener("contextmenu", (event) => event.preventDefault())

  let last = performance.now()
  let raf = 0
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    for (const p of particles) {
      p.t = (p.t + p.speed * dt * 3) % 1
      p.node.setAttribute("cx", String((p.from[0] + (p.to[0] - p.from[0]) * p.t) * GRID))
      p.node.setAttribute("cy", String((p.from[1] + (p.to[1] - p.from[1]) * p.t) * GRID))
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  function deleteSelection() {
    if (!selection || !view) return
    const d = doc()
    if (selection.kind === "segment") {
      d.blueprint.segments = d.blueprint.segments.filter((s) => s.id !== selection!.id)
    } else {
      const id = selection.id
      d.blueprint.placements = d.blueprint.placements.filter((p) => p.id !== id)
      if (!d.bench.placements.some((p) => p.id === id)) d.instances = d.instances.filter((i) => i.id !== id)
    }
    selection = null
    cb.onChange(d, true)
  }

  function setTool(next: BenchTool) {
    if (next === "wire") mode = { kind: "wire", points: [] }
    else if (typeof next === "object" && !catalog[next.place]?.isTool) mode = { kind: "place", type: next.place, value: next.value, id: next.id, rotation: 0 }
    else mode = { kind: "idle" }
    renderGhost()
    emitHint()
  }

  function handleKey(event: KeyboardEvent): boolean {
    const k = event.key
    if (k === "Escape") {
      if (mode.kind === "wire" && mode.points.length > 0) finishWire()
      else if (mode.kind !== "idle") {
        mode = { kind: "idle" }
        cb.onEvent("toolReset")
        renderGhost()
        emitHint()
      } else select(null)
      return true
    }
    if ((k === "r" || k === "R") && mode.kind === "place") {
      mode = { ...mode, rotation: ((mode.rotation + 90) % 360) as Rotation }
      renderGhost()
      return true
    }
    if ((k === "r" || k === "R") && selection?.kind === "part" && view) {
      const d = doc()
      const placement = d.blueprint.placements.find((p) => p.id === selection!.id)
      if (!placement) return false
      placement.rotation = ((placement.rotation + 90) % 360) as Rotation
      cb.onChange(d, true)
      return true
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

  let framed = false

  return {
    element: svg,
    render(next: AppView, nextOpts: BlueprintRenderOpts) {
      view = next
      opts = nextOpts
      if (selection?.kind === "part" && !next.doc.blueprint.placements.some((p) => p.id === selection!.id)) selection = null
      if (selection?.kind === "segment" && !next.doc.blueprint.segments.some((s) => s.id === selection!.id)) selection = null
      if (!framed) {
        framed = true
        frame()
      }
      renderAll()
    },
    setTool,
    handleKey,
    frame,
    setLockedIds(ids: string[]) {
      lockedIds = new Set(ids)
    },
    activate() {
      applyCamera()
      emitHint()
    },
    dispose() {
      cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      svg.remove()
      labelInput.remove()
    },
  }
}

export type BlueprintView = ReturnType<typeof createBlueprint>
