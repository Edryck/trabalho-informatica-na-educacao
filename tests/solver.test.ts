import { describe, it, expect } from "vitest"
import parts from "../data/parts.json"
import { solve, INITIAL_DISCRETE } from "../src/solver"
import type { PartState } from "../src/solver"
import type { Link, NetPart, Netlist, PartsCatalog } from "../src/netlist"

const catalog = parts as unknown as PartsCatalog

function net(netParts: NetPart[], pinAt: Record<string, string>, links: Link[] = []): Netlist {
  return { parts: netParts, links, pinAt }
}

function bat(id: string, v = 9): NetPart {
  return { id, type: "battery", value: v }
}

function r(id: string, ohms: number): NetPart {
  return { id, type: "resistor", value: ohms }
}

function lamp(id: string): NetPart {
  return { id, type: "lamp", value: 0 }
}

function motor(id: string): NetPart {
  return { id, type: "dc_motor", value: 0 }
}

function buzzer(id: string): NetPart {
  return { id, type: "buzzer", value: 0 }
}

function sw(id: string, inputState?: string): NetPart {
  return { id, type: "switch", value: 0, inputState }
}

function button(id: string): NetPart {
  return { id, type: "push_button", value: 0 }
}

function wire(id: string, a: string, b: string): Link {
  return { id, a, b, kind: "wire" }
}

function isLit(state: PartState | undefined): boolean {
  if (!state || (state.kind !== "lamp" && state.kind !== "led")) throw new Error("not a lamp")
  return state.lit
}

function noNaN(voltages: Record<string, number>) {
  for (const v of Object.values(voltages)) expect(Number.isNaN(v)).toBe(false)
}

describe("solve", () => {
  it("voltage divider", () => {
    const n = net([bat("B1"), r("R1", 1000), r("R2", 1000)],
      { "B1.+": "p", "R1.a": "p", "R1.b": "m", "R2.a": "m", "R2.b": "n", "B1.-": "n" })
    const s = solve(n, catalog)
    expect(s.voltages.m - s.voltages.n).toBeCloseTo(9 * 1000 / 2000.2, 6)
  })

  it("series lamps", () => {
    const n = net([bat("B1"), lamp("L1"), lamp("L2")],
      { "B1.+": "p", "L1.a": "p", "L1.b": "m", "L2.a": "m", "L2.b": "n", "B1.-": "n" })
    const s = solve(n, catalog)
    expect(s.partCurrent.L1).toBeCloseTo(9 / 180.2, 6)
    expect(Math.abs(s.partCurrent.L1 - s.partCurrent.L2)).toBeLessThan(1e-9)
  })

  it("parallel lamps", () => {
    const n = net([bat("B1"), lamp("L1"), lamp("L2")],
      { "B1.+": "p", "L1.a": "p", "L1.b": "n", "L2.a": "p", "L2.b": "n", "B1.-": "n" })
    const s = solve(n, catalog)
    expect(s.partCurrent.B1).toBeCloseTo(9 / 45.2, 6)
  })

  it("short circuit", () => {
    const n = net([bat("B1")], { "B1.+": "p", "B1.-": "n" }, [wire("w1", "p", "n")])
    const s = solve(n, catalog)
    expect(s.partCurrent.B1).toBeCloseTo(9 / 0.201, 3)
    expect(s.status).toBe("ok")
    expect(s.warnings).toContainEqual({ kind: "shortCircuit", partId: "B1" })
  })

  it("open circuit", () => {
    const n = net([bat("B1"), lamp("L1")], { "B1.+": "p", "L1.a": "p", "L1.b": "loose", "B1.-": "n" })
    const s = solve(n, catalog)
    expect(Math.abs(s.partCurrent.L1)).toBeLessThan(1e-9)
    expect(isLit(s.partState.L1)).toBe(false)
  })

  it("floating part resolves", () => {
    const n = net([r("R1", 1000)], { "R1.a": "x", "R1.b": "y" })
    const s = solve(n, catalog)
    noNaN(s.voltages)
  })

  it("two batteries in parallel", () => {
    const n = net([bat("B1"), bat("B2"), lamp("L1")],
      { "B1.+": "p", "B2.+": "p", "L1.a": "p", "L1.b": "n", "B1.-": "n", "B2.-": "n" })
    const s = solve(n, catalog)
    expect(s.voltages.p - s.voltages.n).toBeCloseTo(9 * 90 / 90.1, 6)
    expect(s.partCurrent.B1).toBeCloseTo(s.partCurrent.B2, 9)
    noNaN(s.voltages)
  })

  it("precision 1 mOhm with 1 MOhm", () => {
    const n = net([bat("B1"), r("R1", 1e6)],
      { "B1.+": "p", "R1.a": "q", "R1.b": "n", "B1.-": "n" }, [wire("w1", "p", "q")])
    const s = solve(n, catalog)
    const expected = 9 * 1e6 / (1e6 + 0.201)
    const v = s.voltages.q - s.voltages.n
    expect(Math.abs((v - expected) / expected)).toBeLessThan(1e-6)
  })

  it("no battery at all", () => {
    const n = net([lamp("L1")], { "L1.a": "x", "L1.b": "y" }, [wire("w1", "y", "x")])
    const s = solve(n, catalog)
    expect(s.status).toBe("ok")
    noNaN(s.voltages)
    for (const v of Object.values(s.voltages)) expect(v).toBe(0)
  })

  it("empty netlist", () => {
    const s = solve(net([], {}), catalog)
    expect(s.status).toBe("ok")
    expect(s.voltages).toEqual({})
  })

  it("motor direction", () => {
    const forward = solve(net([bat("B1"), motor("M1")],
      { "B1.+": "p", "M1.+": "p", "M1.-": "n", "B1.-": "n" }), catalog)
    expect(forward.partState.M1).toEqual({ kind: "motor", spinning: true, direction: 1 })
    const backward = solve(net([bat("B1"), motor("M1")],
      { "B1.+": "p", "M1.-": "p", "M1.+": "n", "B1.-": "n" }), catalog)
    expect(backward.partState.M1).toEqual({ kind: "motor", spinning: true, direction: -1 })
  })

  it("buzzer is polarized", () => {
    const forward = solve(net([bat("B1"), buzzer("Z1")],
      { "B1.+": "p", "Z1.+": "p", "Z1.-": "n", "B1.-": "n" }), catalog)
    expect(forward.partState.Z1).toEqual({ kind: "buzzer", sounding: true })
    const reversed = solve(net([bat("B1"), buzzer("Z1")],
      { "B1.+": "p", "Z1.-": "p", "Z1.+": "n", "B1.-": "n" }), catalog)
    expect(reversed.partState.Z1).toEqual({ kind: "buzzer", sounding: false })
  })

  it("push button pairs", () => {
    const pair12 = net([bat("B1"), button("P1"), lamp("L1")],
      { "B1.+": "p", "P1.1": "p", "P1.2": "q", "L1.a": "q", "L1.b": "n", "B1.-": "n" })
    expect(isLit(solve(pair12, catalog).partState.L1)).toBe(true)

    const pair13 = net([bat("B1"), button("P1"), lamp("L1")],
      { "B1.+": "p", "P1.1": "p", "P1.3": "q", "L1.a": "q", "L1.b": "n", "B1.-": "n" })
    expect(isLit(solve(pair13, catalog).partState.L1)).toBe(false)
    expect(isLit(solve(pair13, catalog, { overrides: { P1: "pressed" } }).partState.L1)).toBe(true)
  })

  it("switch override", () => {
    const n = net([bat("B1"), sw("S1", "off"), lamp("L1")],
      { "B1.+": "p", "S1.a": "p", "S1.b": "q", "L1.a": "q", "L1.b": "n", "B1.-": "n" })
    expect(isLit(solve(n, catalog, { overrides: { S1: "on" } }).partState.L1)).toBe(true)
    expect(isLit(solve(n, catalog).partState.L1)).toBe(false)
  })

  it("battery off", () => {
    const n = net([{ ...bat("B1"), inputState: "off" }, lamp("L1")],
      { "B1.+": "p", "L1.a": "p", "L1.b": "n", "B1.-": "n" })
    expect(isLit(solve(n, catalog).partState.L1)).toBe(false)
  })

  it("fault open", () => {
    const n = net([bat("B1"), { ...lamp("L1"), fault: "open" }],
      { "B1.+": "p", "L1.a": "p", "L1.b": "n", "B1.-": "n" })
    expect(isLit(solve(n, catalog).partState.L1)).toBe(false)
  })

  it("fault short", () => {
    const n = net([bat("B1"), { ...lamp("L1"), fault: "short" }, lamp("L2")],
      { "B1.+": "p", "L1.a": "p", "L1.b": "m", "L2.a": "m", "L2.b": "n", "B1.-": "n" })
    expect(solve(n, catalog).partCurrent.L2).toBeCloseTo(9 / 90.201, 6)
  })

  it("weak battery", () => {
    const n = net([bat("B1", 6.1), lamp("L1")], { "B1.+": "p", "L1.a": "p", "L1.b": "n", "B1.-": "n" })
    expect(solve(n, catalog).partCurrent.L1).toBeCloseTo(6.1 / 90.2, 6)
  })

  it("link currents", () => {
    const n = net([bat("B1"), lamp("L1"), lamp("L2")],
      { "B1.+": "p", "L1.a": "p", "L1.b": "x", "L2.a": "y", "L2.b": "n", "B1.-": "n" },
      [wire("w1", "x", "y")])
    const s = solve(n, catalog)
    expect(s.linkCurrent.w1).toBeCloseTo(s.partCurrent.L1, 6)
  })
})

function led(id: string): NetPart {
  return { id, type: "led", value: 0 }
}

function ledCircuit(opts: { r?: number; reversed?: boolean; count?: number }): Netlist {
  const count = opts.count ?? 1
  const parts: NetPart[] = [bat("B1")]
  const pinAt: Record<string, string> = { "B1.+": "p", "B1.-": "n" }
  let prev = "p"
  if (opts.r !== undefined) {
    parts.push(r("R1", opts.r))
    pinAt["R1.a"] = "p"
    pinAt["R1.b"] = "q"
    prev = "q"
  }
  for (let i = 1; i <= count; i++) {
    const id = `LED${i}`
    const next = i === count ? "n" : `m${i}`
    parts.push(led(id))
    pinAt[`${id}.a`] = opts.reversed ? next : prev
    pinAt[`${id}.k`] = opts.reversed ? prev : next
    prev = next
  }
  return net(parts, pinAt)
}

describe("led", () => {
  it("led with resistor", () => {
    const s = solve(ledCircuit({ r: 330 }), catalog)
    expect(s.partCurrent.LED1).toBeCloseTo((9 - 2) / (330 + 5 + 0.2), 6)
    expect(s.partState.LED1).toMatchObject({ kind: "led", lit: true })
    expect(s.discrete.leds.LED1).toBe("on")
    expect(s.status).toBe("ok")
  })

  it("reversed led stays off", () => {
    const s = solve(ledCircuit({ r: 330, reversed: true }), catalog)
    expect(isLit(s.partState.LED1)).toBe(false)
    expect(Math.abs(s.partCurrent.LED1)).toBeLessThan(1e-6)
    expect(s.status).toBe("ok")
  })

  it("reversed led starting from on", () => {
    const s = solve(ledCircuit({ r: 330, reversed: true }), catalog, { previous: { leds: { LED1: "on" }, outputs: {} } })
    expect(s.discrete.leds.LED1).toBe("off")
    expect(s.status).toBe("ok")
    expect(s.passes).toBeGreaterThan(1)
  })

  it("led without resistor warns, does not burn", () => {
    const s = solve(ledCircuit({}), catalog)
    expect(isLit(s.partState.LED1)).toBe(true)
    expect(s.warnings).toContainEqual({ kind: "overcurrent", partId: "LED1" })
    expect(JSON.stringify(s)).not.toMatch(/burn/i)
  })

  it("two leds in series", () => {
    const s = solve(ledCircuit({ r: 330, count: 2 }), catalog)
    expect(s.partCurrent.LED1).toBeCloseTo((9 - 4) / (330 + 10 + 0.2), 6)
    expect(s.discrete.leds).toEqual({ LED1: "on", LED2: "on" })
  })

  it("led open and short faults", () => {
    const open = ledCircuit({ r: 330 })
    open.parts[2] = { ...open.parts[2], fault: "open" }
    const so = solve(open, catalog)
    expect(isLit(so.partState.LED1)).toBe(false)
    expect(so.partCurrent.LED1).toBe(0)
    const short = ledCircuit({ r: 330 })
    short.parts[2] = { ...short.parts[2], fault: "short" }
    const ss = solve(short, catalog)
    expect(isLit(ss.partState.LED1)).toBe(false)
    expect(ss.partCurrent.LED1).toBe(0)
    expect(ss.partCurrent.R1).toBeCloseTo(9 / (330 + 0.201), 4)
  })

  it("initial discrete state is empty", () => {
    expect(INITIAL_DISCRETE).toEqual({ leds: {}, outputs: {} })
  })
})
