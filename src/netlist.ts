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
