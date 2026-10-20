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
    s.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSave(), version: 7 }))
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
    expect(data.progress).toEqual({ g0p2: { won: true, bestCost: 4, stars: [] } })
  })
})

describe("seen datasheets", () => {
  it("defaults to empty and survives old saves without the field", () => {
    expect(defaultSave().seenDatasheets).toEqual([])
    const s = memory()
    const old = defaultSave() as Partial<ReturnType<typeof defaultSave>>
    delete old.seenDatasheets
    s.setItem(STORAGE_KEY, JSON.stringify(old))
    expect(createStore(s, catalog).data.seenDatasheets).toEqual([])
  })

  it("keeps only string entries", () => {
    const s = memory()
    s.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSave(), seenDatasheets: ["lamp", 3, null] }))
    expect(createStore(s, catalog).data.seenDatasheets).toEqual(["lamp"])
  })
})

import { exportLog, finishAttempt, SESSION_LOG_LIMIT, startAttempt, trackDivergences, updateAttempt } from "../src/state"
import type { Divergence } from "../src/netlist"

describe("session log", () => {
  it("tracks only newly appeared divergences", () => {
    const a = { kind: "wiring", partId: "L1", pin: "a", power: false } as Divergence
    const b = { kind: "value", partId: "R1", power: false } as Divergence
    let c = trackDivergences([], [a], { pending: 0, wiring: 0, value: 0 })
    c = trackDivergences([a], [a, b], c)
    c = trackDivergences([a, b], [a, b], c)
    expect(c).toEqual({ pending: 0, wiring: 1, value: 1 })
  })

  it("finishing records duration and win", () => {
    let d = startAttempt(defaultSave(), "g0p2", new Date(0))
    d = finishAttempt(d, true, new Date(90_000))
    expect(d.sessionLog.at(-1)).toMatchObject({ phaseId: "g0p2", won: true, durationMs: 90_000, endedAt: new Date(90_000).toISOString() })
  })

  it("opening another phase closes the active attempt as not won", () => {
    let d = startAttempt(defaultSave(), "g0p2", new Date(0))
    d = startAttempt(d, "g0p3", new Date(1000))
    expect(d.sessionLog[0]).toMatchObject({ won: false, endedAt: new Date(1000).toISOString(), durationMs: 1000 })
    expect(d.sessionLog[1]).toMatchObject({ phaseId: "g0p3", endedAt: null })
  })

  it("updates only the active attempt", () => {
    let d = startAttempt(defaultSave(), "g0p2", new Date(0))
    d = updateAttempt(d, (a) => ({ ...a, changes: a.changes + 1, meterModes: [...a.meterModes, "V"] }))
    expect(d.sessionLog[0]).toMatchObject({ changes: 1, meterModes: ["V"] })
    d = finishAttempt(d, true, new Date(5))
    const after = updateAttempt(d, (a) => ({ ...a, changes: 99 }))
    expect(after.sessionLog[0].changes).toBe(1)
  })

  it("finishing without an active attempt changes nothing", () => {
    const d = defaultSave()
    expect(finishAttempt(d, true, new Date(0))).toEqual(d)
  })

  it("log is capped", () => {
    let d = defaultSave()
    for (let i = 0; i < SESSION_LOG_LIMIT + 5; i++) d = startAttempt(d, "g0p1", new Date(i))
    expect(d.sessionLog.length).toBe(SESSION_LOG_LIMIT)
  })

  it("export is parseable and versioned", () => {
    const out = JSON.parse(exportLog(defaultSave(), new Date(0)))
    expect(out).toMatchObject({ app: "fio-continuo", version: 1, exportedAt: new Date(0).toISOString(), sessionLog: [], progress: {} })
  })

  it("drops malformed attempts from storage", () => {
    const s = memory()
    s.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSave(), sessionLog: [{ phaseId: "g0p1" }, null, startAttempt(defaultSave(), "g0p2", new Date(0)).sessionLog[0]] }))
    expect(createStore(s, catalog).data.sessionLog.map((a) => a.phaseId)).toEqual(["g0p2"])
  })
})

describe("export of an open attempt", () => {
  it("reports the elapsed time of the attempt still in progress", () => {
    const d = startAttempt(defaultSave(), "g0p2", new Date(0))
    const out = JSON.parse(exportLog(d, new Date(30_000)))
    expect(out.sessionLog[0]).toMatchObject({ endedAt: null, durationMs: 30_000, inProgress: true })
  })
})

import { migrateSave } from "../src/state"

describe("save v2", () => {
  const v1 = () => ({
    version: 1,
    progress: { g0p1: { won: true, bestCost: null }, g0p2: { won: true, bestCost: 4 }, g1p1: { won: true, bestCost: 5 }, g1p2: { won: false, bestCost: null } },
    settings: { standard: "ANSI", reducedMotion: true, volume: 0.5 },
    draft: { phaseId: "g1p2", doc: docWithType("lamp") },
    sessionLog: [
      { phaseId: "g0p1", startedAt: new Date(0).toISOString(), endedAt: new Date(1).toISOString(), won: true, durationMs: 1, changes: 2, hintsOffered: 0, hintsOpened: 0, divergences: { pending: 0, wiring: 0, value: 0 }, meterPlacements: 0, meterModes: [] },
      { phaseId: "g0p2", startedAt: new Date(2).toISOString(), endedAt: null, won: false, durationMs: null, changes: 0, hintsOffered: 0, hintsOpened: 0, divergences: { pending: 0, wiring: 0, value: 0 }, meterPlacements: 0, meterModes: [] },
    ],
    seenDatasheets: ["lamp"],
  })

  it("migrates a v1 save with progress, draft and log", () => {
    const s = memory()
    s.setItem(STORAGE_KEY, JSON.stringify(v1()))
    const data = createStore(s, catalog).data
    expect(data.version).toBe(2)
    expect(data.progress.g0p1).toEqual({ won: true, bestCost: null, stars: [0] })
    expect(data.progress.g1p2).toEqual({ won: false, bestCost: null, stars: [] })
    expect(data.xp).toBe(300)
    expect(data.draft?.phaseId).toBe("g1p2")
    expect(data.settings.standard).toBe("ANSI")
    expect(data.sessionLog).toHaveLength(2)
    expect(data.sessionLog[0]).toMatchObject({ starsEarned: [], xpEarned: 0 })
    expect(data.seenDatasheets).toEqual(["lamp"])
    expect(data.cosmetics).toEqual({ board: "default", wires: "default", mat: "default" })
    expect(data.daily).toEqual({ lastWonDate: null, streak: 0, wonDates: [] })
    expect(data.tutorialSeen).toBe(false)
  })

  it("drops unknown versions", () => {
    expect(migrateSave({ ...v1(), version: 7 })).toBeNull()
  })

  it("validates cosmetics, daily and stars", () => {
    const raw = { ...defaultSave(), xp: -5, cosmetics: "x", daily: { lastWonDate: 3, streak: -2, wonDates: ["2026-10-20", 1] }, progress: { g0p1: { won: true, bestCost: null, stars: [0, "1", 2] } } }
    const data = migrateSave(raw)!
    expect(data.xp).toBe(0)
    expect(data.cosmetics).toEqual({ board: "default", wires: "default", mat: "default" })
    expect(data.daily).toEqual({ lastWonDate: null, streak: 0, wonDates: ["2026-10-20"] })
    expect(data.progress.g0p1.stars).toEqual([0, 2])
  })

  it("new attempts carry star and xp fields", () => {
    const d = startAttempt(defaultSave(), "g0p1", new Date(0))
    expect(d.sessionLog[0]).toMatchObject({ starsEarned: [], xpEarned: 0 })
  })
})

describe("seen groups", () => {
  it("defaults and validates", () => {
    expect(defaultSave().seenGroups).toEqual([])
    const s = memory()
    s.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSave(), seenGroups: [1, "g1", null] }))
    expect(createStore(s, catalog).data.seenGroups).toEqual(["g1"])
    expect(migrateSave({ version: 1, progress: {}, settings: {} })!.seenGroups).toEqual([])
  })
})
