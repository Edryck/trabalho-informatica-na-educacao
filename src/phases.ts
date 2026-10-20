import { benchToNetlist, blueprintToNetlist, compare, type Divergence, type Netlist, type PartsCatalog } from "./netlist"
import { DEFAULT_INPUT_STATE, solve, type PartState, type SolveResult } from "./solver"
import type { CircuitDoc } from "./state"
import { evaluateStars } from "./game"

export type ThenValue = string | { current?: [number, number]; voltage?: [number, number] }
export type Scenario = { when: Record<string, string>; then: Record<string, ThenValue> }
export type TutorialEvent =
  | "viewSwitched"
  | "cameraOrbited"
  | "holeHovered"
  | "partPlaced"
  | "wireDrawn"
  | "currentViewToggled"
  | "meterPlaced"
  | "meterReadVoltage"
  | "meterReadCurrent"
  | "datasheetOpened"
export type Step = { text: string; until: { event: TutorialEvent } | { expect: Scenario[] } }
export type PhaseType = "tutorial" | "build" | "repair" | "order"
export type Star =
  | { kind: "solved" }
  | { kind: "noDivergence" }
  | { kind: "usedMeter"; mode: "V" | "A" | "ohm" }
  | { kind: "maxCost"; value: number }
  | { kind: "maxWires"; value: number }
export type Phase = {
  id: string
  type: PhaseType
  goal: string
  brief: string
  tray: Record<string, number>
  trayValues?: Record<string, number[]>
  keyParts: { id: string; part: string }[]
  expect: Scenario[]
  evaluateOn: "bench" | "blueprint"
  requireMatch: boolean
  showDivergence: boolean
  budget: number | null
  initial: CircuitDoc | null
  steps: Step[] | null
  stars: Star[]
  hints: string[]
  referenceSolution: CircuitDoc | null
}
export type Group = { id: string; title: string; demo: boolean; concept: string; unlocks: string[]; phases: Phase[] }
export type PhaseData = { groups: Group[]; future: string[] }
export type Failure = { partId: string; reason: "missing" | "state" | "range" | "unstable" | "undefinedInput" }
export type ScenarioResult = { when: Record<string, string>; ok: boolean; isCurrent: boolean; failures: Failure[]; result: SolveResult }
export type Evaluation = {
  scenarios: ScenarioResult[]
  divergences: Divergence[]
  cost: number
  budgetOk: boolean
  matchOk: boolean
  won: boolean
}

export const FEATURES = ["current_view", "multimeter", "burn_enabled", "breadboard", "jumper_wire"] as const

const HINT_CHANGES = 15
const HINT_MS = 180_000

type RawPhase = Partial<Phase> & { id: string; type: PhaseType; goal: string }
type RawGroup = Omit<Group, "phases"> & { phases: RawPhase[] }

function fillPhase(raw: RawPhase): Phase {
  const requireMatch = raw.requireMatch ?? true
  return {
    brief: raw.goal,
    tray: {},
    keyParts: [],
    expect: [],
    evaluateOn: "bench",
    requireMatch,
    showDivergence: requireMatch,
    budget: null,
    initial: null,
    steps: null,
    hints: [],
    referenceSolution: null,
    stars: [{ kind: "solved" }],
    ...raw,
  }
}

export function loadPhases(raw: unknown): PhaseData {
  const data = raw as { groups?: RawGroup[]; future?: string[] }
  const groups = (data.groups ?? []).map((g) => ({
    ...g,
    phases: g.phases.filter((p) => g.demo || (p.expect?.length ?? 0) > 0).map(fillPhase),
  }))
  return { groups, future: data.future ?? [] }
}

function stateMatches(state: PartState, expected: string): boolean {
  switch (state.kind) {
    case "lamp":
    case "led":
      return expected === "lit" ? state.lit : expected === "off" ? !state.lit : false
    case "motor":
      if (expected === "spinning") return state.spinning
      if (expected === "cw") return state.spinning && state.direction === 1
      if (expected === "ccw") return state.spinning && state.direction === -1
      return expected === "off" ? !state.spinning : false
    case "buzzer":
      return expected === "sounding" ? state.sounding : expected === "off" ? !state.sounding : false
    case "probe":
      return String(state.level) === expected
    default:
      return false
  }
}

function within(value: number | undefined, range: [number, number]): boolean {
  return value !== undefined && value >= range[0] && value <= range[1]
}

function voltageAcross(net: Netlist, result: SolveResult, id: string, catalog: PartsCatalog): number | undefined {
  const part = net.parts.find((p) => p.id === id)
  const pins = part ? catalog[part.type]?.pins : undefined
  if (!pins || pins.length < 2) return undefined
  const a = result.voltages[net.pinAt[`${id}.${pins[0]}`]]
  const b = result.voltages[net.pinAt[`${id}.${pins[1]}`]]
  return a === undefined || b === undefined ? undefined : a - b
}

function currentInput(net: Netlist, catalog: PartsCatalog, id: string): string | undefined {
  const part = net.parts.find((p) => p.id === id)
  if (!part) return undefined
  return part.inputState ?? DEFAULT_INPUT_STATE[catalog[part.type]?.model.kind ?? ""]
}

export function evaluateScenarios(scenarios: Scenario[], net: Netlist, catalog: PartsCatalog): ScenarioResult[] {
  const present = new Set(net.parts.map((p) => p.id))
  return scenarios.map((scenario) => {
    const result = solve(net, catalog, { overrides: scenario.when })
    const failures: Failure[] = []
    for (const [id, expected] of Object.entries(scenario.then)) {
      if (!present.has(id)) {
        failures.push({ partId: id, reason: "missing" })
        continue
      }
      if (result.status === "unstable") {
        failures.push({ partId: id, reason: "unstable" })
        continue
      }
      if (typeof expected === "string") {
        const state = result.partState[id]
        if (!state || !stateMatches(state, expected)) failures.push({ partId: id, reason: "state" })
        continue
      }
      const currentOk = !expected.current || within(result.partCurrent[id], expected.current)
      const voltageOk = !expected.voltage || within(voltageAcross(net, result, id, catalog), expected.voltage)
      if (!currentOk || !voltageOk) failures.push({ partId: id, reason: "range" })
    }
    // CI com entrada solta pode até dar o resultado certo por acaso; isso não conta como solução
    for (const w of result.warnings) {
      if ((w.kind === "floatingInput" || w.kind === "undefinedInput") && w.partId) failures.push({ partId: w.partId, reason: "undefinedInput" })
    }
    const isCurrent = Object.entries(scenario.when).every(([id, value]) => currentInput(net, catalog, id) === value)
    return { when: scenario.when, ok: failures.length === 0, isCurrent, failures, result }
  })
}

export function docCost(doc: CircuitDoc, catalog: PartsCatalog, side: "bench" | "blueprint"): number {
  const placed = new Set((side === "bench" ? doc.bench.placements : doc.blueprint.placements).map((p) => p.id))
  return doc.instances.filter((i) => placed.has(i.id)).reduce((sum, i) => sum + (catalog[i.type]?.cost ?? 0), 0)
}

export function referenceCost(phase: Phase, catalog: PartsCatalog): number | null {
  return phase.referenceSolution ? docCost(phase.referenceSolution, catalog, phase.evaluateOn) : null
}

export function evaluate(phase: Phase, doc: CircuitDoc, catalog: PartsCatalog): Evaluation {
  const benchNet = benchToNetlist(doc, catalog)
  const blueprintNet = blueprintToNetlist(doc, catalog)
  const net = phase.evaluateOn === "bench" ? benchNet : blueprintNet
  const scenarios = evaluateScenarios(phase.expect, net, catalog)
  const divergences = compare(blueprintNet, benchNet, catalog)
  const matchOk = !phase.requireMatch || divergences.length === 0
  const cost = docCost(doc, catalog, phase.evaluateOn)
  const budgetOk = phase.budget === null || cost <= phase.budget
  const won = phase.expect.length > 0 && scenarios.every((s) => s.ok) && matchOk && budgetOk
  return { scenarios, divergences, cost, budgetOk, matchOk, won }
}

export function shouldOfferHint(changes: number, elapsedMs: number, opened: number, total: number): boolean {
  return opened < total && (changes >= HINT_CHANGES || elapsedMs >= HINT_MS)
}

export function phaseOrder(data: PhaseData): string[] {
  return data.groups.flatMap((g) => g.phases.map((p) => p.id))
}

export function isPhaseAvailable(data: PhaseData, won: Set<string>, phaseId: string): boolean {
  const order = phaseOrder(data)
  const index = order.indexOf(phaseId)
  if (index < 0) return false
  return index === 0 || won.has(order[index - 1])
}

export function findPhase(data: PhaseData, phaseId: string): Phase | undefined {
  return data.groups.flatMap((g) => g.phases).find((p) => p.id === phaseId)
}

export function validatePhases(data: PhaseData, catalog: PartsCatalog, datasheets: Record<string, unknown>): string[] {
  const errors: string[] = []
  const groupIds = new Set<string>()
  const phaseIds = new Set<string>()
  for (const [key, def] of Object.entries(catalog)) {
    if (def.datasheet && !(def.datasheet in datasheets)) errors.push(`peça ${key}: datasheet "${def.datasheet}" não existe`)
  }
  for (const group of data.groups) {
    if (groupIds.has(group.id)) errors.push(`grupo duplicado: ${group.id}`)
    groupIds.add(group.id)
    for (const unlock of group.demo ? group.unlocks : []) {
      if (!(unlock in catalog) && !(FEATURES as readonly string[]).includes(unlock)) errors.push(`grupo ${group.id}: unlock "${unlock}" não existe`)
    }
    for (const phase of group.phases) {
      const where = `fase ${phase.id}`
      if (phaseIds.has(phase.id)) errors.push(`fase duplicada: ${phase.id}`)
      phaseIds.add(phase.id)
      for (const type of [...Object.keys(phase.tray), ...Object.keys(phase.trayValues ?? {})]) {
        if (!(type in catalog)) errors.push(`${where}: peça "${type}" da bandeja não existe`)
      }
      const initialIds = new Set(phase.initial?.instances.map((i) => i.id) ?? [])
      for (const key of phase.keyParts) {
        if (!(key.part in catalog)) errors.push(`${where}: peça-chave ${key.id} tem tipo "${key.part}" inexistente`)
        if (!initialIds.has(key.id) && !(phase.tray[key.part] > 0)) errors.push(`${where}: peça-chave ${key.id} não está na bandeja nem no circuito inicial`)
      }
      if (!group.demo) continue
      if (phase.expect.length === 0 && (phase.steps?.length ?? 0) === 0) errors.push(`${where}: sem estado esperado nem passos`)
      if (phase.type !== "tutorial" && !phase.referenceSolution) errors.push(`${where}: sem solução de referência`)
      errors.push(...validateStars(phase, data, group.id, catalog))
    }
  }
  return errors
}

function validateStars(phase: Phase, data: PhaseData, groupId: string, catalog: PartsCatalog): string[] {
  const where = `fase ${phase.id}`
  const errors: string[] = []
  if (phase.stars.length !== 3) errors.push(`${where}: precisa de 3 estrelas`)
  if (phase.stars[0]?.kind !== "solved") errors.push(`${where}: a primeira estrela tem que ser solved`)
  const groupIndex = data.groups.findIndex((g) => g.id === groupId)
  const meterIndex = data.groups.findIndex((g) => g.unlocks.includes("multimeter"))
  const meterSteps = (phase.steps ?? []).some((s) => "event" in s.until && s.until.event.startsWith("meterRead"))
  for (const star of phase.stars) {
    if (star.kind === "usedMeter" && (meterIndex < 0 || groupIndex < meterIndex)) errors.push(`${where}: usedMeter antes de liberar o multímetro`)
    if (star.kind === "usedMeter" && meterSteps) errors.push(`${where}: usedMeter repete um passo obrigatório do tutorial`)
    if (star.kind === "noDivergence" && phase.requireMatch) errors.push(`${where}: noDivergence em fase que já exige esquema igual`)
  }
  const doc = phase.referenceSolution ?? phase.initial
  if (doc && errors.length === 0) {
    const e = evaluate(phase, doc, catalog)
    const earned = evaluateStars(phase.stars, { won: true, evaluation: e, doc, side: phase.evaluateOn, meterModesUsed: ["V", "A", "ohm"] })
    phase.stars.forEach((star, i) => {
      if (!earned[i]) errors.push(`${where}: a solução de referência não cumpre a estrela ${star.kind}`)
    })
  }
  return errors
}
