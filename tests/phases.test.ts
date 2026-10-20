import { describe, it, expect } from "vitest"
import parts from "../data/parts.json"
import type { PartsCatalog } from "../src/netlist"
import { docCost, evaluate, evaluateScenarios, isPhaseAvailable, loadPhases, phaseOrder, shouldOfferHint, type Phase } from "../src/phases"
import { benchToNetlist } from "../src/netlist"
import { emptyDoc, type CircuitDoc } from "../src/state"
import rewardsJson from "../data/rewards.json"
import { dailyRepair } from "../src/game"
import { TOUR_STEPS } from "../src/screens"
import { starLabel } from "../src/ui"

const catalog = parts as unknown as PartsCatalog

function phase(partial: Partial<Phase>): Phase {
  return loadPhases({ groups: [{ id: "g", title: "t", demo: true, concept: "", unlocks: [], phases: [{ id: "p", type: "build", goal: "x", ...partial }] }], future: [] }).groups[0].phases[0]
}

const switchLamp = phase({
  keyParts: [
    { id: "S1", part: "switch" },
    { id: "L1", part: "lamp" },
  ],
  expect: [
    { when: { S1: "on" }, then: { L1: "lit" } },
    { when: { S1: "off" }, then: { L1: "off" } },
  ],
  requireMatch: false,
})

function circuit(opts: { withSwitch?: boolean; extraSwitch?: string; lamps?: number; inputs?: Record<string, string>; blueprint?: boolean } = {}): CircuitDoc {
  const d = emptyDoc()
  const withSwitch = opts.withSwitch ?? true
  const lamps = opts.lamps ?? 1
  d.instances.push({ id: "B1", type: "battery", value: 9, actualValue: 9 })
  d.bench.placements.push({ id: "B1", rotation: 0, offboard: { x: -80, z: 0 }, holes: { "+": "A1", "-": "A30" } })
  let hole = 1
  const chain: { id: string; type: string; rigid: boolean }[] = []
  if (withSwitch) chain.push({ id: "S1", type: "switch", rigid: true })
  if (opts.extraSwitch) chain.push({ id: "S2", type: "switch", rigid: true })
  for (let i = 1; i <= lamps; i++) chain.push({ id: `L${i}`, type: "lamp", rigid: false })
  for (const part of chain) {
    d.instances.push({ id: part.id, type: part.type, value: 0, actualValue: 0, inputState: opts.inputs?.[part.id] ?? (part.id === "S2" ? opts.extraSwitch : undefined) })
    const a = `B${hole}`
    const b = part.rigid ? `B${hole + 2}` : `C${hole + 3}`
    d.bench.placements.push(
      part.rigid ? { id: part.id, rotation: 0, holes: { a, b } } : { id: part.id, rotation: 0, offboard: { x: hole * 10, z: -50 }, holes: { a, b } },
    )
    hole = part.rigid ? hole + 2 : hole + 3
  }
  d.bench.wires.push({ id: "W1", a: `D${hole}`, b: "D30", color: "#202020" })
  return d
}

describe("evaluate", () => {
  it("wins only when every scenario holds", () => {
    const e = evaluate(switchLamp, circuit(), catalog)
    expect(e.scenarios.map((s) => s.ok)).toEqual([true, true])
    expect(e.won).toBe(true)
  })

  it("direct wire passes one scenario but not the phase", () => {
    const d = circuit({ withSwitch: false })
    d.instances.push({ id: "S1", type: "switch", value: 0, actualValue: 0 })
    d.bench.placements.push({ id: "S1", rotation: 0, holes: { a: "H10", b: "H12" } })
    const e = evaluate(switchLamp, d, catalog)
    expect(e.scenarios.find((s) => s.when.S1 === "off")!.ok).toBe(false)
    expect(e.scenarios.find((s) => s.when.S1 === "on")!.ok).toBe(true)
    expect(e.won).toBe(false)
  })

  it("missing key part fails with reason missing", () => {
    const d = circuit()
    d.instances = d.instances.filter((i) => i.id !== "L1")
    d.bench.placements = d.bench.placements.filter((p) => p.id !== "L1")
    const e = evaluate(switchLamp, d, catalog)
    expect(e.scenarios[0].failures).toContainEqual({ partId: "L1", reason: "missing" })
    expect(e.won).toBe(false)
  })

  it("key part only on the blueprint counts as missing on the bench", () => {
    const d = circuit()
    d.bench.placements = d.bench.placements.filter((p) => p.id !== "L1")
    d.blueprint.placements.push({ id: "L1", x: 0, y: 0, rotation: 0 })
    expect(evaluate(switchLamp, d, catalog).scenarios[0].failures).toContainEqual({ partId: "L1", reason: "missing" })
  })

  it("scenario ignores previous discrete state", () => {
    const first = evaluate(switchLamp, circuit(), catalog)
    const second = evaluate(switchLamp, circuit(), catalog)
    expect(first.scenarios.map((s) => s.ok)).toEqual(second.scenarios.map((s) => s.ok))
    const net = benchToNetlist(circuit(), catalog)
    const results = evaluateScenarios(switchLamp.expect, net, catalog)
    expect(results.every((r) => r.result.passes >= 1)).toBe(true)
  })

  it("non key inputs stay frozen", () => {
    expect(evaluate(switchLamp, circuit({ extraSwitch: "off" }), catalog).won).toBe(false)
    expect(evaluate(switchLamp, circuit({ extraSwitch: "on" }), catalog).won).toBe(true)
  })

  it("marks the live row", () => {
    const e = evaluate(switchLamp, circuit({ inputs: { S1: "on" } }), catalog)
    expect(e.scenarios.map((s) => s.isCurrent)).toEqual([true, false])
    const off = evaluate(switchLamp, circuit(), catalog)
    expect(off.scenarios.map((s) => s.isCurrent)).toEqual([false, true])
  })

  it("checks numeric ranges", () => {
    const series = phase({ expect: [{ when: {}, then: { L1: { current: [0.03, 0.07] } } }], requireMatch: false })
    expect(evaluate(series, circuit({ withSwitch: false, lamps: 2 }), catalog).won).toBe(true)
    expect(evaluate(series, circuit({ withSwitch: false, lamps: 1 }), catalog).won).toBe(false)
  })

  it("requireMatch blocks win on divergence", () => {
    const strict = { ...switchLamp, requireMatch: true }
    const e = evaluate(strict, circuit({ inputs: { S1: "on" } }), catalog)
    expect(e.divergences.length).toBeGreaterThan(0)
    expect(e.matchOk).toBe(false)
    expect(e.won).toBe(false)
    expect(evaluate(switchLamp, circuit(), catalog).won).toBe(true)
  })

  it("budget blocks win", () => {
    const tight = { ...switchLamp, budget: 3 }
    const e = evaluate(tight, circuit(), catalog)
    expect(e.cost).toBe(5)
    expect(e.budgetOk).toBe(false)
    expect(e.won).toBe(false)
  })

  it("docCost counts only the evaluated side", () => {
    const d = circuit()
    expect(docCost(d, catalog, "bench")).toBe(5)
    expect(docCost(d, catalog, "blueprint")).toBe(0)
  })

  it("a phase with no expected state never wins by evaluation", () => {
    const e = evaluate(phase({ expect: [], requireMatch: false }), circuit(), catalog)
    expect(e.won).toBe(false)
  })
})

describe("loadPhases", () => {
  it("fills defaults and drops future phases without expect", () => {
    const data = loadPhases({
      groups: [
        { id: "g0", title: "a", demo: true, concept: "", unlocks: [], phases: [{ id: "g0p1", type: "tutorial", goal: "olhar" }] },
        { id: "g9", title: "b", demo: false, concept: "", unlocks: [], phases: [{ id: "g9p1", type: "build", goal: "depois" }] },
      ],
      future: ["diode"],
    })
    const p = data.groups[0].phases[0]
    expect(p).toMatchObject({ brief: "olhar", tray: {}, keyParts: [], expect: [], evaluateOn: "bench", requireMatch: true, showDivergence: true, budget: null, initial: null, steps: null, hints: [], referenceSolution: null })
    expect(data.groups[1].phases).toEqual([])
    expect(data.future).toEqual(["diode"])
  })
})

describe("hints and progression", () => {
  it("offers hints by thresholds", () => {
    expect(shouldOfferHint(14, 0, 0, 2)).toBe(false)
    expect(shouldOfferHint(15, 0, 0, 2)).toBe(true)
    expect(shouldOfferHint(0, 180000, 0, 2)).toBe(true)
    expect(shouldOfferHint(99, 999999, 2, 2)).toBe(false)
  })

  it("availability is linear", () => {
    const data = loadPhases({
      groups: [
        { id: "a", title: "a", demo: true, concept: "", unlocks: [], phases: [{ id: "a1", type: "build", goal: "" }, { id: "a2", type: "build", goal: "" }] },
        { id: "b", title: "b", demo: true, concept: "", unlocks: [], phases: [{ id: "b1", type: "build", goal: "" }] },
      ],
      future: [],
    })
    expect(phaseOrder(data)).toEqual(["a1", "a2", "b1"])
    expect(isPhaseAvailable(data, new Set(), "a1")).toBe(true)
    expect(isPhaseAvailable(data, new Set(), "a2")).toBe(false)
    expect(isPhaseAvailable(data, new Set(["a1", "a2"]), "b1")).toBe(true)
  })
})

import phasesRaw from "../data/phases.json"
import datasheets from "../data/datasheets.json"
import { findPhase, referenceCost, validatePhases } from "../src/phases"

describe("shipped data", () => {
  const data = loadPhases(phasesRaw)

  it("is consistent", () => {
    expect(validatePhases(data, catalog, datasheets)).toEqual([])
  })

  it("validator catches duplicate ids and missing key parts", () => {
    const broken = loadPhases({
      groups: [
        {
          id: "x",
          title: "x",
          demo: true,
          concept: "",
          unlocks: ["flux_capacitor"],
          phases: [
            { id: "x1", type: "build", goal: "", keyParts: [{ id: "L1", part: "lamp" }], expect: [{ when: {}, then: { L1: "lit" } }] },
            { id: "x1", type: "build", goal: "", tray: { warp_core: 1 } },
          ],
        },
      ],
      future: [],
    })
    expect(validatePhases(broken, catalog, datasheets).length).toBeGreaterThanOrEqual(4)
  })

  describe("reference solutions win", () => {
    for (const g of data.groups.filter((g) => g.demo))
      for (const p of g.phases.filter((p) => p.referenceSolution))
        it(p.id, () => {
          const e = evaluate(p, p.referenceSolution!, catalog)
          expect(e.scenarios.filter((s) => !s.ok).map((s) => ({ when: s.when, failures: s.failures }))).toEqual([])
          expect(e.divergences).toEqual(p.requireMatch ? [] : e.divergences)
          expect(e.won).toBe(true)
          expect(referenceCost(p, catalog)).toBeGreaterThan(0)
        })
  })

  it("budget phases have a reachable reference", () => {
    for (const p of data.groups.flatMap((g) => g.phases).filter((p) => p.budget !== null && p.referenceSolution))
      expect(referenceCost(p, catalog)!).toBeLessThanOrEqual(p.budget!)
  })

  it("repair phases start broken", () => {
    for (const p of data.groups.filter((g) => g.demo).flatMap((g) => g.phases).filter((p) => p.type === "repair" && p.initial))
      expect(evaluate(p, p.initial!, catalog).won, p.id).toBe(false)
  })

  it("finds phases by id", () => {
    expect(findPhase(data, "g0p1")?.type).toBe("tutorial")
  })
})

describe("divergence defaults", () => {
  it("hides divergence markers when the phase does not require a match", () => {
    expect(phase({ requireMatch: false }).showDivergence).toBe(false)
    expect(phase({}).showDivergence).toBe(true)
    expect(phase({ requireMatch: true, showDivergence: false }).showDivergence).toBe(false)
  })
})

describe("game copy", () => {
  const data = loadPhases(phasesRaw)
  const demo = data.groups.filter((g) => g.demo).flatMap((g) => g.phases)
  const sheets = datasheets as unknown as Record<string, { title: string; does: string; values: [string, string][]; breadboard: string; mistake: string }>
  const daily = dailyRepair("2026-11-03", data, new Set(demo.map((p) => p.id)), catalog)
  const allCopy = () => [
    ...demo.flatMap((p) => [p.brief, ...p.hints, ...(p.steps ?? []).map((s) => s.text)]),
    ...Object.values(sheets).flatMap((d) => [d.title, d.does, d.breadboard, d.mistake, ...d.values.flat()]),
    ...TOUR_STEPS.flatMap((step) => [step.title, step.text]),
    ...demo.flatMap((p) => p.stars.map(starLabel)),
    ...(daily ? [daily.brief, ...daily.hints] : []),
    ...rewardsJson.items.map((item) => item.name),
  ]

  it("covers the new game copy", () => {
    expect(daily).not.toBeNull()
    expect(allCopy().length).toBeGreaterThan(demo.length * 3)
  })
  const banned = [/queimad/i, /ótima pergunta/i, /vamos mergulhar/i, /\p{Extended_Pictographic}/u, /parabéns!/i]

  it("avoids banned patterns", () => {
    for (const text of allCopy()) {
      for (const re of banned) expect(text, text).not.toMatch(re)
      expect((text.match(/—/g) ?? []).length, text).toBeLessThanOrEqual(1)
    }
  })

  it("every demo build, repair and order phase has at least two hints", () => {
    for (const p of demo.filter((p) => p.type !== "tutorial")) expect(p.hints.length, p.id).toBeGreaterThanOrEqual(2)
  })

  it("every datasheet section is filled", () => {
    for (const key of Object.keys(catalog)) {
      const d = sheets[catalog[key].datasheet ?? key]
      expect(d, key).toBeDefined()
      for (const field of ["title", "does", "breadboard", "mistake"] as const) expect(d[field], `${key}.${field}`).not.toBe("")
      expect(d.values.length, `${key}.values`).toBeGreaterThan(0)
    }
  })

  it("every demo brief is filled and different from the goal", () => {
    for (const p of demo) expect(p.brief, p.id).not.toBe(p.goal)
  })
})

describe("logic references need their ground wires", () => {
  const data = loadPhases(phasesRaw)
  const logic = data.groups.filter((g) => g.id === "g2").flatMap((g) => g.phases).filter((p) => p.referenceSolution)
  for (const p of logic)
    it(`${p.id} loses without any single ground wire`, () => {
      const ref = p.referenceSolution!
      for (const wire of ref.bench.wires.filter((w) => w.a.startsWith("T-") || w.b.startsWith("T-"))) {
        const broken = structuredClone(ref)
        broken.bench.wires = broken.bench.wires.filter((w) => w.id !== wire.id)
        expect(evaluate(p, broken, catalog).won, `${p.id} sem ${wire.id}`).toBe(false)
      }
    })
})

import { evaluateStars } from "../src/game"

describe("phase stars", () => {
  const data = loadPhases(phasesRaw)
  const base = (extra: Record<string, unknown>) => ({
    groups: [
      { id: "ga", title: "a", demo: true, concept: "", unlocks: ["lamp"], phases: [{ id: "a1", type: "build", goal: "x", expect: [{ when: {}, then: { L1: "lit" } }], tray: { lamp: 1 }, keyParts: [{ id: "L1", part: "lamp" }], referenceSolution: { version: 1, instances: [], blueprint: { placements: [], segments: [] }, bench: { placements: [], wires: [], meter: { mode: "off", red: null, black: null } } }, ...extra }] },
    ],
    future: [],
  })
  const errorsFor = (extra: Record<string, unknown>) => validatePhases(loadPhases(base(extra)), catalog, datasheets).join("\n")

  it("rejects usedMeter before the multimeter is unlocked", () => {
    expect(errorsFor({ stars: [{ kind: "solved" }, { kind: "usedMeter", mode: "V" }, { kind: "maxWires", value: 9 }] })).toMatch(/multímetro/)
  })

  it("rejects noDivergence when the phase already requires a match", () => {
    expect(errorsFor({ stars: [{ kind: "solved" }, { kind: "noDivergence" }, { kind: "maxWires", value: 9 }] })).toMatch(/noDivergence/)
  })

  it("rejects a missing solved first star and wrong count", () => {
    expect(errorsFor({ stars: [{ kind: "maxWires", value: 9 }, { kind: "maxCost", value: 9 }, { kind: "maxCost", value: 9 }] })).toMatch(/solved/)
    expect(errorsFor({ stars: [{ kind: "solved" }] })).toMatch(/3 estrelas/)
  })

  it("every demo phase has three stars and references earn their circuit stars", () => {
    for (const p of data.groups.filter((g) => g.demo).flatMap((g) => g.phases)) {
      expect(p.stars, p.id).toHaveLength(3)
      const doc = p.referenceSolution ?? p.initial
      if (!doc) continue
      const e = evaluate(p, doc, catalog)
      const earned = evaluateStars(p.stars, { won: true, evaluation: e, doc, side: p.evaluateOn, meterModesUsed: ["V", "A", "ohm"] })
      expect(earned, p.id).toEqual([true, true, true])
    }
  })

  it("tutorials do not reward an action their steps already require", () => {
    const g3p3 = findPhase(data, "g3p3")!
    expect(g3p3.stars.some((s) => s.kind === "usedMeter")).toBe(false)
  })
})
