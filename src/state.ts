import type { HoleId, Netlist, PartsCatalog } from "./netlist"
import type { SolveResult } from "./solver"

export type Instance = { id: string; type: string; value: number; actualValue: number; fault?: "open" | "short"; inputState?: string; variant?: string }
export type BlueprintPlacement = { id: string; x: number; y: number; rotation: 0 | 90 | 180 | 270 }
export type BlueprintSegment = { id: string; x1: number; y1: number; x2: number; y2: number }
export type BenchPlacement = { id: string; holes: Record<string, HoleId | null>; rotation: 0 | 90 | 180 | 270; offboard?: { x: number; z: number } }
export type Wire = { id: string; a: HoleId; b: HoleId; color: string }
export type Meter = { mode: "off" | "V" | "A" | "ohm"; red: HoleId | null; black: HoleId | null }
export type CircuitDoc = {
  version: 1
  instances: Instance[]
  blueprint: { placements: BlueprintPlacement[]; segments: BlueprintSegment[] }
  bench: { placements: BenchPlacement[]; wires: Wire[]; meter: Meter }
}

export function emptyDoc(): CircuitDoc {
  return {
    version: 1,
    instances: [],
    blueprint: { placements: [], segments: [] },
    bench: { placements: [], wires: [], meter: { mode: "off", red: null, black: null } },
  }
}

export const ID_PREFIX: Record<string, string> = {
  battery: "B",
  lamp: "L",
  switch: "S",
  push_button: "K",
  dc_motor: "M",
  buzzer: "Z",
  resistor: "R",
  led: "LED",
  logic_switch: "SW",
  logic_probe: "P",
}

export function prefixFor(type: string): string {
  if (type.startsWith("chip_")) return "U"
  return ID_PREFIX[type] ?? "X"
}

export function nextInstanceId(doc: CircuitDoc, prefix: string): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  const used = new Set<number>()
  for (const instance of doc.instances) {
    const match = pattern.exec(instance.id)
    if (match) used.add(Number(match[1]))
  }
  let n = 1
  while (used.has(n)) n++
  return `${prefix}${n}`
}

export type History = { snapshots: CircuitDoc[]; index: number; limit: number }

export function createHistory(doc: CircuitDoc, limit = 200): History {
  return { snapshots: [structuredClone(doc)], index: 0, limit }
}

export function pushSnapshot(h: History, doc: CircuitDoc): History {
  const snapshots = [...h.snapshots.slice(0, h.index + 1), structuredClone(doc)]
  const overflow = Math.max(0, snapshots.length - h.limit)
  const kept = snapshots.slice(overflow)
  return { snapshots: kept, index: kept.length - 1, limit: h.limit }
}

export function undo(h: History): History {
  return h.index > 0 ? { ...h, index: h.index - 1 } : h
}

export function redo(h: History): History {
  return h.index < h.snapshots.length - 1 ? { ...h, index: h.index + 1 } : h
}

export function rewindTo(h: History, index: number): History {
  return { ...h, index: Math.min(h.snapshots.length - 1, Math.max(0, index)) }
}

export function current(h: History): CircuitDoc {
  return structuredClone(h.snapshots[h.index])
}

export type AppView = {
  doc: CircuitDoc
  benchNet: Netlist
  benchResult: SolveResult
  blueprintNet: Netlist
  blueprintResult: SolveResult
}

export const STORAGE_KEY = "fio-continuo:v1"
const DRAFT_DEBOUNCE_MS = 1000

export type Settings = { standard: "IEC" | "ANSI"; reducedMotion: boolean; volume: number }
export type SessionAttempt = Record<string, unknown>
export type SaveData = {
  version: 1
  progress: Record<string, { won: boolean; bestCost: number | null }>
  settings: Settings
  draft: { phaseId: string; doc: CircuitDoc } | null
  sessionLog: SessionAttempt[]
}
export type StorageLike = Pick<Storage, "getItem" | "setItem">
export type Store = {
  data: SaveData
  available: boolean
  save(): void
  saveDraftSoon(phaseId: string, doc: CircuitDoc): void
  flush(): void
}

export function defaultSave(): SaveData {
  return { version: 1, progress: {}, settings: { standard: "IEC", reducedMotion: false, volume: 0.8 }, draft: null, sessionLog: [] }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const isString = (v: unknown): v is string => typeof v === "string"
const isHole = (v: unknown) => v === null || isString(v)
const ROTATIONS = new Set([0, 90, 180, 270])
const METER_MODES = new Set(["off", "V", "A", "ohm"])

function validInstance(i: unknown, catalog: PartsCatalog): boolean {
  return isObject(i) && isString(i.id) && isString(i.type) && i.type in catalog && isNumber(i.value) && isNumber(i.actualValue)
}

function validBlueprintPlacement(p: unknown): boolean {
  return isObject(p) && isString(p.id) && isNumber(p.x) && isNumber(p.y) && ROTATIONS.has(p.rotation as number)
}

function validSegment(s: unknown): boolean {
  return isObject(s) && isString(s.id) && isNumber(s.x1) && isNumber(s.y1) && isNumber(s.x2) && isNumber(s.y2)
}

function validBenchPlacement(p: unknown): boolean {
  if (!isObject(p) || !isString(p.id) || !ROTATIONS.has(p.rotation as number) || !isObject(p.holes)) return false
  if (!Object.values(p.holes).every(isHole)) return false
  return p.offboard === undefined || (isObject(p.offboard) && isNumber(p.offboard.x) && isNumber(p.offboard.z))
}

function validWire(w: unknown): boolean {
  return isObject(w) && isString(w.id) && isString(w.a) && isString(w.b) && isString(w.color)
}

function validMeter(m: unknown): boolean {
  return isObject(m) && METER_MODES.has(m.mode as string) && isHole(m.red) && isHole(m.black)
}

export function isValidDoc(doc: unknown, catalog: PartsCatalog): doc is CircuitDoc {
  if (!isObject(doc) || doc.version !== 1 || !Array.isArray(doc.instances)) return false
  const { blueprint, bench } = doc
  if (!isObject(blueprint) || !Array.isArray(blueprint.placements) || !Array.isArray(blueprint.segments)) return false
  if (!isObject(bench) || !Array.isArray(bench.placements) || !Array.isArray(bench.wires)) return false
  return (
    doc.instances.every((i) => validInstance(i, catalog)) &&
    blueprint.placements.every(validBlueprintPlacement) &&
    blueprint.segments.every(validSegment) &&
    bench.placements.every(validBenchPlacement) &&
    bench.wires.every(validWire) &&
    validMeter(bench.meter)
  )
}

function cleanProgress(raw: Record<string, unknown>): SaveData["progress"] {
  const result: SaveData["progress"] = {}
  for (const [id, entry] of Object.entries(raw)) {
    if (isObject(entry) && typeof entry.won === "boolean" && (entry.bestCost === null || isNumber(entry.bestCost))) {
      result[id] = { won: entry.won, bestCost: entry.bestCost as number | null }
    }
  }
  return result
}

function parseSave(text: string | null, catalog: PartsCatalog): SaveData {
  if (!text) return defaultSave()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return defaultSave()
  }
  if (!isObject(raw) || raw.version !== 1 || !isObject(raw.progress) || !isObject(raw.settings)) return defaultSave()
  const base = defaultSave()
  const draft = isObject(raw.draft) && typeof raw.draft.phaseId === "string" && isValidDoc(raw.draft.doc, catalog) ? { phaseId: raw.draft.phaseId, doc: raw.draft.doc } : null
  return {
    version: 1,
    progress: cleanProgress(raw.progress),
    settings: { ...base.settings, ...(raw.settings as Partial<Settings>) },
    draft,
    sessionLog: Array.isArray(raw.sessionLog) ? (raw.sessionLog as SessionAttempt[]) : [],
  }
}

export function createStore(storage: StorageLike | null, catalog: PartsCatalog): Store {
  let available = storage !== null
  let text: string | null = null
  if (storage) {
    try {
      text = storage.getItem(STORAGE_KEY)
    } catch {
      available = false
    }
  }
  const store: Store = {
    data: parseSave(text, catalog),
    available,
    save() {
      if (!storage || !store.available) return
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(store.data))
      } catch {
        store.available = false
      }
    },
    saveDraftSoon(phaseId, doc) {
      store.data.draft = { phaseId, doc: structuredClone(doc) }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        store.save()
      }, DRAFT_DEBOUNCE_MS)
    },
    flush() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      store.save()
    },
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  return store
}
