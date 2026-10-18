import { describe, it, expect } from "vitest"
import parts from "../data/parts.json"
import type { PartsCatalog } from "../src/netlist"

const catalog = parts as unknown as PartsCatalog

describe("parts catalog", () => {
  it("has symbol pins for every pin", () => {
    expect(Object.keys(catalog)).toContain("lamp")
    for (const [key, def] of Object.entries(catalog)) {
      for (const pin of def.pins) expect(def.symbolPins[pin], `${key}.${pin}`).toBeDefined()
      if (def.placement === "rigid") expect(def.footprint?.length, key).toBe(def.pins.length)
    }
  })
})
