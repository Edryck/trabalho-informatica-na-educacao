import type { HoleId } from "./netlist"

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
