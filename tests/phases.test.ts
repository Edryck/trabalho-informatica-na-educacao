import { describe, it, expect } from "vitest"
import parts from "../data/parts.json"
import { splitParts } from "../src/netlist"
import type { PartsCatalog } from "../src/netlist"
import { checkThen, claimableId, docCost, evaluate, evaluateScenarios, groupComplete, isPhaseAvailable, loadPhases, meterGroups, phaseOrder, shouldOfferHint, type Lesson, type Observation, type Phase, observationCanRise, witnessDoc, createObservationTracker, observationFlags, observationTick, ammeterLampPin, bothLampSides, phaseLabels } from "../src/phases"
import { benchToNetlist, blueprintToNetlist } from "../src/netlist"
import { emptyDoc, type CircuitDoc } from "../src/state"
import rewardsJson from "../data/rewards.json"
import { dailyRepair } from "../src/game"
import { TOUR_STEPS } from "../src/screens"
import { starLabel, type Datasheet } from "../src/ui"
import { solve } from "../src/solver"
import { checklistLines, eventMatches, freshTutorialState, isNegative, newPartsFor, seedIntroduced, stepEventDone, targetError, type Scenario, type ScenarioResult, type TutorialEvent } from "../src/phases"

const catalog = splitParts(parts).catalog
const guideKeys = Object.keys(splitParts(parts).guides)

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
    const results = evaluateScenarios(switchLamp.expect, { bench: net, blueprint: net }, "bench", catalog)
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
    const series = phase({ expect: [{ when: {}, then: { L1: { current: [0.03, 0.07] } } }] })
    expect(evaluate(series, circuit({ withSwitch: false, lamps: 2 }), catalog).won).toBe(true)
    expect(evaluate(series, circuit({ withSwitch: false, lamps: 1 }), catalog).won).toBe(false)
  })

  it("wins with a bench that differs from the blueprint", () => {
    const d = circuit()
    d.instances.push({ id: "L1", type: "lamp", value: 0, actualValue: 0 })
    d.blueprint.placements.push({ id: "L1", x: 0, y: 0, rotation: 0 })
    const e = evaluate(switchLamp, d, catalog)
    expect(e.divergences.length).toBeGreaterThan(0)
    expect(e.won).toBe(true)
    expect(evaluate(switchLamp, circuit(), catalog).won).toBe(true)
  })

  it("wins with an extra loose part on the bench", () => {
    const d = circuit()
    d.instances.push({ id: "L9", type: "lamp", value: 0, actualValue: 0 })
    d.bench.placements.push({ id: "L9", rotation: 0, offboard: { x: 90, z: 60 }, holes: { a: null, b: null } })
    expect(evaluate(switchLamp, d, catalog).won).toBe(true)
  })

  it("scenario on blueprint evaluates the drawing", () => {
    const drawn = phase({ evaluateOn: "bench", expect: [{ when: {}, then: { L1: "lit" }, on: "blueprint" }] })
    const benchOnly = circuit({ withSwitch: false })
    expect(evaluate(drawn, benchOnly, catalog).won).toBe(false)
    const ref = findPhase(loadPhases(phasesRaw), "g0p2")!.referenceSolution!
    const blueprintOnly = emptyDoc()
    blueprintOnly.instances = structuredClone(ref.instances)
    blueprintOnly.blueprint = structuredClone(ref.blueprint)
    expect(evaluate(drawn, blueprintOnly, catalog).won).toBe(true)
  })

  it("evaluation reports only scenarios, divergences, cost, budget and the win", () => {
    expect(Object.keys(evaluate(switchLamp, circuit(), catalog)).sort()).toEqual(["budgetOk", "cost", "divergences", "scenarios", "won"])
  })

  it("noDivergence star forces divergence markers", () => {
    const bad = loadPhases({
      groups: [{ id: "x", title: "x", demo: true, concept: "", unlocks: [], phases: [{ id: "x1", type: "build", goal: "g", showDivergence: false, stars: [{ kind: "solved" }, { kind: "noDivergence" }, { kind: "maxWires", value: 2 }] }] }],
      future: [],
    })
    expect(validatePhases(bad, catalog, datasheets, guideKeys).some((e) => e.includes("noDivergence"))).toBe(true)
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
    const e = evaluate(phase({ expect: [] }), circuit(), catalog)
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
    expect(p).toMatchObject({ brief: "olhar", tray: {}, keyParts: [], expect: [], evaluateOn: "bench", showDivergence: true, budget: null, initial: null, steps: null, hints: [], referenceSolution: null })
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
        { id: "b", title: "b", demo: true, concept: "", unlocks: [], requires: "a", phases: [{ id: "b1", type: "build", goal: "" }] },
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
    expect(validatePhases(data, catalog, datasheets, guideKeys)).toEqual([])
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
    expect(validatePhases(broken, catalog, datasheets, guideKeys).length).toBeGreaterThanOrEqual(4)
  })

  describe("reference solutions win", () => {
    for (const g of data.groups.filter((g) => g.demo))
      for (const p of g.phases.filter((p) => p.referenceSolution))
        it(p.id, () => {
          const e = evaluate(p, p.referenceSolution!, catalog)
          expect(e.scenarios.filter((s) => !s.ok).map((s) => ({ when: s.when, failures: s.failures }))).toEqual([])
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
    expect(phase({ showDivergence: false }).showDivergence).toBe(false)
    expect(phase({}).showDivergence).toBe(true)
  })
})

describe("game copy", () => {
  const data = loadPhases(phasesRaw)
  const demo = data.groups.filter((g) => g.demo).flatMap((g) => g.phases)
  const sheets = datasheets as unknown as Record<string, Datasheet>
  const daily = dailyRepair("2026-11-03", data, new Set(demo.map((p) => p.id)), catalog)
  const allCopy = () => [
    ...demo.flatMap((p) => [p.brief, ...p.hints, ...(p.steps ?? []).map((s) => s.text)]),
    ...Object.values(sheets).flatMap((d) => [d.title, d.category, d.description, ...d.features, d.application.text, d.breadboard, d.mistake]),
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

  it("every part has a complete datasheet", () => {
    for (const key of Object.keys(catalog)) {
      const d = sheets[catalog[key].datasheet ?? key]
      expect(d, key).toBeDefined()
      for (const field of ["title", "category", "description", "breadboard", "mistake"] as const) expect(d[field], `${key}.${field}`).not.toBe("")
      expect(d.features.length, `${key}.features`).toBeGreaterThanOrEqual(3)
      expect(d.features.length, `${key}.features`).toBeLessThanOrEqual(5)
      expect(d.application.text, `${key}.application`).not.toBe("")
    }
  })

  it("datasheets carry no spec numbers", () => {
    const spec = /\d+([,.]\d+)?\s*(V|A|mA|Ω|kΩ|MΩ)/
    for (const [key, d] of Object.entries(sheets)) {
      expect("values" in d, `${key}.values`).toBe(false)
      for (const text of [d.description, ...d.features]) expect(text, key).not.toMatch(spec)
    }
  })

  it("application circuits are valid", () => {
    for (const [key, d] of Object.entries(sheets)) {
      for (const i of d.application.instances) expect(i.type in catalog, `${key}:${i.type}`).toBe(true)
      const doc = { ...emptyDoc(), instances: d.application.instances, blueprint: d.application.blueprint }
      expect(() => blueprintToNetlist(doc, catalog), key).not.toThrow()
      const ids = new Set(d.application.instances.map((i) => i.id))
      for (const p of d.application.blueprint.placements) expect(ids.has(p.id), `${key}:${p.id}`).toBe(true)
    }
  })

  it("mistake never names a repair cause", () => {
    for (const [key, d] of Object.entries(sheets)) expect(d.mistake, key).not.toMatch(/\b[A-Z]{1,3}\d\b/)
  })

  it("every demo brief is filled and different from the goal", () => {
    for (const p of demo) expect(p.brief, p.id).not.toBe(p.goal)
  })
})

describe("logic references need their ground wires", () => {
  const data = loadPhases(phasesRaw)
  const logic = data.groups.filter((g) => g.id === "g7").flatMap((g) => g.phases).filter((p) => p.referenceSolution)
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

  it("rejects noDivergence when the markers are off", () => {
    expect(errorsFor({ showDivergence: false, stars: [{ kind: "solved" }, { kind: "noDivergence" }, { kind: "maxWires", value: 9 }] })).toMatch(/noDivergence/)
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
    for (const p of data.groups.filter((g) => g.demo).flatMap((g) => g.phases).filter((p) => (p.steps ?? []).some((s) => "event" in s.until && s.until.event.startsWith("meterRead"))))
      expect(p.stars.some((s) => s.kind === "usedMeter"), p.id).toBe(false)
  })
})

import { flipped, movedWireEnds, resistorAsWire, shiftColumns, withResistor, withoutWire } from "./assembly"

describe("assembly freedom", () => {
  const data = loadPhases(phasesRaw)
  const builds = data.groups
    .filter((g) => g.demo)
    .flatMap((g) => g.phases)
    .filter((p) => p.type !== "tutorial" && p.referenceSolution)
  const onBench = (p: Phase) => p.expect.every((s) => (s.on ?? p.evaluateOn) === "bench")
  const wins = (p: Phase, doc: CircuitDoc) => evaluate(p, doc, catalog).won

  for (const p of builds) {
    const ref = p.referenceSolution!

    describe(p.id, () => {
      it("loses when empty", () => {
        expect(wins(p, emptyDoc())).toBe(false)
      })

      if (p.type === "repair" && p.initial)
        it("starts broken", () => {
          expect(wins(p, p.initial!)).toBe(false)
        })

      if (onBench(p)) {
        it("wins shifted along the board", () => {
          const shifted = shiftColumns(ref, 2) ?? shiftColumns(ref, -2) ?? shiftColumns(ref, 1) ?? shiftColumns(ref, -1)
          if (!shifted) return
          expect(wins(p, shifted)).toBe(true)
        })

        it("wins with wire ends moved within their strips", () => {
          expect(wins(p, movedWireEnds(ref))).toBe(true)
        })

        it("wins with the blueprint cleared", () => {
          const doc = structuredClone(ref)
          doc.blueprint = { placements: [], segments: [] }
          expect(wins(p, doc)).toBe(true)
        })

        if (p.budget === null)
          it("wins with an extra loose lamp", () => {
            const doc = structuredClone(ref)
            doc.instances.push({ id: "L9", type: "lamp", value: 0, actualValue: 0 })
            doc.bench.placements.push({ id: "L9", rotation: 0, offboard: { x: 90, z: 60 }, holes: { a: null, b: null } })
            expect(wins(p, doc)).toBe(true)
          })

        for (const wire of ref.bench.wires)
          it(`needs wire ${wire.id}`, () => {
            expect(wins(p, withoutWire(ref, wire.id))).toBe(false)
          })

        for (const part of ref.instances.filter((i) => ["led", "diode"].includes(i.type)))
          it(`loses with ${part.id} flipped`, () => {
            expect(wins(p, flipped(ref, part.id))).toBe(false)
          })

        for (const part of ref.instances.filter((i) => i.type === "resistor" || i.type === "lamp"))
          it(`still wins with ${part.id} mounted the other way round`, () => {
            const doc = structuredClone(ref)
            const placement = doc.bench.placements.find((x) => x.id === part.id)!
            placement.holes = { a: placement.holes.b ?? null, b: placement.holes.a ?? null }
            expect(wins(p, doc)).toBe(true)
          })

        for (const part of ref.instances.filter((i) => i.type === "resistor"))
          it(`loses with ${part.id} replaced by a wire`, () => {
            expect(wins(p, resistorAsWire(ref, part.id))).toBe(false)
          })
      } else {
        it("wins with the bench cleared", () => {
          const doc = structuredClone(ref)
          doc.bench = emptyDoc().bench
          expect(wins(p, doc)).toBe(true)
        })

        it("loses with the blueprint cleared", () => {
          const doc = structuredClone(ref)
          doc.blueprint = { placements: [], segments: [] }
          expect(wins(p, doc)).toBe(false)
        })
      }

      const resistors = ref.instances.filter((i) => i.type === "resistor")
      const hasRange = p.expect.some((s) => Object.values(s.then).some((v) => typeof v !== "string"))
      if (onBench(p) && hasRange && resistors.length > 0)
        it("range accepts two catalog values and rejects at least one", () => {
          const batteries = p.trayValues?.battery ?? catalog.battery.values!
          const outcomes: boolean[] = []
          for (const volts of batteries)
            for (const ohms of catalog.resistor.values!) {
              let doc = structuredClone(ref)
              doc.instances.find((i) => i.type === "battery")!.value = volts
              doc.instances.find((i) => i.type === "battery")!.actualValue = volts
              for (const r of resistors) doc = withResistor(doc, r.id, ohms)
              outcomes.push(wins(p, doc))
            }
          expect(outcomes.filter(Boolean).length).toBeGreaterThanOrEqual(2)
          expect(outcomes.some((o) => !o)).toBe(true)
        })
    })
  }
})

describe("claimableId", () => {
  const keys = [{ id: "L1", part: "lamp" }]
  const placed = (side: "bench" | "blueprint") => {
    const d = emptyDoc()
    d.instances.push({ id: "L1", type: "lamp", value: 0, actualValue: 0 })
    if (side === "bench") d.bench.placements.push({ id: "L1", rotation: 0, offboard: { x: 0, z: 0 }, holes: { a: null, b: null } })
    else d.blueprint.placements.push({ id: "L1", x: 0, y: 0, rotation: 0 })
    return d
  }

  it("claims the key id after the part was removed from one side", () => {
    expect(claimableId(placed("blueprint"), "bench", "lamp", keys)).toBe("L1")
  })

  it("claims a key id missing from the doc", () => {
    expect(claimableId(emptyDoc(), "bench", "lamp", keys)).toBe("L1")
  })

  it("returns undefined when the key part is already placed on that side", () => {
    expect(claimableId(placed("bench"), "bench", "lamp", keys)).toBeUndefined()
  })

  it("returns undefined for a type that is not a key part", () => {
    expect(claimableId(emptyDoc(), "bench", "buzzer", keys)).toBeUndefined()
  })
})

describe("group requirements", () => {
  const fixture = () =>
    loadPhases({
      groups: [
        { id: "a", title: "a", demo: true, concept: "", unlocks: ["multimeter"], phases: [{ id: "a1", type: "build", goal: "" }, { id: "a2", type: "build", goal: "" }] },
        { id: "b", title: "b", demo: true, concept: "", unlocks: [], requires: "a", phases: [{ id: "b1", type: "build", goal: "" }] },
        { id: "c", title: "c", demo: true, concept: "", unlocks: [], requires: "b", phases: [] },
        { id: "d", title: "d", demo: true, concept: "", unlocks: [], requires: "c", phases: [{ id: "d1", type: "build", goal: "" }] },
      ],
      future: [],
    })

  it("first phase of a group needs the required group complete", () => {
    const data = fixture()
    expect(isPhaseAvailable(data, new Set(["a1"]), "b1")).toBe(false)
    expect(isPhaseAvailable(data, new Set(["a1", "a2"]), "b1")).toBe(true)
  })

  it("phases inside a group stay linear", () => {
    const data = fixture()
    expect(isPhaseAvailable(data, new Set(), "a2")).toBe(false)
    expect(isPhaseAvailable(data, new Set(["a1"]), "a2")).toBe(true)
  })

  it("empty group is never complete", () => {
    const data = fixture()
    const all = new Set(["a1", "a2", "b1", "d1"])
    expect(groupComplete(data.groups[2], all)).toBe(false)
  })

  it("group after an empty group unlocks when the empty one's requirement is met", () => {
    const data = fixture()
    expect(isPhaseAvailable(data, new Set(["a1", "a2"]), "d1")).toBe(false)
    expect(isPhaseAvailable(data, new Set(["a1", "a2", "b1"]), "d1")).toBe(true)
  })

  it("rejects requires cycles and unknown groups", () => {
    const cyc = loadPhases({
      groups: [
        { id: "x", title: "x", demo: true, concept: "", unlocks: [], requires: "y", phases: [] },
        { id: "y", title: "y", demo: true, concept: "", unlocks: [], requires: "x", phases: [] },
        { id: "z", title: "z", demo: true, concept: "", unlocks: [], requires: "nope", phases: [] },
      ],
      future: [],
    })
    const errors = validatePhases(cyc, catalog, datasheets, guideKeys)
    expect(errors.some((e) => e.includes("ciclo"))).toBe(true)
    expect(errors.some((e) => e.includes('"nope"'))).toBe(true)
  })

  it("meter groups follow the requires chain", () => {
    expect([...meterGroups(fixture())].sort()).toEqual(["a", "b", "c", "d"])
    const data = loadPhases({
      groups: [
        { id: "a", title: "a", demo: true, concept: "", unlocks: [], phases: [] },
        { id: "b", title: "b", demo: true, concept: "", unlocks: ["multimeter"], requires: "a", phases: [] },
        { id: "c", title: "c", demo: true, concept: "", unlocks: [], requires: "b", phases: [] },
      ],
      future: [],
    })
    expect([...meterGroups(data)].sort()).toEqual(["b", "c"])
  })
})

describe("shipped group structure", () => {
  const data = loadPhases(phasesRaw)

  it("demo groups in order", () => {
    expect(data.groups.filter((g) => g.demo).map((g) => g.id)).toEqual(["g0", "g1", "g2", "g3", "g6"])
    expect(data.groups.find((g) => g.id === "g6")!.block).toBe("eletronica")
  })

  it("every group declares requires except g0", () => {
    for (const g of data.groups) expect(g.requires === null, g.id).toBe(g.id === "g0")
  })

  it("only g5 and g8 burn", () => {
    expect(data.groups.filter((g) => g.burns).map((g) => g.id)).toEqual(["g5", "g8"])
  })

  it("old LED phases moved", () => {
    expect(findPhase(data, "g6p4")!.goal).toBe("escolher R pra corrente do datasheet do LED")
  })
})

describe("diode states in expect", () => {
  const diodeNet = (reversed: boolean) => ({
    parts: [
      { id: "B1", type: "battery", value: 9 },
      { id: "D1", type: "diode", value: 0 },
      { id: "R1", type: "resistor", value: 1000 },
    ],
    links: [],
    pinAt: { "B1.+": "p", "B1.-": "n", "D1.a": reversed ? "q" : "p", "D1.k": reversed ? "p" : "q", "R1.a": "q", "R1.b": "n" },
  })

  it("stateMatches understands conducting and blocking", () => {
    for (const [reversed, want, other] of [[false, "conducting", "blocking"], [true, "blocking", "conducting"]] as const) {
      const nets = { bench: diodeNet(reversed), blueprint: diodeNet(reversed) }
      expect(evaluateScenarios([{ when: {}, then: { D1: want } }], nets, "bench", catalog)[0].ok).toBe(true)
      expect(evaluateScenarios([{ when: {}, then: { D1: other } }], nets, "bench", catalog)[0].ok).toBe(false)
    }
  })
})

describe("scenarios that take a part out", () => {
  const lampNet = (parallel: boolean) => ({
    parts: [
      { id: "B1", type: "battery", value: 9 },
      { id: "L1", type: "lamp", value: 0 },
      { id: "L2", type: "lamp", value: 0 },
    ],
    links: [],
    pinAt: parallel
      ? { "B1.+": "p", "B1.-": "n", "L1.a": "p", "L1.b": "n", "L2.a": "p", "L2.b": "n" }
      : { "B1.+": "p", "B1.-": "n", "L1.a": "p", "L1.b": "m", "L2.a": "m", "L2.b": "n" },
  })

  it("when can take a part out of the circuit", () => {
    const scenario = { when: { L2: "removed" }, then: { L1: "lit" } }
    const parallel = lampNet(true)
    const series = lampNet(false)
    expect(evaluateScenarios([scenario], { bench: parallel, blueprint: parallel }, "bench", catalog)[0].ok).toBe(true)
    expect(evaluateScenarios([scenario], { bench: series, blueprint: series }, "bench", catalog)[0].ok).toBe(false)
    expect(parallel.parts.every((p) => !("fault" in p))).toBe(true)
  })

  it("current ranges on a lamp ignore which way it was mounted", () => {
    const net = (flip: boolean) => ({
      parts: [
        { id: "B1", type: "battery", value: 9 },
        { id: "L1", type: "lamp", value: 0 },
      ],
      links: [],
      pinAt: { "B1.+": "p", "B1.-": "n", "L1.a": flip ? "n" : "p", "L1.b": flip ? "p" : "n" },
    })
    const scenario = { when: {}, then: { L1: { current: [0.08, 0.2] as [number, number] } } }
    for (const flip of [false, true]) expect(evaluateScenarios([scenario], { bench: net(flip), blueprint: net(flip) }, "bench", catalog)[0].ok).toBe(true)
  })

  it("voltage ranges on a resistor ignore which way it was mounted", () => {
    const net = (flip: boolean) => ({
      parts: [
        { id: "B1", type: "battery", value: 9 },
        { id: "R1", type: "resistor", value: 1000 },
        { id: "R2", type: "resistor", value: 1000 },
      ],
      links: [],
      pinAt: { "B1.+": "p", "B1.-": "n", "R1.a": "p", "R1.b": "m", "R2.a": flip ? "n" : "m", "R2.b": flip ? "m" : "n" },
    })
    const scenario = { when: {}, then: { R2: { voltage: [3.6, 5.4] as [number, number] } } }
    for (const flip of [false, true]) expect(evaluateScenarios([scenario], { bench: net(flip), blueprint: net(flip) }, "bench", catalog)[0].ok).toBe(true)
  })
})

describe("final demo size", () => {
  const data = loadPhases(phasesRaw)
  const demo = data.groups.filter((g) => g.demo).flatMap((g) => g.phases)

  it("demo has 29 phases and 87 stars", () => {
    expect(demo).toHaveLength(29)
    expect(demo.reduce((n, p) => n + p.stars.length, 0)).toBe(87)
  })

  it("every demo group has phases", () => {
    for (const g of data.groups.filter((g) => g.demo)) expect(g.phases.length, g.id).toBeGreaterThan(0)
  })
})

describe("groups outside the demo stay closed", () => {
  const data = loadPhases(phasesRaw)

  it("no phase of a non-demo group is available with the whole demo won", () => {
    const won = new Set(data.groups.filter((g) => g.demo).flatMap((g) => g.phases.map((p) => p.id)))
    for (const g of data.groups.filter((g) => !g.demo))
      for (const phase of g.phases) expect(isPhaseAvailable(data, won, phase.id), phase.id).toBe(false)
  })
})

describe("checkThen", () => {
  const live = (doc: CircuitDoc) => {
    const net = benchToNetlist(doc, catalog)
    return { net, result: solve(net, catalog) }
  }

  it("passes a state on the live circuit", () => {
    const { net, result } = live(circuit({ withSwitch: false }))
    expect(checkThen({ L1: "lit" }, net, result, catalog)).toEqual([])
  })

  it("reports state, range and missing", () => {
    const { net, result } = live(circuit({ withSwitch: false }))
    expect(checkThen({ L1: "off" }, net, result, catalog)).toEqual([{ partId: "L1", reason: "state" }])
    expect(checkThen({ L1: { current: [1, 2] } }, net, result, catalog)).toEqual([{ partId: "L1", reason: "range" }])
    expect(checkThen({ L9: "lit" }, net, result, catalog)).toEqual([{ partId: "L9", reason: "missing" }])
  })

  it("uses the live switch state, not a forced one", () => {
    const off = live(circuit())
    expect(checkThen({ L1: "off" }, off.net, off.result, catalog)).toEqual([])
    const on = live(circuit({ inputs: { S1: "on" } }))
    expect(checkThen({ L1: "lit" }, on.net, on.result, catalog)).toEqual([])
  })
})

describe("lesson and order", () => {
  it("default to null", () => {
    const p = phase({})
    expect(p.lesson).toBeNull()
    expect(p.order).toBeNull()
  })

  it("keep authored text and fill missing observations", () => {
    const p = phase({ lesson: { concept: "c", discovery: "d" } as Lesson, order: { object: "o", thanks: "t" } })
    expect(p.lesson).toEqual({ concept: "c", discovery: "d", observations: [] })
    expect(p.order).toEqual({ object: "o", thanks: "t" })
  })

  it("daily repair drops the base lesson and order", () => {
    const data = loadPhases(phasesRaw)
    const demo = data.groups.filter((g) => g.demo).flatMap((g) => g.phases)
    const daily = dailyRepair("2026-11-03", data, new Set(demo.map((p) => p.id)), catalog)!
    expect(daily.lesson).toBeNull()
    expect(daily.order).toBeNull()
  })
})

describe("observationFlags", () => {
  const doc = circuit({ withSwitch: false })
  const benchNet = benchToNetlist(doc, catalog)
  const blueprintNet = blueprintToNetlist(doc, catalog)
  const live = {
    bench: { net: benchNet, result: solve(benchNet, catalog) },
    blueprint: { net: blueprintNet, result: solve(blueprintNet, catalog) },
  }
  const lit: Observation = { if: { L1: "lit" }, say: "x", witness: { from: "reference" } }

  it("reads the side the phase evaluates", () => {
    expect(observationFlags([lit], "bench", live, catalog)).toEqual([true])
    expect(observationFlags([lit], "blueprint", live, catalog)).toEqual([false])
  })

  it("an observation can pin its own side", () => {
    expect(observationFlags([{ ...lit, on: "blueprint" }], "bench", live, catalog)).toEqual([false])
  })

  it("keeps the order of the list", () => {
    expect(observationFlags([{ ...lit, if: { L1: "off" } }, lit], "bench", live, catalog)).toEqual([false, true])
  })
})

describe("observationTick", () => {
  const run = (frames: boolean[][]) => {
    let tracker = createObservationTracker()
    return frames.map((flags) => {
      const next = observationTick(tracker, flags)
      tracker = next.tracker
      return next.show
    })
  }

  it("first frame is the baseline", () => {
    expect(run([[true, false]])).toEqual([null])
  })

  it("shows on the rising edge once per attempt", () => {
    expect(run([[false], [true], [false], [true]])).toEqual([null, 0, null, null])
  })

  it("shows one per tick and keeps the rest eligible", () => {
    expect(run([[false, false], [true, true], [true, true], [true, true]])).toEqual([null, 0, 1, null])
  })

  it("drops a pending one that went false", () => {
    expect(run([[false, false], [true, true], [true, false], [true, true]])).toEqual([null, 0, null, 1])
  })

  it("an observation true at the baseline can still rise later", () => {
    expect(run([[true], [false], [true]])).toEqual([null, null, 0])
  })
})

describe("observation witnesses", () => {
  const p = phase({ initial: circuit(), referenceSolution: circuit({ inputs: { S1: "on" } }) })
  const lit: Observation = { if: { L1: "lit" }, say: "x", witness: { from: "initial", inputs: { S1: "on" } } }

  it("applies inputs, faults, values and moves without touching the phase", () => {
    const doc = witnessDoc(p, { from: "initial", inputs: { S1: "on" }, open: ["L1"], values: { B1: 5 }, move: { "L1.a": "J30", "W1.b": "E30" } })!
    expect(doc.instances.find((i) => i.id === "S1")!.inputState).toBe("on")
    expect(doc.instances.find((i) => i.id === "L1")!.fault).toBe("open")
    expect(doc.instances.find((i) => i.id === "B1")!.actualValue).toBe(5)
    expect(doc.bench.placements.find((x) => x.id === "L1")!.holes.a).toBe("J30")
    expect(doc.bench.wires.find((w) => w.id === "W1")!.b).toBe("E30")
    expect(p.initial!.instances.find((i) => i.id === "L1")!.fault).toBeUndefined()
  })

  it("returns null without the base doc", () => {
    expect(witnessDoc(phase({}), { from: "reference" })).toBeNull()
  })

  it("rises when false at the start and true at the witness", () => {
    expect(observationCanRise(p, lit, catalog)).toBe(true)
  })

  it("does not rise when already true at the start", () => {
    expect(observationCanRise(p, { ...lit, if: { L1: "off" }, witness: { from: "initial", open: ["L1"] } }, catalog)).toBe(false)
  })

  it("does not rise when the witness misses it", () => {
    expect(observationCanRise(p, { ...lit, witness: { from: "initial" } }, catalog)).toBe(false)
  })

  it("a build phase without initial starts from the empty doc", () => {
    const build = phase({ referenceSolution: circuit({ inputs: { S1: "on" } }) })
    expect(observationCanRise(build, { ...lit, witness: { from: "reference" } }, catalog)).toBe(true)
  })
})

describe("ammeter on each side of the lamp", () => {
  const lampLoop = (): CircuitDoc => {
    const d = emptyDoc()
    d.instances.push({ id: "B1", type: "battery", value: 9, actualValue: 9 }, { id: "L1", type: "lamp", value: 0, actualValue: 0 })
    d.bench.placements.push(
      { id: "B1", rotation: 0, offboard: { x: -75, z: -10 }, holes: { "+": "T+3", "-": "T-3" } },
      { id: "L1", rotation: 0, offboard: { x: 0, z: -55 }, holes: { a: "A14", b: "A18" } },
    )
    d.bench.wires.push({ id: "W1", a: "T+14", b: "B14", color: "#C62828" }, { id: "W2", a: "B18", b: "T-18", color: "#202020" })
    return d
  }
  const measured = (without: string[], mode: "V" | "A", red: string, black: string) => {
    const d = lampLoop()
    d.bench.wires = d.bench.wires.filter((w) => !without.includes(w.id))
    d.bench.meter = { mode, red, black }
    return d
  }
  const pinOf = (d: CircuitDoc) => {
    const net = benchToNetlist(d, catalog)
    return ammeterLampPin(net, solve(net, catalog), catalog)
  }

  it("finds the side the current comes in", () => {
    expect(pinOf(measured(["W1"], "A", "T+14", "C14"))).toBe("L1.a")
  })

  it("finds the side the current goes out", () => {
    expect(pinOf(measured(["W2"], "A", "C18", "T-18"))).toBe("L1.b")
  })

  it("ignores the meter across the lamp", () => {
    expect(pinOf(measured([], "A", "C14", "C18"))).toBeNull()
  })

  it("ignores the volt scale", () => {
    expect(pinOf(measured(["W1"], "V", "T+14", "C14"))).toBeNull()
  })

  it("ignores an open loop with no current", () => {
    expect(pinOf(measured(["W1", "W2"], "A", "T+14", "C14"))).toBeNull()
  })

  it("ignores a circuit without the meter", () => {
    expect(pinOf(lampLoop())).toBeNull()
  })

  it("needs both pins of the same lamp", () => {
    expect(bothLampSides(["L1.a"])).toBe(false)
    expect(bothLampSides(["L1.a", "L2.b"])).toBe(false)
    expect(bothLampSides(["L1.a", "L2.b", "L1.b"])).toBe(true)
  })
})

describe("phaseLabels", () => {
  it("numbers phases by their position, not their id", () => {
    const data = loadPhases({
      groups: [{ id: "g2", title: "t", demo: true, concept: "", unlocks: [], phases: [{ id: "g2p1", type: "build", goal: "a" }, { id: "g2p7", type: "build", goal: "b" }, { id: "g2p4", type: "build", goal: "c" }] }],
      future: [],
    })
    expect(phaseLabels(data)).toEqual({ g2p1: "g2p1", g2p7: "g2p2", g2p4: "g2p3" })
  })
})

describe("lamp current phase", () => {
  const data = loadPhases(phasesRaw)
  const g2 = data.groups.find((g) => g.id === "g2")!
  const lampPhase = g2.phases.find((p) => p.id === "g2p7")!
  const swap = (without: string, red: string, black: string) => {
    const d = structuredClone(lampPhase.initial!)
    d.bench.wires = d.bench.wires.filter((w) => w.id !== without)
    d.bench.meter = { mode: "A", red, black }
    return d
  }
  const sideOf = (doc: CircuitDoc) => {
    const net = benchToNetlist(doc, catalog)
    return ammeterLampPin(net, solve(net, catalog), catalog)
  }

  it("comes right after the Ohm tutorial", () => {
    expect(g2.phases.map((p) => p.id)).toEqual(["g2p1", "g2p2", "g2p3", "g2p7", "g2p4", "g2p5", "g2p6"])
  })

  it("shows up as the fourth phase of g2", () => {
    expect(phaseLabels(data).g2p7).toBe("g2p4")
  })

  it("unlocks right after g2p3 and holds g2p4 back", () => {
    const before = data.groups.filter((g) => g.id === "g0" || g.id === "g1").flatMap((g) => g.phases.map((p) => p.id))
    const won = new Set([...before, "g2p1", "g2p2", "g2p3"])
    expect(isPhaseAvailable(data, won, "g2p7")).toBe(true)
    expect(isPhaseAvailable(data, won, "g2p4")).toBe(false)
    expect(isPhaseAvailable(data, new Set([...won, "g2p7"]), "g2p4")).toBe(true)
  })

  it("ends by measuring both sides of the lamp", () => {
    expect(lampPhase.steps!.at(-1)!.until).toEqual({ event: "meterReadLampBothSides" })
  })

  it("never rewards usedMeter", () => {
    expect(lampPhase.stars.some((s) => s.kind === "usedMeter")).toBe(false)
  })

  it("the netlist tells the two sides apart on the shipped circuit", () => {
    expect(sideOf(swap("W1", "T+14", "C14"))).toBe("L1.a")
    expect(sideOf(swap("W2", "C18", "T-18"))).toBe("L1.b")
  })

  it("its observation can rise", () => {
    for (const o of lampPhase.lesson!.observations) expect(observationCanRise(lampPhase, o, catalog), o.say).toBe(true)
  })
})

describe("tutorial events", () => {
  it("matches by type when until has no target", () => {
    expect(eventMatches({ event: "partPlaced" }, { type: "partPlaced", target: "part:L1", partType: "lamp" })).toBe(true)
    expect(eventMatches({ event: "partPlaced" }, { type: "wireDrawn" })).toBe(false)
  })

  it("matches target by id or by the part type recorded in the event", () => {
    expect(eventMatches({ event: "partPicked", target: "part:battery" }, { type: "partPicked", target: "part:battery", partType: "battery" })).toBe(true)
    expect(eventMatches({ event: "partSnapped", target: "part:lamp" }, { type: "partSnapped", target: "part:L1", partType: "lamp" })).toBe(true)
    expect(eventMatches({ event: "partMoved", target: "part:lamp" }, { type: "partMoved", target: "part:B1", partType: "battery" })).toBe(false)
    expect(eventMatches({ event: "partMoved", target: "part:lamp" }, { type: "partMoved", target: "part:L1" })).toBe(false)
  })

  it("an action done before its step still counts", () => {
    const log: TutorialEvent[] = [{ type: "wireDrawn" }, { type: "cameraOrbited" }]
    expect(stepEventDone({ event: "wireDrawn" }, log)).toBe(true)
  })

  it("fresh tutorial state starts at step 0 with an empty log, or null without steps", () => {
    expect(freshTutorialState({ steps: [{ text: "x", until: { event: "wireDrawn" } }] } as unknown as Phase)).toEqual({ stepIndex: 0, events: [] })
    expect(freshTutorialState({ steps: null } as unknown as Phase)).toEqual({ stepIndex: null, events: [] })
  })
})

describe("step targets", () => {
  const phase = { id: "t", initial: { instances: [{ id: "B1", type: "battery" }] } } as unknown as Phase

  it("accepts known prefixes with valid values", () => {
    expect(targetError("hole:A5", phase, catalog)).toBeNull()
    expect(targetError("hole:T+30", phase, catalog)).toBeNull()
    expect(targetError("part:battery", phase, catalog)).toBeNull()
    expect(targetError("part:B1", phase, catalog)).toBeNull()
    expect(targetError("probe:red", phase, catalog)).toBeNull()
    expect(targetError("meter:ohm", phase, catalog)).toBeNull()
    expect(targetError("css:.tour", phase, catalog)).toBeNull()
  })

  it("rejects holes, parts, probes, meter modes and prefixes that do not exist", () => {
    expect(targetError("hole:K5", phase, catalog)).not.toBeNull()
    expect(targetError("part:L9", phase, catalog)).not.toBeNull()
    expect(targetError("probe:green", phase, catalog)).not.toBeNull()
    expect(targetError("meter:x", phase, catalog)).not.toBeNull()
    expect(targetError("tray:lamp", phase, catalog)).not.toBeNull()
    expect(targetError("css:", phase, catalog)).not.toBeNull()
  })

  it("accepts every hole the board generates and rejects the edges outside it", () => {
    const holes: string[] = []
    for (let col = 1; col <= 30; col++) {
      for (const row of "ABCDEFGHIJ") holes.push(`${row}${col}`)
      for (const rail of ["T+", "T-", "B+", "B-"]) holes.push(`${rail}${col}`)
    }
    expect(holes).toHaveLength(420)
    for (const hole of holes) expect(targetError(`hole:${hole}`, phase, catalog), hole).toBeNull()
    for (const bad of ["A0", "A31", "K1", "T+0", "T+31", "X+1"]) expect(targetError(`hole:${bad}`, phase, catalog), bad).not.toBeNull()
  })

  it("real phase data has no bad step targets", () => {
    expect(validatePhases(loadPhases(phasesRaw), catalog, datasheets, guideKeys).filter((e) => e.includes("passo"))).toEqual([])
  })

  it("noDivergence is rejected in a phase judged only on the blueprint", () => {
    const bad = structuredClone(loadPhases(phasesRaw))
    const phase = bad.groups[0].phases.find((p) => p.id === "g0p2")!
    phase.stars = [{ kind: "solved" }, { kind: "maxCost", value: 4 }, { kind: "noDivergence" }]
    expect(validatePhases(bad, catalog, datasheets, guideKeys).some((e) => e.includes("g0p2") && e.includes("noDivergence"))).toBe(true)
  })

  it("g0p2 can reach all three stars by drawing a clean two-wire loop", () => {
    const phase = findPhase(loadPhases(phasesRaw), "g0p2")!
    const doc = emptyDoc()
    doc.instances.push({ id: "B1", type: "battery", value: 9, actualValue: 9 }, { id: "L1", type: "lamp", value: 0, actualValue: 0 })
    doc.blueprint.placements.push({ id: "B1", x: -6, y: 0, rotation: 0 }, { id: "L1", x: 6, y: 0, rotation: 90 })
    doc.blueprint.segments.push({ id: "F1", x1: -6, y1: -2, x2: 6, y2: -2 }, { id: "F2", x1: -6, y1: 2, x2: 6, y2: 2 })
    const e = evaluate(phase, doc, catalog)
    expect(e.won).toBe(true)
    expect(evaluateStars(phase.stars, { won: true, evaluation: e, doc, side: phase.evaluateOn, meterModesUsed: [] })).toEqual([true, true, true])
  })

  it("validatePhases rejects introduces that is neither a guide nor a part", () => {
    const bad = structuredClone(loadPhases(phasesRaw))
    bad.groups[0].phases[0].introduces = ["nope"]
    expect(validatePhases(bad, catalog, datasheets, guideKeys).some((e) => e.includes('introduces "nope" não existe'))).toBe(true)
  })

  it("validatePhases reports a bad step target in any phase, demo or not", () => {
    const bad = structuredClone(loadPhases(phasesRaw))
    bad.groups[0].phases[0].steps = [{ text: "x", until: { event: "wireDrawn" }, target: "tray:lamp" }]
    expect(validatePhases(bad, catalog, datasheets, guideKeys).some((e) => e.startsWith(`fase ${bad.groups[0].phases[0].id}: passo 1:`))).toBe(true)
  })
})

describe("part cards", () => {
  const data = loadPhases(phasesRaw)

  it("[RF 5] seeds introduced parts from finished groups and finished phases", () => {
    const won = new Set(data.groups.find((g) => g.id === "g0")!.phases.map((p) => p.id))
    const seeded = seedIntroduced(data, won, catalog)
    expect(seeded).toEqual(expect.arrayContaining(["battery", "lamp", "breadboard", "jumper_wire"]))
    expect(seeded).not.toContain("resistor")
  })

  it("[RF 5] a won phase also seeds the parts that came in its initial circuit", () => {
    // g1p3 traz bateria e motor já montados e não tem bandeja
    expect(seedIntroduced(data, new Set(["g1p3"]), catalog)).toEqual(expect.arrayContaining(["battery", "dc_motor"]))
  })

  it("lists new parts for the first phase of a group, unlocks first", () => {
    const g2p1 = findPhase(data, "g2p1")!
    const known = new Set(["resistor", "multimeter", "battery", "lamp"])
    expect(newPartsFor(data, g2p1, ["battery", "lamp"], known, catalog).slice(0, 2)).toEqual(["resistor", "multimeter"])
    expect(newPartsFor(data, g2p1, ["battery", "lamp", "resistor", "multimeter"], known, catalog)).toEqual([])
  })

  it("guides only come from introduces", () => {
    const known = new Set(["battery", "lamp", "breadboard", "jumper_wire"])
    expect(newPartsFor(data, findPhase(data, "g0p1")!, [], known, catalog)).not.toContain("breadboard")
    expect(newPartsFor(data, findPhase(data, "g0p4")!, ["battery", "lamp"], known, catalog)).toEqual(["breadboard", "jumper_wire"])
  })
})

describe("guides split", () => {
  it("catalog has no guides and guides come with a how-to", () => {
    const { catalog: parsed, guides } = splitParts(parts)
    expect(parsed).not.toHaveProperty("guides")
    expect(parsed).not.toHaveProperty("breadboard")
    expect(guides.breadboard.howTo.place.length).toBeGreaterThan(0)
    expect(guides.jumper_wire.name.length).toBeGreaterThan(0)
  })
})

describe("checklist by condition", () => {
  const expect2: Scenario[] = [
    { when: { S1: "on" }, then: { L1: "lit" } },
    { when: { S1: "off" }, then: { L1: "off" } },
  ]
  const okAll = (n: number) => Array.from({ length: n }, () => ({ ok: true, failures: [] }) as unknown as ScenarioResult)

  it("negative condition waits for a positive one", () => {
    const empty = [{ ok: false, failures: [{ partId: "L1", reason: "missing" }] }, { ok: true, failures: [] }] as unknown as ScenarioResult[]
    const first = checklistLines(expect2, empty, new Set())
    expect(first.lines.map((l) => l.ok)).toEqual([false, false])
    const later = checklistLines(expect2, okAll(2), first.positiveSeen)
    expect(later.lines.map((l) => l.ok)).toEqual([true, true])
  })

  it("[RF 2] fresh set after restart hides the negative again", () => {
    const onlyNegative = [{ ok: false, failures: [{ partId: "L1", reason: "state" }] }, { ok: true, failures: [] }] as unknown as ScenarioResult[]
    expect(checklistLines(expect2, onlyNegative, new Set()).lines[1].ok).toBe(false)
  })

  it("same-scenario rule: positive in the scenario unlocks its own negative", () => {
    const one: Scenario[] = [{ when: {}, then: { L1: "lit", L2: "off" } }]
    const r = [{ ok: true, failures: [] }] as unknown as ScenarioResult[]
    expect(checklistLines(one, r, new Set()).lines.map((l) => l.ok)).toEqual([true, true])
  })

  it("isNegative only for off, 0 and blocking", () => {
    expect(["off", "0", "blocking"].every((v) => isNegative(v))).toBe(true)
    expect(isNegative("lit") || isNegative("1") || isNegative({ current: [0, 1] })).toBe(false)
  })
})

