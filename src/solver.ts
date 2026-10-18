import type { Netlist, NetPart, PartDef, PartsCatalog, PinRef, PointId } from "./netlist"

export const LINK_RESISTANCE = 0.001
export const GMIN = 1e-12
export const BATTERY_RESISTANCE = 0.2
export const MAX_PASSES = 20
export const LED_OFF_CONDUCTANCE = 1e-9

export const INITIAL_DISCRETE: DiscreteState = { leds: {}, outputs: {} }

export type DiscreteState = { leds: Record<string, "on" | "off">; outputs: Record<PinRef, 0 | 1 | "z"> }

export type PartState =
  | { kind: "lamp" | "led"; lit: boolean; brightness: number }
  | { kind: "motor"; spinning: boolean; direction: 1 | -1 | 0 }
  | { kind: "buzzer"; sounding: boolean }
  | { kind: "logic"; outputs: Record<string, 0 | 1 | "undefined" | "hiz">; powered: boolean }
  | { kind: "probe"; level: 0 | 1 | "undefined" }
  | { kind: "passive" }

export type Warning = {
  kind: "overcurrent" | "shortCircuit" | "ammeterParallel" | "ohmmeterPowered" | "floatingInput" | "undefinedInput" | "unpoweredChip" | "unstable"
  partId?: string
  pin?: string
}

export type MeterReading = { mode: "V" | "A" | "ohm"; value: number | null; display: "value" | "OL" | "----" }

export type SolveResult = {
  status: "ok" | "unstable"
  voltages: Record<PointId, number>
  linkCurrent: Record<string, number>
  partCurrent: Record<string, number>
  partState: Record<string, PartState>
  meter?: MeterReading
  warnings: Warning[]
  discrete: DiscreteState
  passes: number
}

type Branch = { a: PointId; b: PointId; g: number; source: number }

type SolveOptions = { overrides?: Record<string, string>; previous?: DiscreteState }

const defaultInputState: Record<string, string> = { battery: "on", switch: "off", pushButton: "released" }

function sortedEntries<T>(rec: Record<string, T>): [string, T][] {
  return Object.entries(rec).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
}

function gaussianSolve(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row
    }
    if (pivot !== col) {
      ;[matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]]
      ;[rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]]
    }
    const p = matrix[col][col]
    if (p === 0) continue
    for (let row = col + 1; row < n; row++) {
      const factor = matrix[row][col] / p
      if (factor === 0) continue
      for (let k = col; k < n; k++) matrix[row][k] -= factor * matrix[col][k]
      rhs[row] -= factor * rhs[col]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row]
    for (let k = row + 1; k < n; k++) sum -= matrix[row][k] * x[k]
    x[row] = matrix[row][row] === 0 ? 0 : sum / matrix[row][row]
  }
  return x
}

function partBranches(part: NetPart, def: PartDef, state: string | undefined, pinAt: Record<PinRef, PointId>, ledOn: boolean): Branch[] {
  const pin = (name: string): PointId | undefined => pinAt[`${part.id}.${name}`]
  const branch = (pa: string, pb: string, g: number, source = 0): Branch[] => {
    const a = pin(pa)
    const b = pin(pb)
    return a === undefined || b === undefined ? [] : [{ a, b, g, source }]
  }
  const link = 1 / LINK_RESISTANCE
  if (part.fault === "open") return []
  if (part.fault === "short") return def.pins.length >= 2 ? branch(def.pins[0], def.pins[1], link) : []
  const model = def.model
  switch (model.kind) {
    case "battery":
      return state === "off" ? [] : branch("+", "-", 1 / BATTERY_RESISTANCE, part.value / BATTERY_RESISTANCE)
    case "resistor":
      return part.value > 0 ? branch(def.pins[0], def.pins[1], 1 / part.value) : []
    case "lamp":
    case "motor":
    case "buzzer":
      return branch(def.pins[0], def.pins[1], 1 / model.resistance)
    case "led":
      return ledOn ? branch("a", "k", 1 / model.rs, model.vf / model.rs) : branch("a", "k", LED_OFF_CONDUCTANCE)
    case "switch":
      return state === "on" ? branch("a", "b", link) : []
    case "pushButton":
      return [...branch("1", "2", link), ...branch("3", "4", link), ...(state === "pressed" ? branch("1", "3", link) : [])]
    default:
      return []
  }
}

export function solve(net: Netlist, catalog: PartsCatalog, opts: SolveOptions = {}): SolveResult {
  const points: PointId[] = []
  const seen = new Set<PointId>()
  const addPoint = (p: PointId) => {
    if (!seen.has(p)) {
      seen.add(p)
      points.push(p)
    }
  }
  for (const l of net.links) {
    addPoint(l.a)
    addPoint(l.b)
  }
  for (const p of Object.values(net.pinAt)) addPoint(p)

  const known = net.parts.filter((p) => catalog[p.type] !== undefined)
  const firstBattery = known.find((p) => catalog[p.type].model.kind === "battery")
  const reference = (firstBattery && net.pinAt[`${firstBattery.id}.-`]) ?? points[0]

  const index = new Map<PointId, number>()
  for (const p of points) if (p !== reference) index.set(p, index.size)

  const states = new Map<string, string | undefined>()
  for (const part of known) {
    const def = catalog[part.type]
    states.set(part.id, opts.overrides?.[part.id] ?? part.inputState ?? defaultInputState[def.model.kind])
  }
  const ledParts = known.filter((p) => catalog[p.type].model.kind === "led")
  const stateKey = (d: DiscreteState) =>
    JSON.stringify({ leds: sortedEntries(d.leds), outputs: sortedEntries(d.outputs) })

  const runPass = (discrete: DiscreteState) => {
    const partBranchList = new Map<string, Branch[]>()
    for (const part of known) {
      const ledOn = discrete.leds[part.id] === "on"
      partBranchList.set(part.id, partBranches(part, catalog[part.type], states.get(part.id), net.pinAt, ledOn))
    }
    const linkG = 1 / LINK_RESISTANCE
    const all: Branch[] = [...net.links.map((l) => ({ a: l.a, b: l.b, g: linkG, source: 0 }))]
    for (const list of partBranchList.values()) all.push(...list)

    const n = index.size
    const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
    const rhs = new Array<number>(n).fill(0)
    for (let i = 0; i < n; i++) matrix[i][i] += GMIN
    for (const br of all) {
      const ia = index.get(br.a)
      const ib = index.get(br.b)
      if (ia !== undefined) {
        matrix[ia][ia] += br.g
        rhs[ia] += br.source
      }
      if (ib !== undefined) {
        matrix[ib][ib] += br.g
        rhs[ib] -= br.source
      }
      if (ia !== undefined && ib !== undefined) {
        matrix[ia][ib] -= br.g
        matrix[ib][ia] -= br.g
      }
    }
    const solution = gaussianSolve(matrix, rhs)
    const voltages: Record<PointId, number> = {}
    // soma 0 pra não devolver -0, que quebra comparação estrita
    for (const p of points) voltages[p] = (p === reference ? 0 : solution[index.get(p) as number]) + 0
    return { partBranchList, voltages }
  }
  const current = (br: Branch, voltages: Record<PointId, number>) => br.g * (voltages[br.a] - voltages[br.b]) - br.source

  const reevaluate = (discrete: DiscreteState, run: ReturnType<typeof runPass>): DiscreteState => {
    const leds: Record<string, "on" | "off"> = {}
    for (const part of ledParts) {
      const br = run.partBranchList.get(part.id)?.[0]
      const model = catalog[part.type].model
      if (part.fault !== undefined || br === undefined || model.kind !== "led") {
        leds[part.id] = "off"
      } else if (discrete.leds[part.id] === "on") {
        leds[part.id] = current(br, run.voltages) <= 0 ? "off" : "on"
      } else {
        leds[part.id] = run.voltages[br.a] - run.voltages[br.b] > model.vf ? "on" : "off"
      }
    }
    return { leds, outputs: discrete.outputs }
  }

  const start = opts.previous ?? INITIAL_DISCRETE
  let discrete: DiscreteState = {
    leds: Object.fromEntries(ledParts.map((p) => [p.id, start.leds[p.id] === "on" && p.fault === undefined ? "on" : "off"])),
    outputs: start.outputs,
  }
  const visited = new Set<string>([stateKey(discrete)])
  let status: SolveResult["status"] = "unstable"
  let passes = 0
  let run = runPass(discrete)
  for (passes = 1; passes <= MAX_PASSES; passes++) {
    if (passes > 1) run = runPass(discrete)
    const next = reevaluate(discrete, run)
    const key = stateKey(next)
    if (key === stateKey(discrete)) {
      status = "ok"
      break
    }
    if (visited.has(key)) break
    visited.add(key)
    discrete = next
  }
  passes = Math.min(passes, MAX_PASSES)
  const { partBranchList, voltages } = run

  const linkG = 1 / LINK_RESISTANCE
  const linkCurrent: Record<string, number> = {}
  for (const l of net.links) linkCurrent[l.id] = linkG * (voltages[l.a] - voltages[l.b])

  const partCurrent: Record<string, number> = {}
  const partState: Record<string, PartState> = {}
  const warnings: Warning[] = []
  for (const part of known) {
    const def = catalog[part.type]
    const model = def.model
    const branches = partBranchList.get(part.id) ?? []
    // peça com defeito: o curto desvia do filamento/bobina, então a peça em si não conduz
    const bypassed = part.fault !== undefined && model.kind !== "switch" && model.kind !== "resistor"
    const i = branches.length > 0 && !bypassed ? current(branches[0], voltages) : 0
    const thresholds = def.thresholds ?? {}
    switch (model.kind) {
      case "battery": {
        const out = -i
        partCurrent[part.id] = out
        if (thresholds.shortCurrent !== undefined && Math.abs(out) > thresholds.shortCurrent) {
          warnings.push({ kind: "shortCircuit", partId: part.id })
        }
        break
      }
      case "resistor":
        partCurrent[part.id] = i
        break
      case "led": {
        partCurrent[part.id] = i
        const lit = i > (thresholds.lit ?? Infinity)
        partState[part.id] = { kind: "led", lit, brightness: lit ? Math.min(1, i / (thresholds.nominal ?? Infinity)) : 0 }
        break
      }
      case "switch":
        if (branches.length > 0) partCurrent[part.id] = i
        break
      case "lamp":
        partCurrent[part.id] = i
        partState[part.id] = {
          kind: "lamp",
          lit: Math.abs(i) > (thresholds.lit ?? Infinity),
          brightness: Math.min(1, (i * i * model.resistance) / model.nominalPower),
        }
        break
      case "motor": {
        partCurrent[part.id] = i
        const spinning = Math.abs(i) > (thresholds.spin ?? Infinity)
        partState[part.id] = { kind: "motor", spinning, direction: spinning ? (i > 0 ? 1 : -1) : 0 }
        break
      }
      case "buzzer":
        partCurrent[part.id] = i
        partState[part.id] = { kind: "buzzer", sounding: i > (thresholds.sound ?? Infinity) }
        break
    }
    if (!partState[part.id]) partState[part.id] = { kind: "passive" }
    if (thresholds.maxCurrent !== undefined && Math.abs(i) > thresholds.maxCurrent) {
      warnings.push({ kind: "overcurrent", partId: part.id })
    }
  }

  if (status === "unstable") warnings.push({ kind: "unstable" })

  return {
    status,
    voltages,
    linkCurrent,
    partCurrent,
    partState,
    warnings,
    discrete,
    passes,
  }
}
