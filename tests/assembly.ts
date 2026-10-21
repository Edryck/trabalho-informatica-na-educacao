import { stripOf } from "../src/netlist"
import type { CircuitDoc } from "../src/state"

const COLUMNS = 30
const RAILS = ["T+", "T-", "B+", "B-"]

function allBenchHoles(): string[] {
  const holes: string[] = []
  for (let col = 1; col <= COLUMNS; col++) {
    for (const row of "ABCDEFGHIJ") holes.push(`${row}${col}`)
    for (const rail of RAILS) holes.push(`${rail}${col}`)
  }
  return holes
}

function mapHoles(doc: CircuitDoc, fn: (hole: string) => string | null): CircuitDoc | null {
  const out = structuredClone(doc)
  for (const p of out.bench.placements)
    for (const [pin, hole] of Object.entries(p.holes)) {
      if (!hole) continue
      const next = fn(hole)
      if (next === null) return null
      p.holes[pin] = next
    }
  for (const w of out.bench.wires) {
    const a = fn(w.a)
    const b = fn(w.b)
    if (a === null || b === null) return null
    w.a = a
    w.b = b
  }
  return out
}

export function shiftColumns(doc: CircuitDoc, k: number): CircuitDoc | null {
  return mapHoles(doc, (hole) => {
    const m = /^([A-J]|[TB][+-])(\d+)$/.exec(hole)
    if (!m) return null
    const col = Number(m[2]) + k
    return col >= 1 && col <= COLUMNS ? `${m[1]}${col}` : null
  })
}

export function withoutWire(doc: CircuitDoc, id: string): CircuitDoc {
  const out = structuredClone(doc)
  out.bench.wires = out.bench.wires.filter((w) => w.id !== id)
  return out
}

export function withResistor(doc: CircuitDoc, id: string, ohms: number): CircuitDoc {
  const out = structuredClone(doc)
  const instance = out.instances.find((i) => i.id === id)!
  instance.value = ohms
  instance.actualValue = ohms
  return out
}

export function flipped(doc: CircuitDoc, id: string): CircuitDoc {
  const out = structuredClone(doc)
  const p = out.bench.placements.find((x) => x.id === id)!
  p.holes = { a: p.holes.k ?? null, k: p.holes.a ?? null }
  return out
}

export function resistorAsWire(doc: CircuitDoc, id: string): CircuitDoc {
  const out = structuredClone(doc)
  const p = out.bench.placements.find((x) => x.id === id)!
  out.bench.placements = out.bench.placements.filter((x) => x.id !== id)
  out.bench.wires.push({ id: `WR${id}`, a: p.holes.a!, b: p.holes.b!, color: "#202020" })
  return out
}

export function movedWireEnds(doc: CircuitDoc): CircuitDoc {
  const out = structuredClone(doc)
  const used = new Set<string>([
    ...out.bench.placements.flatMap((p) => Object.values(p.holes).filter((h): h is string => !!h)),
    ...out.bench.wires.flatMap((w) => [w.a, w.b]),
  ])
  const holes = allBenchHoles()
  const another = (hole: string): string => {
    const strip = stripOf(hole)
    const next = holes.find((h) => h !== hole && stripOf(h) === strip && !used.has(h))
    if (!next) return hole
    used.delete(hole)
    used.add(next)
    return next
  }
  for (const w of out.bench.wires) {
    w.a = another(w.a)
    w.b = another(w.b)
  }
  return out
}
