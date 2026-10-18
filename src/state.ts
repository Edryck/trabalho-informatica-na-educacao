import type { HoleId, Netlist } from "./netlist"
import type { SolveResult } from "./solver"

export type Instance = { id: string; type: string; value: number; actualValue: number; fault?: "open" | "short"; inputState?: string; variant?: string }
export type BlueprintPlacement = { id: string; x: number; y: number; rotation: 0 | 90 | 180 | 270 }
export type BlueprintSegment = { id: string; x1: number; y1: number; x2: number; y2: number }
export type BenchPlacement = { id: string; holes: Record<string, HoleId | null>; rotation: 0 | 90 | 180 | 270; offboard?: { x: number; z: number } }
export type Wire = { id: string; a: HoleId; b: HoleId; color: string }
export type Meter = { mode: "off" | "V" | "A" | "ohm"; red: HoleId | null; black: HoleId | null }
export type CircuitDoc = {
  version: 1
  instances: Instance[]
  blueprint: { placements: BlueprintPlacement[]; segments: BlueprintSegment[] }
  bench: { placements: BenchPlacement[]; wires: Wire[]; meter: Meter }
}

export function emptyDoc(): CircuitDoc {
  return {
    version: 1,
    instances: [],
    blueprint: { placements: [], segments: [] },
    bench: { placements: [], wires: [], meter: { mode: "off", red: null, black: null } },
  }
}

export const ID_PREFIX: Record<string, string> = {
  battery: "B",
  lamp: "L",
  switch: "S",
  push_button: "K",
  dc_motor: "M",
  buzzer: "Z",
  resistor: "R",
  led: "LED",
  logic_switch: "SW",
  logic_probe: "P",
}

export function prefixFor(type: string): string {
  if (type.startsWith("chip_")) return "U"
  return ID_PREFIX[type] ?? "X"
}

export function nextInstanceId(doc: CircuitDoc, prefix: string): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  const used = new Set<number>()
  for (const instance of doc.instances) {
    const match = pattern.exec(instance.id)
    if (match) used.add(Number(match[1]))
  }
  let n = 1
  while (used.has(n)) n++
  return `${prefix}${n}`
}

export type History = { snapshots: CircuitDoc[]; index: number; limit: number }

export function createHistory(doc: CircuitDoc, limit = 200): History {
  return { snapshots: [structuredClone(doc)], index: 0, limit }
}

export function pushSnapshot(h: History, doc: CircuitDoc): History {
  const snapshots = [...h.snapshots.slice(0, h.index + 1), structuredClone(doc)]
  const overflow = Math.max(0, snapshots.length - h.limit)
  const kept = snapshots.slice(overflow)
  return { snapshots: kept, index: kept.length - 1, limit: h.limit }
}

export function undo(h: History): History {
  return h.index > 0 ? { ...h, index: h.index - 1 } : h
}

export function redo(h: History): History {
  return h.index < h.snapshots.length - 1 ? { ...h, index: h.index + 1 } : h
}

export function rewindTo(h: History, index: number): History {
  return { ...h, index: Math.min(h.snapshots.length - 1, Math.max(0, index)) }
}

export function current(h: History): CircuitDoc {
  return structuredClone(h.snapshots[h.index])
}

export type AppView = {
  doc: CircuitDoc
  benchNet: Netlist
  benchResult: SolveResult
  blueprintNet: Netlist
  blueprintResult: SolveResult
}
