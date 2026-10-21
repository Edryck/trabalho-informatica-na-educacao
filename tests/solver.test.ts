import { describe, it, expect } from "vitest"
import parts from "../data/parts.json"
import { solve, INITIAL_DISCRETE, MAX_PASSES } from "../src/solver"
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

describe("logic chips", () => {
  const chip = (id: string, type: string): NetPart => ({ id, type, value: 0 })
  const probe = (id: string): NetPart => ({ id, type: "logic_probe", value: 0, isTool: true })

  function chipBench(type: string, inputs: Record<string, 0 | 1>, output = "1Y") {
    const pinAt: Record<string, string> = { "B1.+": "vcc", "B1.-": "gnd", "U1.VCC": "vcc", "U1.GND": "gnd", [`U1.${output}`]: "out", "P1.IN": "out", "P1.GND": "gnd" }
    for (const [pin, level] of Object.entries(inputs)) pinAt[`U1.${pin}`] = level ? "vcc" : "gnd"
    return net([bat("B1", 5), chip("U1", type), probe("P1")], pinAt)
  }

  const tables: Record<string, number[]> = {
    chip_and: [0, 0, 0, 1],
    chip_or: [0, 1, 1, 1],
    chip_nand: [1, 1, 1, 0],
    chip_nor: [1, 0, 0, 0],
    chip_xor: [0, 1, 1, 0],
    chip_xnor: [1, 0, 0, 1],
  }
  for (const [type, out] of Object.entries(tables))
    it(`${type} truth table on real pinout`, () => {
      ;[[0, 0], [0, 1], [1, 0], [1, 1]].forEach(([a, b], i) => {
        const s = solve(chipBench(type, { "1A": a as 0 | 1, "1B": b as 0 | 1 }), catalog)
        expect(s.partState.P1, `${a}${b}`).toEqual({ kind: "probe", level: out[i] })
      })
    })

  it("chip_not inverts all six gates", () => {
    for (let n = 1; n <= 6; n++) {
      expect(solve(chipBench("chip_not", { [`${n}A`]: 0 }, `${n}Y`), catalog).partState.P1).toEqual({ kind: "probe", level: 1 })
      expect(solve(chipBench("chip_not", { [`${n}A`]: 1 }, `${n}Y`), catalog).partState.P1).toEqual({ kind: "probe", level: 0 })
    }
  })

  it("nor output is pin 1 and gates match the real pinout", () => {
    expect((parts as unknown as PartsCatalog).chip_nor.pins[0]).toBe("1Y")
    expect((parts as unknown as PartsCatalog).chip_and.pins.slice(0, 3)).toEqual(["1A", "1B", "1Y"])
    expect((parts as unknown as PartsCatalog).chip_not.pins[6]).toBe("GND")
    expect((parts as unknown as PartsCatalog).chip_not.pins[13]).toBe("VCC")
  })

  it("floating input is undefined and warns", () => {
    const s = solve(chipBench("chip_and", { "1A": 1 }), catalog)
    expect(s.partState.P1).toEqual({ kind: "probe", level: "undefined" })
    expect(s.warnings).toContainEqual({ kind: "floatingInput", partId: "U1", pin: "1B" })
  })

  it("forbidden zone is undefined and warns", () => {
    const n = chipBench("chip_and", { "1A": 1 })
    n.parts.push(r("R1", 1000), r("R2", 390))
    n.pinAt["R1.a"] = "vcc"
    n.pinAt["R1.b"] = "mid"
    n.pinAt["R2.a"] = "mid"
    n.pinAt["R2.b"] = "gnd"
    n.pinAt["U1.1B"] = "mid"
    const s = solve(n, catalog)
    expect(s.partState.P1).toEqual({ kind: "probe", level: "undefined" })
    expect(s.warnings).toContainEqual({ kind: "undefinedInput", partId: "U1", pin: "1B" })
  })

  it("unpowered chip outputs hiz and warns", () => {
    const n = chipBench("chip_and", { "1A": 1, "1B": 1 })
    n.pinAt["U1.VCC"] = "nowhere"
    const s = solve(n, catalog)
    expect(s.partState.U1).toMatchObject({ kind: "logic", powered: false, outputs: { "1Y": "hiz" } })
    expect(s.warnings).toContainEqual({ kind: "unpoweredChip", partId: "U1" })
  })

  it("reads levels relative to the chip ground", () => {
    const pinAt = {
      "B1.+": "mid",
      "B1.-": "gnd",
      "B2.+": "top",
      "B2.-": "mid",
      "U1.VCC": "top",
      "U1.GND": "mid",
      "U1.1A": "mid",
      "U1.1B": "top",
      "U1.1Y": "out",
      "P1.IN": "out",
      "P1.GND": "mid",
    }
    const s = solve(net([bat("B1", 5), bat("B2", 5), chip("U1", "chip_and"), probe("P1")], pinAt), catalog)
    expect(s.partState.P1).toEqual({ kind: "probe", level: 0 })
  })

  it("inverter feedback is unstable by cycle", () => {
    const pinAt = { "B1.+": "vcc", "B1.-": "gnd", "U1.VCC": "vcc", "U1.GND": "gnd", "U1.1A": "loop", "U1.1Y": "loop" }
    const s = solve(net([bat("B1", 5), chip("U1", "chip_not")], pinAt), catalog)
    expect(s.status).toBe("unstable")
    expect(s.passes).toBeLessThan(MAX_PASSES)
    expect(s.warnings).toContainEqual({ kind: "unstable" })
  })

  it("returned discrete state matches the solved voltages when unstable", () => {
    const pinAt = { "B1.+": "vcc", "B1.-": "gnd", "U1.VCC": "vcc", "U1.GND": "gnd", "U1.1A": "loop", "U1.1Y": "loop" }
    const s = solve(net([bat("B1", 5), chip("U1", "chip_not")], pinAt), catalog)
    const high = s.voltages.loop > 2.5
    expect(s.discrete.outputs["U1.1Y"]).toBe(high ? 1 : 0)
  })

  it("chained gates settle", () => {
    const pinAt = { "B1.+": "vcc", "B1.-": "gnd", "U1.VCC": "vcc", "U1.GND": "gnd", "U1.1A": "vcc", "U1.1Y": "x", "U1.2A": "x", "U1.2Y": "out", "P1.IN": "out", "P1.GND": "gnd" }
    const s = solve(net([bat("B1", 5), chip("U1", "chip_not"), probe("P1")], pinAt), catalog)
    expect(s.status).toBe("ok")
    expect(s.partState.P1).toEqual({ kind: "probe", level: 1 })
  })

  it("chip output drives a lamp", () => {
    const pinAt = { "B1.+": "vcc", "B1.-": "gnd", "U1.VCC": "vcc", "U1.GND": "gnd", "U1.1A": "vcc", "U1.1B": "vcc", "U1.1Y": "out", "L1.a": "out", "L1.b": "gnd" }
    const s = solve(net([bat("B1", 5), chip("U1", "chip_and"), lamp("L1")], pinAt), catalog)
    expect(s.partState.L1).toMatchObject({ kind: "lamp", lit: true })
    expect(s.partCurrent.L1).toBeCloseTo(5 / (90 + 50 + 0.2), 3)
  })

  it("logic switch sets the level", () => {
    const ls = (state: string): NetPart => ({ id: "SW1", type: "logic_switch", value: 0, inputState: state })
    const pinAt = { "B1.+": "vcc", "B1.-": "gnd", "SW1.VCC": "vcc", "SW1.GND": "gnd", "SW1.OUT": "out", "P1.IN": "out", "P1.GND": "gnd" }
    expect(solve(net([bat("B1", 5), ls("1"), probe("P1")], pinAt), catalog).partState.P1).toEqual({ kind: "probe", level: 1 })
    expect(solve(net([bat("B1", 5), ls("0"), probe("P1")], pinAt), catalog).partState.P1).toEqual({ kind: "probe", level: 0 })
    expect(solve(net([bat("B1", 5), ls("0"), probe("P1")], pinAt), catalog, { overrides: { SW1: "1" } }).partState.P1).toEqual({ kind: "probe", level: 1 })
  })

  it("probe on nothing shows undefined", () => {
    const s = solve(net([bat("B1", 5), probe("P1")], { "B1.+": "vcc", "B1.-": "gnd", "P1.IN": "alone", "P1.GND": "gnd" }), catalog)
    expect(s.partState.P1).toEqual({ kind: "probe", level: "undefined" })
  })
})

describe("multimeter", () => {
  const meter = (mode: string): NetPart => ({ id: "METER", type: "multimeter", value: 0, inputState: mode, isTool: true })

  it("voltmeter on a 1k divider reads within 0.1%", () => {
    const ideal = (9 * 1000) / 2000.2
    const pinAt = { "B1.+": "p", "R1.a": "p", "R1.b": "m", "R2.a": "m", "R2.b": "n", "B1.-": "n", "METER.red": "m", "METER.black": "n" }
    const s = solve(net([bat("B1"), r("R1", 1000), r("R2", 1000), meter("V")], pinAt), catalog)
    expect(s.meter?.mode).toBe("V")
    expect(s.meter?.display).toBe("value")
    expect(Math.abs(s.meter!.value! - ideal) / ideal).toBeLessThan(0.001)
  })

  it("ammeter in series reads the loop current", () => {
    const pinAt = { "B1.+": "p", "METER.red": "p", "METER.black": "q", "L1.a": "q", "L1.b": "n", "B1.-": "n" }
    const s = solve(net([bat("B1"), lamp("L1"), meter("A")], pinAt), catalog)
    expect(s.meter!.value!).toBeCloseTo(9 / (90 + 0.2 + 0.1), 4)
    expect(s.partState.L1).toMatchObject({ lit: true })
  })

  it("ammeter across the battery shows OL and warns, nothing burns", () => {
    const pinAt = { "B1.+": "p", "B1.-": "n", "METER.red": "p", "METER.black": "n" }
    const s = solve(net([bat("B1"), meter("A")], pinAt), catalog)
    expect(s.meter).toEqual({ mode: "A", value: null, display: "OL" })
    expect(s.warnings).toContainEqual({ kind: "ammeterParallel" })
    expect(s.status).toBe("ok")
    expect(Math.abs(s.partCurrent.B1)).toBeGreaterThan(2)
  })

  it("ohmmeter reads an isolated resistor", () => {
    const s = solve(net([r("R1", 2200), meter("ohm")], { "R1.a": "x", "R1.b": "y", "METER.red": "x", "METER.black": "y" }), catalog)
    expect(s.meter?.display).toBe("value")
    expect(s.meter!.value!).toBeCloseTo(2200, 0)
  })

  it("ohmmeter reads a parallel pair with the battery off", () => {
    const pinAt = { "B1.+": "x", "B1.-": "y", "R1.a": "x", "R1.b": "y", "R2.a": "x", "R2.b": "y", "METER.red": "x", "METER.black": "y" }
    const s = solve(net([{ ...bat("B1"), inputState: "off" }, r("R1", 1000), r("R2", 1000), meter("ohm")], pinAt), catalog)
    expect(s.meter!.value!).toBeCloseTo(500, 0)
  })

  it("ohmmeter above 3 kOhm shows OL", () => {
    const s = solve(net([r("R1", 4700), meter("ohm")], { "R1.a": "x", "R1.b": "y", "METER.red": "x", "METER.black": "y" }), catalog)
    expect(s.meter).toEqual({ mode: "ohm", value: null, display: "OL" })
  })

  it("ohmmeter on an open circuit shows OL", () => {
    const s = solve(net([meter("ohm")], { "METER.red": "x", "METER.black": "y" }), catalog)
    expect(s.meter).toEqual({ mode: "ohm", value: null, display: "OL" })
  })

  it("ohmmeter with a powered loop shows dashes and warns", () => {
    const pinAt = { "B1.+": "x", "B1.-": "y", "R1.a": "x", "R1.b": "y", "METER.red": "x", "METER.black": "y" }
    const s = solve(net([bat("B1"), r("R1", 1000), meter("ohm")], pinAt), catalog)
    expect(s.meter).toEqual({ mode: "ohm", value: null, display: "----" })
    expect(s.warnings).toContainEqual({ kind: "ohmmeterPowered" })
  })

  it("zero ohm resistor behaves as a short", () => {
    const pinAt = { "B1.+": "p", "R1.a": "p", "R1.b": "q", "L1.a": "q", "L1.b": "n", "B1.-": "n" }
    const s = solve(net([bat("B1"), r("R1", 0), lamp("L1")], pinAt), catalog)
    expect(s.partCurrent.L1).toBeCloseTo(9 / (90 + 0.2 + 0.001), 4)
  })
})

describe("driven lines", () => {
  const chip = (id: string, type: string): NetPart => ({ id, type, value: 0 })
  const probe = (id: string): NetPart => ({ id, type: "logic_probe", value: 0, isTool: true })
  const ls = (state: string): NetPart => ({ id: "SW1", type: "logic_switch", value: 0, inputState: state })
  const base = (): Record<string, string> => ({
    "B1.+": "vcc",
    "B1.-": "gnd",
    "U1.VCC": "vcc",
    "U1.GND": "gnd",
    "SW1.VCC": "vcc",
    "SW1.GND": "gnd",
    "SW1.OUT": "in",
    "U1.1A": "in",
    "U1.1Y": "out",
    "P1.IN": "out",
    "P1.GND": "gnd",
  })

  it("logic switch without its ground wire leaves the input undefined at 0", () => {
    const pinAt = { ...base(), "SW1.GND": "loose" }
    const s = solve(net([bat("B1", 5), chip("U1", "chip_not"), ls("0"), probe("P1")], pinAt), catalog)
    expect(s.partState.P1).toEqual({ kind: "probe", level: "undefined" })
  })

  it("chip without its ground wire is not powered", () => {
    const pinAt = { ...base(), "U1.GND": "loose" }
    const s = solve(net([bat("B1", 5), chip("U1", "chip_not"), ls("0"), probe("P1")], pinAt), catalog)
    expect(s.partState.U1).toMatchObject({ kind: "logic", powered: false })
    expect(s.partState.P1).toEqual({ kind: "probe", level: "undefined" })
  })

  it("probe with its ground lead loose reads undefined", () => {
    const pinAt = { ...base(), "P1.GND": "loose" }
    const s = solve(net([bat("B1", 5), chip("U1", "chip_not"), ls("0"), probe("P1")], pinAt), catalog)
    expect(s.partState.P1).toEqual({ kind: "probe", level: "undefined" })
  })

  it("fully wired circuit still reads normally", () => {
    const s = solve(net([bat("B1", 5), chip("U1", "chip_not"), ls("0"), probe("P1")], base()), catalog)
    expect(s.partState.P1).toEqual({ kind: "probe", level: 1 })
  })

  it("ammeter in series with a chip input still drives it", () => {
    const meter: NetPart = { id: "METER", type: "multimeter", value: 0, inputState: "A", isTool: true }
    const pinAt = { ...base(), "SW1.OUT": "sw", "METER.red": "sw", "METER.black": "in" }
    const s = solve(net([bat("B1", 5), chip("U1", "chip_not"), ls("1"), probe("P1"), meter], pinAt), catalog)
    expect(s.partState.P1).toEqual({ kind: "probe", level: 0 })
  })

  it("battery switched off leaves logic undefined", () => {
    const s = solve(net([{ ...bat("B1", 5), inputState: "off" }, chip("U1", "chip_not"), ls("0"), probe("P1")], base()), catalog)
    expect(s.partState.P1).toEqual({ kind: "probe", level: "undefined" })
  })
})

describe("diode", () => {
  function diodeCircuit(opts: { reversed?: boolean; load: NetPart }): Netlist {
    const pinAt: Record<string, string> = { "B1.+": "p", "B1.-": "n", [`${opts.load.id}.a`]: "q", [`${opts.load.id}.b`]: "n" }
    pinAt["D1.a"] = opts.reversed ? "q" : "p"
    pinAt["D1.k"] = opts.reversed ? "p" : "q"
    return net([bat("B1"), { id: "D1", type: "diode", value: 0 }, opts.load], pinAt)
  }

  it("diode conducts forward with a 0.7 V drop", () => {
    const s = solve(diodeCircuit({ load: r("R1", 1000) }), catalog)
    expect(Math.abs(s.partCurrent.D1)).toBeGreaterThan(0.0082)
    expect(Math.abs(s.partCurrent.D1)).toBeLessThan(0.0084)
    const drop = s.voltages.p - s.voltages.q
    expect(drop).toBeGreaterThan(0.69)
    expect(drop).toBeLessThan(0.72)
    expect(s.partState.D1).toMatchObject({ kind: "diode", conducting: true })
  })

  it("diode blocks reverse", () => {
    const s = solve(diodeCircuit({ reversed: true, load: r("R1", 1000) }), catalog)
    expect(Math.abs(s.partCurrent.D1)).toBeLessThan(1e-6)
    expect(s.partState.D1).toMatchObject({ kind: "diode", conducting: false })
  })

  it("diode in series with a lamp", () => {
    const forward = solve(diodeCircuit({ load: lamp("L1") }), catalog)
    const reverse = solve(diodeCircuit({ reversed: true, load: lamp("L1") }), catalog)
    expect(isLit(forward.partState.L1)).toBe(true)
    expect(isLit(reverse.partState.L1)).toBe(false)
  })
})
