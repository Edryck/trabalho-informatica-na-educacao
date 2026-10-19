import { describe, it, expect } from "vitest"
import { createHistory, current, emptyDoc, nextInstanceId, pushSnapshot, redo, rewindTo, undo } from "../src/state"
import type { CircuitDoc, Instance } from "../src/state"

const inst = (id: string, type = "lamp"): Instance => ({ id, type, value: 0, actualValue: 0 })
const docWithIds = (ids: string[]): CircuitDoc => ({ ...emptyDoc(), instances: ids.map(id => inst(id)) })

describe("history", () => {
  it("caps at limit", () => {
    let h = createHistory(emptyDoc(), 3)
    for (let i = 0; i < 5; i++) h = pushSnapshot(h, docWithIds([`L${i}`]))
    expect(h.snapshots.length).toBe(3)
    expect(current(h).instances[0].id).toBe("L4")
  })

  it("push after undo drops the future", () => {
    const docA = docWithIds(["A1"])
    const docB = docWithIds(["B1"])
    const docC = docWithIds(["C1"])
    let h = pushSnapshot(pushSnapshot(createHistory(emptyDoc()), docA), docB)
    h = pushSnapshot(undo(h), docC)
    expect(redo(h)).toEqual(h)
    expect(current(h)).toEqual(docC)
  })

  it("undo and redo stop at the ends", () => {
    const h = createHistory(emptyDoc())
    expect(undo(h)).toEqual(h)
    expect(redo(h)).toEqual(h)
  })

  it("snapshots are independent copies", () => {
    const doc = docWithIds(["L1"])
    const h = pushSnapshot(createHistory(emptyDoc()), doc)
    doc.instances[0].id = "X9"
    expect(current(h).instances[0].id).toBe("L1")
  })

  it("rewinds to any index", () => {
    let h = createHistory(emptyDoc())
    h = pushSnapshot(h, docWithIds(["L1"]))
    h = pushSnapshot(h, docWithIds(["L2"]))
    expect(current(rewindTo(h, 1)).instances[0].id).toBe("L1")
    expect(rewindTo(h, 99).index).toBe(2)
  })
})

describe("nextInstanceId", () => {
  it("fills gaps", () => {
    expect(nextInstanceId(docWithIds(["L1", "L3"]), "L")).toBe("L2")
    expect(nextInstanceId(docWithIds([]), "B")).toBe("B1")
  })

  it("does not confuse prefixes", () => {
    expect(nextInstanceId(docWithIds(["LED1"]), "L")).toBe("L1")
  })
})

import { vi } from "vitest"
import parts from "../data/parts.json"
import type { PartsCatalog } from "../src/netlist"
import { createStore, defaultSave, isValidDoc, STORAGE_KEY } from "../src/state"

const catalog = parts as unknown as PartsCatalog

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}
const throwing = {
  getItem: (): string | null => {
    throw new Error("blocked")
  },
  setItem: (): void => {
    throw new Error("quota")
  },
}
const docWithType = (type: string): CircuitDoc => ({ ...emptyDoc(), instances: [inst("X1", type)] })

describe("store", () => {
  it("falls back to defaults on corrupted json", () => {
    const s = memory()
    s.setItem(STORAGE_KEY, "{oops")
    expect(createStore(s, catalog).data).toEqual(defaultSave())
  })

  it("resets another version and drops drafts with unknown parts", () => {
    const s = memory()
    s.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSave(), version: 2 }))
    expect(createStore(s, catalog).data).toEqual(defaultSave())
    s.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...defaultSave(), progress: { g0p1: { won: true, bestCost: null } }, draft: { phaseId: "g0p2", doc: docWithType("flux_capacitor") } }),
    )
    const st = createStore(s, catalog)
    expect(st.data.draft).toBeNull()
    expect(st.data.progress.g0p1.won).toBe(true)
  })

  it("keeps a valid draft", () => {
    const s = memory()
    s.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSave(), draft: { phaseId: "g0p2", doc: docWithType("lamp") } }))
    expect(createStore(s, catalog).data.draft?.phaseId).toBe("g0p2")
  })

  it("runs without storage when it throws", () => {
    const st = createStore(throwing, catalog)
    expect(st.available).toBe(false)
    expect(() => {
      st.save()
      st.saveDraftSoon("g0p1", emptyDoc())
      st.flush()
    }).not.toThrow()
  })

  it("runs without storage when there is none", () => {
    const st = createStore(null, catalog)
    expect(st.available).toBe(false)
    expect(st.data).toEqual(defaultSave())
  })

  it("debounces draft writes", () => {
    vi.useFakeTimers()
    const s = memory()
    const st = createStore(s, catalog)
    const spy = vi.spyOn(s, "setItem")
    st.saveDraftSoon("g0p1", emptyDoc())
    st.saveDraftSoon("g0p1", emptyDoc())
    vi.advanceTimersByTime(999)
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(spy).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it("flush writes pending draft immediately", () => {
    vi.useFakeTimers()
    const s = memory()
    const st = createStore(s, catalog)
    st.saveDraftSoon("g0p1", emptyDoc())
    st.flush()
    expect(JSON.parse(s.m.get(STORAGE_KEY)!).draft.phaseId).toBe("g0p1")
    vi.useRealTimers()
  })

  it("validates documents", () => {
    expect(isValidDoc(emptyDoc(), catalog)).toBe(true)
    expect(isValidDoc({ version: 1 }, catalog)).toBe(false)
    expect(isValidDoc(docWithType("flux_capacitor"), catalog)).toBe(false)
  })
})

describe("deep validation", () => {
  const save = (draftDoc: unknown, extra: Record<string, unknown> = {}) => {
    const s = memory()
    s.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSave(), ...extra, draft: { phaseId: "g0p2", doc: draftDoc } }))
    return createStore(s, catalog).data
  }

  it("rejects malformed placements, wires, meter and numbers", () => {
    const base = docWithType("lamp")
    expect(save({ ...base, bench: { ...base.bench, placements: [null] } }).draft).toBeNull()
    expect(save({ ...base, bench: { ...base.bench, placements: [{ id: "X1", rotation: 0 }] } }).draft).toBeNull()
    expect(save({ ...base, instances: [{ id: "X1", type: "lamp", value: 0 }] }).draft).toBeNull()
    expect(save({ ...base, bench: { ...base.bench, meter: {} } }).draft).toBeNull()
    expect(save({ ...base, bench: { ...base.bench, wires: [{ id: "W1", a: "A1" }] } }).draft).toBeNull()
    expect(save({ ...base, blueprint: { ...base.blueprint, segments: [{ id: "F1", x1: 0, y1: 0, x2: "2", y2: 0 }] } }).draft).toBeNull()
  })

  it("drops malformed progress entries", () => {
    const data = save(emptyDoc(), { progress: { g0p1: null, g0p2: { won: true, bestCost: 4 }, g0p3: { won: "yes" } } })
    expect(data.progress).toEqual({ g0p2: { won: true, bestCost: 4 } })
  })
})
