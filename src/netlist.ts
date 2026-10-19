import type { CircuitDoc, Instance } from "./state"

export type HoleId = string
export type PointId = string
export type PinRef = string

export type PartModel =
  | { kind: "battery" }
  | { kind: "resistor" }
  | { kind: "lamp"; resistance: number; nominalPower: number }
  | { kind: "motor"; resistance: number }
  | { kind: "buzzer"; resistance: number }
  | { kind: "led"; vf: number; rs: number }
  | { kind: "switch" }
  | { kind: "pushButton" }
  | { kind: "logicSwitch" }
  | { kind: "logicProbe" }
  | { kind: "logic"; fn: "and" | "or" | "nand" | "nor" | "xor" | "xnor" | "not"; gates: string[][] }
  | { kind: "multimeter" }

export type PartDef = {
  pins: string[]
  placement: "rigid" | "flexible" | "offboard"
  cost: number
  model: PartModel
  thresholds?: Record<string, number>
  values?: number[]
  variants?: string[]
  footprint?: [number, number][]
  symbolPins: Record<string, [number, number]>
  isTool?: boolean
  datasheet?: string
}

export type PartsCatalog = Record<string, PartDef>

export type NetPart = {
  id: string
  type: string
  value: number
  fault?: "open" | "short"
  inputState?: string
  isTool?: boolean
}

export type Link = { id: string; a: PointId; b: PointId; kind: "wire" | "strip" | "lead" }

export type Netlist = { parts: NetPart[]; links: Link[]; pinAt: Record<PinRef, PointId> }

export type Divergence = {
  kind: "pending" | "wiring" | "value"
  partId: string
  pin?: string
  power: boolean
  side?: "blueprint" | "bench"
  expected?: PinRef[]
  actual?: PinRef[]
  specValue?: number
  actualValue?: number
}

export function stripOf(hole: HoleId): string | null {
  const term = /^([A-J])([1-9]\d?)$/.exec(hole)
  if (term && Number(term[2]) <= 30) return `c${term[2]}-${term[1] <= "E" ? "top" : "bot"}`
  const rail = /^([TB][+-])([1-9]\d?)$/.exec(hole)
  if (rail && Number(rail[2]) <= 30) return `rail-${rail[1]}`
  return null
}

export function holeOrder(hole: HoleId): number {
  const term = /^([A-J])\d+$/.exec(hole)
  if (term) return term[1].charCodeAt(0) - 65
  const rail = /^[TB][+-](\d+)$/.exec(hole)
  return rail ? Number(rail[1]) : -1
}

function buildStripLinks(holes: Set<HoleId>): Link[] {
  const groups = new Map<string, HoleId[]>()
  for (const hole of holes) {
    const key = stripOf(hole)
    if (key === null) continue
    const list = groups.get(key) ?? []
    list.push(hole)
    groups.set(key, list)
  }
  const links: Link[] = []
  for (const list of groups.values()) {
    list.sort((p, q) => holeOrder(p) - holeOrder(q))
    for (let i = 1; i < list.length; i++) {
      links.push({ id: `s:${list[i - 1]}-${list[i]}`, a: `h:${list[i - 1]}`, b: `h:${list[i]}`, kind: "strip" })
    }
  }
  return links
}

export function benchToNetlist(doc: CircuitDoc, catalog: PartsCatalog): Netlist {
  const parts: NetPart[] = []
  const links: Link[] = []
  const pinAt: Record<PinRef, PointId> = {}
  const occupied = new Set<HoleId>()
  const byId = new Map(doc.instances.map((i) => [i.id, i]))

  for (const placement of doc.bench.placements) {
    const instance = byId.get(placement.id)
    const def = instance && catalog[instance.type]
    if (!instance || !def) continue
    parts.push(toNetPart(instance, instance.actualValue))
    for (const pin of def.pins) {
      const hole = placement.holes[pin] ?? null
      const ref = `${instance.id}.${pin}`
      if (hole !== null) occupied.add(hole)
      if (def.placement === "offboard") {
        pinAt[ref] = `p:${ref}`
        if (hole !== null) links.push({ id: `l:${ref}`, a: `p:${ref}`, b: `h:${hole}`, kind: "lead" })
      } else {
        pinAt[ref] = hole === null ? `p:${ref}` : `h:${hole}`
      }
    }
  }

  for (const wire of doc.bench.wires) {
    if (wire.a === wire.b) continue
    occupied.add(wire.a)
    occupied.add(wire.b)
    links.push({ id: `w:${wire.id}`, a: `h:${wire.a}`, b: `h:${wire.b}`, kind: "wire" })
  }

  const meter = doc.bench.meter
  if (meter.mode !== "off") {
    parts.push({ id: "METER", type: "multimeter", value: 0, inputState: meter.mode, isTool: true })
    for (const [pin, hole] of [["red", meter.red], ["black", meter.black]] as const) {
      const ref = `METER.${pin}`
      if (hole !== null) occupied.add(hole)
      pinAt[ref] = hole === null ? `p:${ref}` : `h:${hole}`
    }
  }

  links.push(...buildStripLinks(occupied))
  return { parts, links, pinAt }
}

function toNetPart(instance: Instance, value: number): NetPart {
  const part: NetPart = { id: instance.id, type: instance.type, value }
  if (instance.fault) part.fault = instance.fault
  if (instance.inputState !== undefined) part.inputState = instance.inputState
  return part
}

type Segment = { x1: number; y1: number; x2: number; y2: number }

function rotate([x, y]: [number, number], rotation: 0 | 90 | 180 | 270): [number, number] {
  if (rotation === 90) return [-y, x]
  if (rotation === 180) return [-x, -y]
  if (rotation === 270) return [y, -x]
  return [x, y]
}

function normalize(s: Segment): Segment {
  const flip = s.x1 > s.x2 || (s.x1 === s.x2 && s.y1 > s.y2)
  return flip ? { x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 } : s
}

function mergeCollinear(segments: Segment[]): Segment[] {
  const axis = segments.filter((s) => s.x1 === s.x2 || s.y1 === s.y2)
  const other = segments.filter((s) => s.x1 !== s.x2 && s.y1 !== s.y2)
  const result: Segment[] = [...other]
  const lines = new Map<string, Segment[]>()
  for (const s of axis) {
    const key = s.y1 === s.y2 ? `h${s.y1}` : `v${s.x1}`
    const list = lines.get(key) ?? []
    list.push(s)
    lines.set(key, list)
  }
  for (const [key, list] of lines) {
    const horizontal = key[0] === "h"
    const start = (s: Segment) => (horizontal ? s.x1 : s.y1)
    const end = (s: Segment) => (horizontal ? s.x2 : s.y2)
    list.sort((p, q) => start(p) - start(q))
    let current = { ...list[0] }
    for (const s of list.slice(1)) {
      if (start(s) <= end(current)) {
        if (end(s) > end(current)) {
          if (horizontal) current.x2 = s.x2
          else current.y2 = s.y2
        }
      } else {
        result.push(current)
        current = { ...s }
      }
    }
    result.push(current)
  }
  return result
}

function onSegment(s: Segment, x: number, y: number): boolean {
  const cross = (s.x2 - s.x1) * (y - s.y1) - (s.y2 - s.y1) * (x - s.x1)
  if (cross !== 0) return false
  return x >= Math.min(s.x1, s.x2) && x <= Math.max(s.x1, s.x2) && y >= Math.min(s.y1, s.y2) && y <= Math.max(s.y1, s.y2)
}

export function blueprintToNetlist(doc: CircuitDoc, catalog: PartsCatalog): Netlist {
  const parts: NetPart[] = []
  const pinAt: Record<PinRef, PointId> = {}
  const nodes = new Map<string, [number, number]>()
  const byId = new Map(doc.instances.map((i) => [i.id, i]))

  for (const placement of doc.blueprint.placements) {
    const instance = byId.get(placement.id)
    const def = instance && catalog[instance.type]
    if (!instance || !def) continue
    parts.push(toNetPart(instance, instance.value))
    for (const pin of def.pins) {
      const [dx, dy] = rotate(def.symbolPins[pin], placement.rotation)
      const x = placement.x + dx
      const y = placement.y + dy
      pinAt[`${instance.id}.${pin}`] = `g:${x},${y}`
      nodes.set(`${x},${y}`, [x, y])
    }
  }

  const segments = mergeCollinear(
    doc.blueprint.segments
      .filter((s) => s.x1 !== s.x2 || s.y1 !== s.y2)
      .map((s) => normalize({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })),
  )
  for (const s of segments) {
    nodes.set(`${s.x1},${s.y1}`, [s.x1, s.y1])
    nodes.set(`${s.x2},${s.y2}`, [s.x2, s.y2])
  }

  const links = new Map<string, Link>()
  for (const s of segments) {
    const stops = [...nodes.values()].filter(([x, y]) => onSegment(s, x, y))
    stops.sort((p, q) => p[0] - q[0] || p[1] - q[1])
    for (let i = 1; i < stops.length; i++) {
      const [x1, y1] = stops[i - 1]
      const [x2, y2] = stops[i]
      const id = `w:${x1},${y1}-${x2},${y2}`
      links.set(id, { id, a: `g:${x1},${y1}`, b: `g:${x2},${y2}`, kind: "wire" })
    }
  }

  return { parts, links: [...links.values()], pinAt }
}

export function collapse(net: Netlist): Map<PinRef, string> {
  const parent = new Map<string, string>()
  const find = (p: string): string => {
    let root = p
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) as string
    let node = p
    while (node !== root) {
      const next = parent.get(node) as string
      parent.set(node, root)
      node = next
    }
    return root
  }
  for (const link of net.links) {
    const ra = find(link.a)
    const rb = find(link.b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const result = new Map<PinRef, string>()
  for (const [pin, point] of Object.entries(net.pinAt)) result.set(pin, find(point))
  return result
}

function neighborMap(net: Netlist, tools: Set<string>): Map<PinRef, PinRef[]> {
  const nodes = collapse(net)
  const byNode = new Map<string, PinRef[]>()
  for (const [pin, node] of nodes) {
    if (tools.has(pin.slice(0, pin.indexOf(".")))) continue
    byNode.set(node, [...(byNode.get(node) ?? []), pin])
  }
  const result = new Map<PinRef, PinRef[]>()
  for (const pins of byNode.values()) {
    for (const pin of pins) result.set(pin, pins.filter((p) => p !== pin).sort())
  }
  return result
}

const DIVERGENCE_ORDER: Record<Divergence["kind"], number> = { wiring: 0, value: 1, pending: 2 }

export function compare(blueprint: Netlist, bench: Netlist, catalog: PartsCatalog): Divergence[] {
  const tools = new Set([...blueprint.parts, ...bench.parts].filter((p) => p.isTool || catalog[p.type]?.isTool).map((p) => p.id))
  const bpParts = new Map(blueprint.parts.filter((p) => !tools.has(p.id)).map((p) => [p.id, p]))
  const benchParts = new Map(bench.parts.filter((p) => !tools.has(p.id)).map((p) => [p.id, p]))
  const typeOf = (id: string) => (bpParts.get(id) ?? benchParts.get(id))?.type
  const isPowerPin = (ref: PinRef) => {
    const dot = ref.indexOf(".")
    const pin = ref.slice(dot + 1)
    return catalog[typeOf(ref.slice(0, dot)) ?? ""]?.model.kind === "battery" || pin === "VCC" || pin === "GND"
  }

  const result: Divergence[] = []
  for (const [id, part] of bpParts) {
    if (!benchParts.has(id)) result.push({ kind: "pending", partId: id, power: catalog[part.type]?.model.kind === "battery", side: "bench" })
  }
  for (const [id, part] of benchParts) {
    if (!bpParts.has(id)) result.push({ kind: "pending", partId: id, power: catalog[part.type]?.model.kind === "battery", side: "blueprint" })
  }

  const expectedMap = neighborMap(blueprint, tools)
  const actualMap = neighborMap(bench, tools)
  const shared = [...bpParts.keys()].filter((id) => benchParts.has(id))
  const sharedSet = new Set(shared)
  const keep = (list: PinRef[]) => list.filter((ref) => sharedSet.has(ref.slice(0, ref.indexOf("."))))
  for (const id of shared) {
    for (const pin of catalog[bpParts.get(id)!.type]?.pins ?? []) {
      const ref = `${id}.${pin}`
      const expected = keep(expectedMap.get(ref) ?? [])
      const actual = keep(actualMap.get(ref) ?? [])
      if (expected.join("|") === actual.join("|")) continue
      const power = isPowerPin(ref) || [...expected, ...actual].some(isPowerPin)
      result.push({ kind: "wiring", partId: id, pin, power, expected, actual })
    }
    const spec = bpParts.get(id)!.value
    const real = benchParts.get(id)!.value
    if (spec !== real) result.push({ kind: "value", partId: id, power: false, specValue: spec, actualValue: real })
  }

  return result.sort(
    (a, b) =>
      Number(b.power) - Number(a.power) ||
      DIVERGENCE_ORDER[a.kind] - DIVERGENCE_ORDER[b.kind] ||
      a.partId.localeCompare(b.partId) ||
      (a.pin ?? "").localeCompare(b.pin ?? ""),
  )
}
