import { describe, it, expect } from "vitest"
import { formatValue, particleSpeed } from "../src/ui"

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
