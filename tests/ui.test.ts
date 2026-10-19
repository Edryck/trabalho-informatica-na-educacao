import { describe, it, expect } from "vitest"
import { divergenceLabel, formatValue, particleSpeed, scenarioLabel, visibleDivergences } from "../src/ui"
import type { Divergence } from "../src/netlist"

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
