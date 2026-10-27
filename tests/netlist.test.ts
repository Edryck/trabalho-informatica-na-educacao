import { describe, it, expect } from "vitest"
import parts from "../data/parts.json"
import { splitParts } from "../src/netlist"
import { stripOf, benchToNetlist, blueprintToNetlist, collapse, compare } from "../src/netlist"
import type { Link, NetPart, Netlist, PartsCatalog } from "../src/netlist"
import { emptyDoc } from "../src/state"
import type { CircuitDoc, Instance } from "../src/state"

const catalog = splitParts(parts).catalog

type DocPatch = {
  instances?: Instance[]
  blueprint?: Partial<CircuitDoc["blueprint"]>
  bench?: Partial<CircuitDoc["bench"]>
}

function docWith(partial: DocPatch): CircuitDoc {
  const base = emptyDoc()
  return {
    ...base,
    instances: partial.instances ?? base.instances,
    blueprint: { ...base.blueprint, ...partial.blueprint },
    bench: { ...base.bench, ...partial.bench },
  }
}

function inst(id: string, type: string, value = 0): Instance {
  return { id, type, value, actualValue: value }
}

function twoResistors(holesA: string, holesB: string, wires: CircuitDoc["bench"]["wires"] = []) {
  return docWith({
    instances: [inst("R1", "resistor", 220), inst("R2", "resistor", 220)],
    bench: {
      placements: [
        { id: "R1", rotation: 0, holes: { a: holesA, b: null } },
        { id: "R2", rotation: 0, holes: { a: holesB, b: null } },
      ],
      wires,
    },
  })
}

describe("parts catalog", () => {
  it("has symbol pins for every pin", () => {
    expect(Object.keys(catalog)).toContain("lamp")
    for (const [key, def] of Object.entries(catalog)) {
      for (const pin of def.pins) expect(def.symbolPins[pin], `${key}.${pin}`).toBeDefined()
      if (def.placement === "rigid") expect(def.footprint?.length, key).toBe(def.pins.length)
    }
  })
})

describe("stripOf", () => {
  it("maps both halves and rails", () => {
    expect(stripOf("A12")).toBe("c12-top")
    expect(stripOf("E12")).toBe("c12-top")
    expect(stripOf("F12")).toBe("c12-bot")
    expect(stripOf("J1")).toBe("c1-bot")
    expect(stripOf("T+5")).toBe("rail-T+")
    expect(stripOf("B-30")).toBe("rail-B-")
    expect(stripOf("K3")).toBeNull()
    expect(stripOf("A31")).toBeNull()
  })
})

describe("benchToNetlist", () => {
  it("same strip joins", () => {
    const nodes = collapse(benchToNetlist(twoResistors("A3", "C3"), catalog))
    expect(nodes.get("R1.a")).toBe(nodes.get("R2.a"))
  })

  it("channel separates", () => {
    const nodes = collapse(benchToNetlist(twoResistors("E3", "F3"), catalog))
    expect(nodes.get("R1.a")).not.toBe(nodes.get("R2.a"))
  })

  it("rail is continuous", () => {
    const nodes = collapse(benchToNetlist(twoResistors("T+1", "T+30"), catalog))
    expect(nodes.get("R1.a")).toBe(nodes.get("R2.a"))
  })

  it("wire joins strips", () => {
    const doc = twoResistors("A3", "A9", [{ id: "w1", a: "C3", b: "C9", color: "red" }])
    const nodes = collapse(benchToNetlist(doc, catalog))
    expect(nodes.get("R1.a")).toBe(nodes.get("R2.a"))
  })

  it("degenerate wire ignored", () => {
    const doc = twoResistors("A3", "A9", [{ id: "w1", a: "C3", b: "C3", color: "red" }])
    const net = benchToNetlist(doc, catalog)
    expect(net.links.filter((l) => l.kind === "wire")).toEqual([])
  })

  it("offboard lead", () => {
    const doc = docWith({
      instances: [inst("L1", "lamp")],
      bench: { placements: [{ id: "L1", rotation: 0, holes: { a: "A3", b: null } }] },
    })
    const net = benchToNetlist(doc, catalog)
    expect(net.links.some((l) => l.kind === "lead" && l.a === "p:L1.a" && l.b === "h:A3")).toBe(true)
    expect(net.pinAt["L1.b"]).toBe("p:L1.b")
  })

  it("value comes from actualValue on bench", () => {
    const doc = docWith({
      instances: [{ id: "R1", type: "resistor", value: 220, actualValue: 2200 }],
      bench: { placements: [{ id: "R1", rotation: 0, holes: { a: "A3", b: "A7" } }] },
    })
    expect(benchToNetlist(doc, catalog).parts[0].value).toBe(2200)
  })

  it("strip links chain consecutive holes", () => {
    const doc = docWith({
      instances: [inst("R1", "resistor", 220), inst("R2", "resistor", 220), inst("R3", "resistor", 220)],
      bench: {
        placements: [
          { id: "R1", rotation: 0, holes: { a: "A3", b: null } },
          { id: "R2", rotation: 0, holes: { a: "C3", b: null } },
          { id: "R3", rotation: 0, holes: { a: "E3", b: null } },
        ],
      },
    })
    const strips = benchToNetlist(doc, catalog).links.filter((l) => l.kind === "strip")
    expect(strips.map((l) => l.id)).toEqual(["s:A3-C3", "s:C3-E3"])
  })

  it("meter tips join the strips they touch", () => {
    const doc = docWith({
      instances: [inst("R1", "resistor", 220)],
      bench: {
        placements: [{ id: "R1", rotation: 0, holes: { a: "A3", b: "A7" } }],
        meter: { mode: "V", red: "C3", black: null },
      },
    })
    const net = benchToNetlist(doc, catalog)
    const nodes = collapse(net)
    expect(nodes.get("METER.red")).toBe(nodes.get("R1.a"))
    expect(net.pinAt["METER.black"]).toBe("p:METER.black")
    expect(net.parts.find((p) => p.id === "METER")).toEqual({
      id: "METER", type: "multimeter", value: 0, inputState: "V", isTool: true,
    })
  })

  it("instances without bench placement stay out", () => {
    const doc = docWith({ instances: [inst("R1", "resistor", 220)] })
    expect(benchToNetlist(doc, catalog).parts).toEqual([])
  })
})

describe("blueprintToNetlist", () => {
  const horizontal = { id: "s1", x1: 0, y1: 0, x2: 10, y2: 0 }

  function bp(segments: CircuitDoc["blueprint"]["segments"], placements: CircuitDoc["blueprint"]["placements"]) {
    return docWith({
      instances: placements.map((p) => inst(p.id, "resistor", 220)),
      blueprint: { placements, segments },
    })
  }

  it("crossing without junction does not connect", () => {
    const doc = bp(
      [horizontal, { id: "s2", x1: 5, y1: -5, x2: 5, y2: 5 }],
      [
        { id: "R1", x: 2, y: 0, rotation: 0 },
        { id: "R2", x: 7, y: -5, rotation: 0 },
      ],
    )
    const nodes = collapse(blueprintToNetlist(doc, catalog))
    expect(nodes.get("R1.a")).not.toBe(nodes.get("R2.a"))
  })

  it("T junction connects", () => {
    const doc = bp(
      [horizontal, { id: "s2", x1: 5, y1: -5, x2: 5, y2: 0 }],
      [
        { id: "R1", x: 2, y: 0, rotation: 0 },
        { id: "R2", x: 7, y: -5, rotation: 0 },
      ],
    )
    const nodes = collapse(blueprintToNetlist(doc, catalog))
    expect(nodes.get("R1.a")).toBe(nodes.get("R2.a"))
  })

  it("collinear overlap merges", () => {
    const doc = bp(
      [{ id: "s1", x1: 0, y1: 0, x2: 6, y2: 0 }, { id: "s2", x1: 4, y1: 0, x2: 10, y2: 0 }],
      [
        { id: "R1", x: 2, y: 0, rotation: 0 },
        { id: "R2", x: 8, y: 0, rotation: 0 },
      ],
    )
    const net = blueprintToNetlist(doc, catalog)
    const keys = net.links.map((l) => [l.a, l.b].sort().join("|"))
    expect(new Set(keys).size).toBe(keys.length)
    const nodes = collapse(net)
    expect(nodes.get("R1.a")).toBe(nodes.get("R2.b"))
  })

  it("zero length segment ignored", () => {
    const doc = bp([{ id: "s1", x1: 3, y1: 3, x2: 3, y2: 3 }], [])
    expect(blueprintToNetlist(doc, catalog).links).toEqual([])
  })

  it("rotation moves pins", () => {
    const doc = bp([], [{ id: "R1", x: 10, y: 10, rotation: 90 }])
    const net = blueprintToNetlist(doc, catalog)
    expect(net.pinAt["R1.a"]).toBe("g:10,8")
    expect(net.pinAt["R1.b"]).toBe("g:10,12")
  })

  it("value comes from spec value on blueprint", () => {
    const doc = docWith({
      instances: [{ id: "R1", type: "resistor", value: 220, actualValue: 2200 }],
      blueprint: { placements: [{ id: "R1", x: 0, y: 0, rotation: 0 }], segments: [] },
    })
    expect(blueprintToNetlist(doc, catalog).parts[0].value).toBe(220)
  })
})

describe("compare", () => {
  const part = (id: string, type: string, value = 0, extra: Partial<NetPart> = {}): NetPart => ({ id, type, value, ...extra })
  const wire = (a: string, b: string): Link => ({ id: `${a}-${b}`, a, b, kind: "wire" })
  const loop = (overrides: { lampB?: string; r1Value?: number; extraParts?: NetPart[]; extraPins?: Record<string, string> } = {}): Netlist => ({
    parts: [part("B1", "battery", 9), part("L1", "lamp"), part("R1", "resistor", overrides.r1Value ?? 220), ...(overrides.extraParts ?? [])],
    links: [wire("p", "q")],
    pinAt: {
      "B1.+": "p",
      "L1.a": "q",
      "L1.b": overrides.lampB ?? "m",
      "R1.a": "m",
      "R1.b": "n",
      "B1.-": "n",
      ...(overrides.extraPins ?? {}),
    },
  })

  it("identical circuits have no divergence", () => {
    expect(compare(loop(), loop(), catalog)).toEqual([])
  })

  it("reports wiring with expected and actual neighbors", () => {
    const d = compare(loop(), loop({ lampB: "x" }), catalog)
    const lamp = d.find((x) => x.partId === "L1" && x.pin === "b")
    expect(lamp).toMatchObject({ kind: "wiring", partId: "L1", pin: "b", expected: ["R1.a"], actual: [] })
  })

  it("reports value mismatch", () => {
    const d = compare(loop(), loop({ r1Value: 2200 }), catalog)
    expect(d).toEqual([{ kind: "value", partId: "R1", power: false, specValue: 220, actualValue: 2200 }])
  })

  it("reports pending on the missing side", () => {
    const blueprint = loop({ extraParts: [part("L2", "lamp")], extraPins: { "L2.a": "y1", "L2.b": "y2" } })
    const d = compare(blueprint, loop(), catalog)
    expect(d).toContainEqual({ kind: "pending", partId: "L2", power: false, side: "bench" })
  })

  it("power divergences come first", () => {
    const bench = loop({ lampB: "x" })
    bench.pinAt["B1.-"] = "z"
    bench.pinAt["R1.b"] = "n"
    const d = compare(loop(), bench, catalog)
    expect(d[0].power).toBe(true)
    expect(d.some((x) => !x.power)).toBe(true)
  })

  it("ignores tools", () => {
    const bench = loop({ extraParts: [part("METER", "multimeter", 0, { isTool: true, inputState: "V" })], extraPins: { "METER.red": "m", "METER.black": "n" } })
    expect(compare(loop(), bench, catalog)).toEqual([])
  })

  it("unplugged lead counts as wiring", () => {
    const bench = loop({ lampB: "p:L1.b" })
    const d = compare(loop(), bench, catalog)
    expect(d).toContainEqual(expect.objectContaining({ kind: "wiring", partId: "L1", pin: "b", actual: [] }))
  })

  it("value divergence comes after wiring and before pending", () => {
    const blueprint = loop({ extraParts: [part("L2", "lamp")], extraPins: { "L2.a": "y1", "L2.b": "y2" } })
    const bench = loop({ lampB: "x", r1Value: 2200 })
    const kinds = compare(blueprint, bench, catalog).filter((x) => !x.power).map((x) => x.kind)
    expect(kinds.indexOf("wiring")).toBeLessThan(kinds.indexOf("value"))
    expect(kinds.indexOf("value")).toBeLessThan(kinds.indexOf("pending"))
  })
})

describe("wire look", () => {
  it("never changes the netlist", () => {
    const d = emptyDoc()
    d.instances.push({ id: "B1", type: "battery", value: 9, actualValue: 9 }, { id: "L1", type: "lamp", value: 0, actualValue: 0 })
    d.bench.placements.push(
      { id: "B1", rotation: 0, offboard: { x: -75, z: -10 }, holes: { "+": "T+3", "-": "T-3" } },
      { id: "L1", rotation: 0, offboard: { x: 0, z: -55 }, holes: { a: "A14", b: "A18" } },
    )
    d.bench.wires.push({ id: "W1", a: "T+14", b: "B14", color: "#C62828" })
    const styled = structuredClone(d)
    styled.bench.wires[0] = { ...styled.bench.wires[0], style: "angle", mid: { x: 3, z: -4 }, color: "#22C55E" }
    expect(benchToNetlist(styled, catalog)).toEqual(benchToNetlist(d, catalog))
  })
})
