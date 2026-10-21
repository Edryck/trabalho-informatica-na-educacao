import { describe, it, expect } from "vitest"
import parts from "../data/parts.json"
import type { PartsCatalog } from "../src/netlist"
import { claimableId, docCost, evaluate, evaluateScenarios, groupComplete, isPhaseAvailable, loadPhases, meterGroups, phaseOrder, shouldOfferHint, type Phase } from "../src/phases"
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
    expect(validatePhases(bad, catalog, datasheets).some((e) => e.includes("noDivergence"))).toBe(true)
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
    const errors = validatePhases(cyc, catalog, datasheets)
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
