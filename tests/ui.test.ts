import { describe, it, expect } from "vitest"
import { MENTOR, bounceLand, cssLinear, divergenceLabel, formatValue, meterDisplayText, orderFrom, particleSpeed, pop, sampleBounce, sampleSpring, checklistGroups, conditionLabel, scenarioLabel, sentenceCase, setReducedMotion, visibleDivergences } from "../src/ui"
import type { Divergence } from "../src/netlist"
import type { Star } from "../src/phases"

const T = " "

describe("formatValue", () => {
  it("formats with SI prefix and comma", () => {
    expect(formatValue(0.02, "A")).toBe(`20,0${T}mA`)
    expect(formatValue(4.72, "V")).toBe(`4,72${T}V`)
    expect(formatValue(220, "Ω")).toBe(`220${T}Ω`)
    expect(formatValue(2200, "Ω")).toBe(`2,20${T}kΩ`)
  })

  it("formats extreme values", () => {
    expect(formatValue(1e-9, "A")).toBe(`1,00${T}nA`)
    expect(formatValue(4.7e6, "Ω")).toBe(`4,70${T}MΩ`)
    expect(formatValue(-0.02, "A")).toBe(`−20,0${T}mA`)
    expect(formatValue(0, "V")).toBe(`0,00${T}V`)
  })

  it("carries rounding into the next prefix", () => {
    expect(formatValue(0.9996, "A")).toBe(`1,00${T}A`)
    expect(formatValue(999.7, "Ω")).toBe(`1,00${T}kΩ`)
  })
})

describe("particleSpeed", () => {
  it("is absolute, log and clamped", () => {
    expect(particleSpeed(0.1)).toBeGreaterThan(particleSpeed(0.01))
    expect(particleSpeed(1e-7)).toBe(0)
    expect(particleSpeed(1e-5)).toBe(0.5)
    expect(particleSpeed(1e-4)).toBe(0.5)
    expect(particleSpeed(1)).toBe(8)
    expect(particleSpeed(50)).toBe(8)
    expect(particleSpeed(-0.05)).toBe(particleSpeed(0.05))
  })
})

describe("divergences", () => {
  const d = (partId: string): Divergence => ({ kind: "wiring", partId, pin: "a", power: false, expected: [], actual: [] })

  it("shows two and counts the rest", () => {
    const r = visibleDivergences([d("A"), d("B"), d("C"), d("D"), d("E")])
    expect(r.shown.map((x) => x.partId)).toEqual(["A", "B"])
    expect(r.more).toBe(3)
  })

  it("handles an empty list", () => {
    expect(visibleDivergences([])).toEqual({ shown: [], more: 0 })
  })

  it("labels value and pending divergences", () => {
    expect(divergenceLabel({ kind: "value", partId: "R1", power: false, specValue: 220, actualValue: 2200 })).toBe(
      "R1 no esquema é 220 Ω, a peça na protoboard é 2,20 kΩ",
    )
    expect(divergenceLabel({ kind: "pending", partId: "L2", power: false, side: "bench" })).toBe("L2 está no esquema, mas ainda não está na protoboard")
    expect(divergenceLabel({ kind: "pending", partId: "L2", power: false, side: "blueprint" })).toBe("L2 está na protoboard, mas ainda não está no esquema")
  })

  it("labels a loose wiring end with readable pins", () => {
    expect(divergenceLabel({ kind: "wiring", partId: "L1", pin: "b", power: true, expected: ["B1.-"], actual: [] })).toBe(
      "L1 b: no esquema liga em B1 −, na protoboard está solta",
    )
    expect(divergenceLabel({ kind: "wiring", partId: "L1", pin: "b", power: false, expected: ["R1.a"], actual: ["S1.a"] })).toBe(
      "L1 b: no esquema liga em R1 a, na protoboard liga em S1 a",
    )
  })
})

describe("scenarioLabel", () => {
  it("names inputs and expected states", () => {
    expect(scenarioLabel({ when: { S1: "on" }, then: { L1: "lit" } })).toEqual({ when: "S1 ligada", then: "L1 acesa" })
    expect(scenarioLabel({ when: {}, then: { M1: "ccw" } }).then).toBe("M1 girando no sentido anti-horário")
  })

  it("formats numeric ranges", () => {
    expect(scenarioLabel({ when: {}, then: { L1: { current: [0.03, 0.07] } } }).then).toBe("L1 com corrente entre 30,0 mA e 70,0 mA")
  })
})

import { resistorBands } from "../src/bench"
import { createFpsWatch } from "../src/parts3d"

describe("resistorBands", () => {
  it("encodes standard values", () => {
    expect(resistorBands(220)).toEqual(["red", "red", "brown", "gold"])
    expect(resistorBands(4700)).toEqual(["yellow", "violet", "red", "gold"])
    expect(resistorBands(22)).toEqual(["red", "red", "black", "gold"])
    expect(resistorBands(10000)).toEqual(["brown", "black", "orange", "gold"])
    expect(resistorBands(330)).toEqual(["orange", "orange", "brown", "gold"])
    expect(resistorBands(1000)).toEqual(["brown", "black", "red", "gold"])
    expect(resistorBands(100)).toEqual(["brown", "black", "brown", "gold"])
    expect(resistorBands(2.2)).toEqual(["red", "red", "gold", "gold"])
  })
})

import { warningText } from "../src/ui"

describe("warningText", () => {
  it("has text for every warning kind and never says burned", () => {
    const kinds = ["overcurrent", "shortCircuit", "ammeterParallel", "ohmmeterPowered", "floatingInput", "undefinedInput", "unpoweredChip", "unstable"] as const
    for (const kind of kinds) {
      const text = warningText({ kind, partId: "L1", pin: "1A" })
      expect(text, kind).toBeTruthy()
      expect(text!, kind).not.toMatch(/queim/i)
    }
  })
})

describe("scenarioLabel off words", () => {
  it("uses a word that fits each part", () => {
    expect(scenarioLabel({ when: {}, then: { M1: "off", Z1: "off", LED1: "off", L1: "off" } }).then).toBe("M1 parado, Z1 em silêncio, LED1 apagado, L1 apagada")
  })
})

import { vi } from "vitest"

describe("motion samplers", () => {
  it("spring starts at 0, ends at 1 and overshoots", () => {
    const s = sampleSpring()
    expect(s[0]).toBe(0)
    expect(s.at(-1)).toBeCloseTo(1, 3)
    expect(Math.max(...s)).toBeGreaterThan(1)
    expect(s.length).toBe(40)
  })

  it("bounce starts at 0, ends at 1 and never passes 1", () => {
    const b = sampleBounce()
    expect(b[0]).toBe(0)
    expect(b.at(-1)).toBeCloseTo(1, 3)
    expect(Math.max(...b)).toBeLessThanOrEqual(1.0001)
  })

  it("cssLinear formats a linear() easing", () => {
    expect(cssLinear([0, 0.5, 1])).toBe("linear(0, 0.5, 1)")
    expect(cssLinear([0, 0.33333, 1])).toBe("linear(0, 0.333, 1)")
  })

  it("reduced motion resolves helpers without animating", async () => {
    setReducedMotion(true)
    const el = { animate: vi.fn() } as unknown as HTMLElement
    await pop(el)
    await bounceLand(el)
    expect((el as unknown as { animate: ReturnType<typeof vi.fn> }).animate).not.toHaveBeenCalled()
    setReducedMotion(false)
  })
})

import { starLabel } from "../src/ui"

describe("starLabel", () => {
  it("names every star kind", () => {
    expect(starLabel({ kind: "solved" })).toBe("Resolver")
    expect(starLabel({ kind: "noDivergence" })).toBe("Esquema igual à montagem")
    expect(starLabel({ kind: "usedMeter", mode: "V" })).toBe("Medir com o multímetro (V)")
    expect(starLabel({ kind: "usedMeter", mode: "ohm" })).toBe("Medir com o multímetro (Ω)")
    expect(starLabel({ kind: "maxCost", value: 12 })).toBe("Custo até 12 créditos")
    expect(starLabel({ kind: "maxWires", value: 3 })).toBe("Até 3 fios")
  })
})

describe("createFpsWatch", () => {
  const opts = { warmupMs: 3000, windowMs: 2000, minFps: 40 }
  const run = (watch: ReturnType<typeof createFpsWatch>, from: number, to: number, stepMs: number) => {
    const out: string[] = []
    for (let t = from; t <= to; t += stepMs) out.push(watch.sample(t))
    return out
  }

  it("ignores slow frames during warmup", () => {
    const watch = createFpsWatch(opts)
    expect(run(watch, 0, 2990, 50)).not.toContain("degrade")
  })

  it("degrades once after a slow window", () => {
    const watch = createFpsWatch(opts)
    run(watch, 0, 3000, 16)
    const out = run(watch, 3050, 12000, 50)
    expect(out.filter((s) => s === "degrade")).toHaveLength(1)
  })

  it("stays ok with fast frames", () => {
    const watch = createFpsWatch(opts)
    expect(run(watch, 0, 12000, 16)).not.toContain("degrade")
  })

  it("does not count a hidden-tab pause as slowness", () => {
    const watch = createFpsWatch(opts)
    run(watch, 0, 5000, 16)
    const out = [...run(watch, 20000, 20100, 16), ...run(watch, 20116, 26000, 16)]
    expect(out).not.toContain("degrade")
  })
})

describe("createFpsWatch reset", () => {
  it("discards the slow window when the scene is rebuilt", () => {
    const watch = createFpsWatch({ warmupMs: 3000, windowMs: 2000, minFps: 40 })
    const out: string[] = []
    for (let t = 0; t <= 3000; t += 16) watch.sample(t)
    for (let t = 3050; t <= 9000; t += 50) {
      if (t % 1000 === 0) watch.reset()
      out.push(watch.sample(t))
    }
    expect(out).not.toContain("degrade")
  })
})

import { TOUR_STEPS } from "../src/screens"

describe("tour", () => {
  it("tour steps have six existing selectors and short copy", () => {
    expect(TOUR_STEPS).toHaveLength(6)
    expect(TOUR_STEPS.map((s) => s.target.split(",")[0])).toEqual([".phase-brief", ".tray-host", ".toolbar-host", ".view-toggle", ".topbar-host", "[data-tool=undo]"])
    for (const step of TOUR_STEPS) {
      expect(step.text.length).toBeLessThanOrEqual(140)
      expect(step.text).not.toMatch(/queimad/i)
      expect(step.title.length).toBeGreaterThan(0)
    }
  })
})

import { phaseLabel, setPhaseLabels } from "../src/ui"

describe("phaseLabel", () => {
  it("shows the daily repair by its date", () => {
    expect(phaseLabel("daily-2026-11-03")).toBe("03/11")
    expect(phaseLabel("g1p2")).toBe("g1p2")
  })

  it("uses the label from the data when there is one", () => {
    setPhaseLabels({ g2p7: "g2p4" })
    expect(phaseLabel("g2p7")).toBe("g2p4")
    expect(phaseLabel("g9p9")).toBe("g9p9")
    setPhaseLabels({})
  })
})

import { shownDivergences, trayCount } from "../src/ui"

describe("sandbox helpers", () => {
  const div: Divergence = { kind: "pending", partId: "L1", power: false, side: "blueprint" }
  const sandbox = { id: "sandbox", showDivergence: true, stars: [] as Star[] }
  const lesson = { id: "g1p1", showDivergence: true, stars: [{ kind: "solved" }] as Star[] }

  it("tray badge shows infinity", () => {
    expect(trayCount(Infinity)).toBe("∞")
    expect(trayCount(3)).toBe("3")
  })

  it("sandbox hides divergences while the blueprint is empty", () => {
    expect(shownDivergences(sandbox, 0, [div])).toEqual([])
  })

  it("sandbox shows divergences once the blueprint has a part", () => {
    expect(shownDivergences(sandbox, 1, [div])).toEqual([div])
  })

  it("phases with the noDivergence star always show divergences", () => {
    const phase = { ...lesson, stars: [{ kind: "solved" }, { kind: "noDivergence" }] as Star[] }
    expect(shownDivergences(phase, 0, [div])).toEqual([div])
  })

  it("a phase with an empty blueprint still shows divergences", () => {
    expect(shownDivergences(lesson, 0, [div])).toEqual([div])
  })

  it("respects phases that turn divergences off", () => {
    expect(shownDivergences({ ...lesson, showDivergence: false }, 2, [div])).toEqual([])
  })
})

import parts from "../data/parts.json"
import { splitParts } from "../src/netlist"
import type { PartsCatalog } from "../src/netlist"
import { formatValue as fmt, specRows, bandNames, partSketch } from "../src/ui"

describe("specRows", () => {
  const catalog = splitParts(parts).catalog

  it("led rows match the solver model", () => {
    const led = catalog.led
    expect(specRows("led", catalog)).toEqual([
      ["Queda de tensão", fmt((led.model as { vf: number }).vf, "V")],
      ["Corrente típica", fmt(led.thresholds!.nominal, "A")],
      ["Corrente máxima", fmt(led.thresholds!.maxCurrent, "A")],
    ])
  })

  it("resistor rows list every catalog value with bands", () => {
    const rows = specRows("resistor", catalog)
    for (const v of catalog.resistor.values!) expect(rows).toContainEqual([fmt(v, "Ω"), bandNames(v).join(" · ")])
    expect(bandNames(220)).toEqual(["vermelho", "vermelho", "marrom", "dourado"])
    expect(rows[0][1]).toBe(`${fmt(22, "Ω")} … ${fmt(10000, "Ω")}`)
  })

  it("multimeter rows show input resistances and OL", () => {
    const rows = specRows("multimeter", catalog)
    expect(rows[0]).toEqual(["Escala V", `${fmt(10_000_000, "Ω")} de entrada`])
    expect(rows[1]).toEqual(["Escala A", `${fmt(0.1, "Ω")} em série`])
    expect(rows[2]).toEqual(["OL", "fora da escala"])
  })

  it("every catalog part has spec rows", () => {
    for (const type of Object.keys(catalog)) expect(specRows(type, catalog).length, type).toBeGreaterThan(0)
  })
})

describe("partSketch", () => {
  const catalog = splitParts(parts).catalog

  it("sketch has a side view only where the shape changes", () => {
    for (const type of ["resistor", "led", "diode", "chip_and"]) expect(partSketch(type, catalog), type).toContain("sketch-side")
    for (const type of ["lamp", "battery"]) expect(partSketch(type, catalog), type).not.toContain("sketch-side")
  })

  it("sketch labels every pin", () => {
    for (const type of Object.keys(catalog)) {
      const group = partSketch(type, catalog).split('<g class="sketch-pins">')[1]
      expect((group.match(/<text /g) ?? []).length, type).toBe(catalog[type].pins.length)
    }
  })
})

describe("orderFrom", () => {
  it("tutorials always speak through the mentor", () => {
    expect(orderFrom("tutorial", { client: "Alguém" })).toBe(MENTOR)
    expect(orderFrom("tutorial", null)).toBe("Dona Neide, dona da oficina")
  })

  it("other phases use the client or the counter", () => {
    expect(orderFrom("repair", { client: "Seu Jorge, pescador" })).toBe("Seu Jorge, pescador")
    expect(orderFrom("order", {})).toBe("Cliente de balcão")
    expect(orderFrom("build", null)).toBe("Cliente de balcão")
  })
})

describe("meter display text", () => {
  it("matches the HUD rules", () => {
    expect(meterDisplayText("off", null, true)).toBe("")
    expect(meterDisplayText("V", null, true)).toBe("— —")
    expect(meterDisplayText("V", { mode: "V", value: 9, display: "value" }, false)).toBe("— —")
    expect(meterDisplayText("V", { mode: "V", value: null, display: "OL" }, true)).toBe("OL")
    expect(meterDisplayText("A", { mode: "A", value: null, display: "----" }, true)).toBe("----")
    expect(meterDisplayText("V", { mode: "V", value: 9, display: "value" }, true)).toBe(formatValue(9, "V"))
  })
})

import { nextGuideMode } from "../src/screens"

describe("step guide mode", () => {
  it("[RF 3] does not flicker when the target blinks out for a moment", () => {
    let s = nextGuideMode({ mode: "spot", missingSince: null }, false, 1000)
    expect(s.mode).toBe("spot")
    s = nextGuideMode(s, false, 1200)
    expect(s.mode).toBe("spot")
    s = nextGuideMode(s, false, 1300)
    expect(s.mode).toBe("bubble")
    expect(nextGuideMode(s, true, 1310)).toEqual({ mode: "spot", missingSince: null })
  })

  it("stays a bubble while the target is missing and comes back as soon as it shows", () => {
    let s = nextGuideMode({ mode: "bubble", missingSince: null }, false, 500)
    expect(s.mode).toBe("bubble")
    s = nextGuideMode(s, false, 5000)
    expect(s.mode).toBe("bubble")
    expect(nextGuideMode(s, true, 5016)).toEqual({ mode: "spot", missingSince: null })
  })

  it("a blink that ends before 250 ms never leaves the spotlight", () => {
    const gone = nextGuideMode({ mode: "spot", missingSince: null }, false, 100)
    expect(nextGuideMode(gone, true, 200)).toEqual({ mode: "spot", missingSince: null })
    expect(nextGuideMode({ mode: "spot", missingSince: null }, false, 300).mode).toBe("spot")
  })
})

describe("condition label", () => {
  it("reads like the scenario label", () => {
    expect(conditionLabel("L1", "lit")).toBe("L1 acesa")
    expect(conditionLabel("M1", "off")).toBe("M1 parado")
  })
})

describe("checklist groups", () => {
  it("groups lines by scenario, with a readable header only when there is a when", () => {
    const expectList: { when: Record<string, string>; then: Record<string, string> }[] = [
      { when: { S1: "on" }, then: { L1: "lit" } },
      { when: {}, then: { L1: "off", M1: "off" } },
    ]
    const lines = [
      { scenario: 0, partId: "L1", value: "lit", ok: true, negative: false },
      { scenario: 1, partId: "L1", value: "off", ok: false, negative: true },
      { scenario: 1, partId: "M1", value: "off", ok: false, negative: true },
    ]
    expect(checklistGroups(expectList, lines)).toEqual([
      { scenario: 0, when: "S1 ligada", conditions: [{ label: "L1 acesa", ok: true }] },
      { scenario: 1, when: "", conditions: [{ label: "L1 apagada", ok: false }, { label: "M1 parado", ok: false }] },
    ])
  })

  it("keeps the panel title capitalization for the goal", () => {
    expect(sentenceCase("montar na protoboard o que foi desenhado")).toBe("Montar na protoboard o que foi desenhado")
    expect(sentenceCase("")).toBe("")
  })
})
