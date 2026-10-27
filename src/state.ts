import type { Divergence, HoleId, Netlist, PartsCatalog } from "./netlist"
import type { SolveResult } from "./solver"

export type Instance = { id: string; type: string; value: number; actualValue: number; fault?: "open" | "short"; inputState?: string; variant?: string }
export type BlueprintPlacement = { id: string; x: number; y: number; rotation: 0 | 90 | 180 | 270 }
export type BlueprintSegment = { id: string; x1: number; y1: number; x2: number; y2: number }
export type BenchPlacement = { id: string; holes: Record<string, HoleId | null>; rotation: 0 | 90 | 180 | 270; offboard?: { x: number; z: number } }
export type WireStyle = "arc" | "angle"
export type Wire = { id: string; a: HoleId; b: HoleId; color: string; style?: WireStyle; mid?: { x: number; z: number } }
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
  diode: "D",
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
export const SANDBOX_KEY = "fio-continuo:sandbox"
const DRAFT_DEBOUNCE_MS = 1000

export type Settings = { standard: "IEC" | "ANSI"; reducedMotion: boolean; sfxVolume: number; musicVolume: number; muted: boolean }
export type SessionAttempt = {
  phaseId: string
  startedAt: string
  endedAt: string | null
  won: boolean
  durationMs: number | null
  changes: number
  hintsOffered: number
  hintsOpened: number
  divergences: { pending: number; wiring: number; value: number }
  meterPlacements: number
  meterModes: ("V" | "A" | "ohm")[]
  starsEarned: number[]
  xpEarned: number
}

export const SESSION_LOG_LIMIT = 2000
export type Cosmetics = { board: string; wires: string; mat: string }
export type Daily = { lastWonDate: string | null; streak: number; wonDates: string[] }
export type PhaseProgress = { won: boolean; bestCost: number | null; stars: number[] }
export type SaveData = {
  version: 3
  progress: Record<string, PhaseProgress>
  settings: Settings
  draft: { phaseId: string; doc: CircuitDoc } | null
  sessionLog: SessionAttempt[]
  seenDatasheets: string[]
  xp: number
  cosmetics: Cosmetics
  daily: Daily
  tutorialSeen: boolean
  seenGroups: string[]
  discovered: string[]
  conceptSeen: string[]
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
  return {
    version: 3,
    progress: {},
    settings: { standard: "IEC", reducedMotion: false, sfxVolume: 0.8, musicVolume: 0.5, muted: false },
    draft: null,
    sessionLog: [],
    seenDatasheets: [],
    xp: 0,
    cosmetics: { board: "default", wires: "default", mat: "default" },
    daily: { lastWonDate: null, streak: 0, wonDates: [] },
    tutorialSeen: false,
    seenGroups: [],
    discovered: [],
    conceptSeen: [],
  }
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
  if (!isObject(w) || !isString(w.id) || !isString(w.a) || !isString(w.b) || !isString(w.color)) return false
  if (w.style !== undefined && w.style !== "arc" && w.style !== "angle") return false
  return w.mid === undefined || (isObject(w.mid) && isNumber(w.mid.x) && isNumber(w.mid.z))
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

function cleanProgress(raw: Record<string, unknown>, fromV1: boolean): SaveData["progress"] {
  const result: SaveData["progress"] = {}
  for (const [id, entry] of Object.entries(raw)) {
    if (!isObject(entry) || typeof entry.won !== "boolean" || !(entry.bestCost === null || isNumber(entry.bestCost))) continue
    // save antigo: fase vencida vale a estrela de "resolver"
    const stars = fromV1 ? (entry.won ? [0] : []) : Array.isArray(entry.stars) ? entry.stars.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 2) : []
    result[id] = { won: entry.won, bestCost: entry.bestCost as number | null, stars: [...new Set(stars)].sort() }
  }
  return result
}

function cleanAttempt(a: SessionAttempt): SessionAttempt {
  const raw = a as SessionAttempt & Partial<Pick<SessionAttempt, "starsEarned" | "xpEarned">>
  return { ...a, starsEarned: Array.isArray(raw.starsEarned) ? raw.starsEarned.filter((n) => Number.isInteger(n)) : [], xpEarned: isNumber(raw.xpEarned) ? raw.xpEarned : 0 }
}

function cleanCosmetics(raw: unknown): Cosmetics {
  const base = defaultSave().cosmetics
  if (!isObject(raw)) return base
  return {
    board: isString(raw.board) ? raw.board : base.board,
    wires: isString(raw.wires) ? raw.wires : base.wires,
    mat: isString(raw.mat) ? raw.mat : base.mat,
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function cleanDaily(raw: unknown): Daily {
  if (!isObject(raw)) return defaultSave().daily
  return {
    lastWonDate: isString(raw.lastWonDate) && DATE_PATTERN.test(raw.lastWonDate) ? raw.lastWonDate : null,
    streak: Number.isInteger(raw.streak) && (raw.streak as number) > 0 ? (raw.streak as number) : 0,
    wonDates: Array.isArray(raw.wonDates) ? raw.wonDates.filter((d): d is string => isString(d) && DATE_PATTERN.test(d)) : [],
  }
}

export const V3_PHASE_MOVES: Record<string, string> = {
  g2p1: "g7p1",
  g2p2: "g7p2",
  g2p3: "g7p3",
  g2p4: "g7p4",
  g2p5: "g7p5",
  g2p6: "g7p6",
  g2p7: "g7p7",
  g3p4: "g6p4",
  g3p5: "g6p5",
  g3p6: "g7p8",
}
export const V3_LEGACY: string[] = ["g3p1", "g3p2", "g3p3"]
export const V3_GROUP_MOVES: Record<string, string> = { g2: "g7", g3: "g2", g4: "g3", g5: "g4", g6: "g5" }

function v3PhaseId(id: string): string {
  return V3_PHASE_MOVES[id] ?? (V3_LEGACY.includes(id) ? `legacy:${id}` : id)
}

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isString) : [])

const isVolume = (v: unknown): v is number => isNumber(v) && v >= 0 && v <= 1

function cleanSettings(raw: Record<string, unknown>): Settings {
  const base = defaultSave().settings
  const saved = raw as Partial<Settings> & { volume?: unknown }
  const sfxVolume = isVolume(saved.sfxVolume) ? saved.sfxVolume : isVolume(saved.volume) ? saved.volume : base.sfxVolume
  return {
    standard: saved.standard ?? base.standard,
    reducedMotion: saved.reducedMotion ?? base.reducedMotion,
    sfxVolume,
    musicVolume: isVolume(saved.musicVolume) ? saved.musicVolume : base.musicVolume,
    muted: saved.muted === true,
  }
}

export function migrateSave(raw: unknown, catalog?: PartsCatalog): SaveData | null {
  if (!isObject(raw) || (raw.version !== 1 && raw.version !== 2 && raw.version !== 3) || !isObject(raw.progress) || !isObject(raw.settings)) return null
  const fromV1 = raw.version === 1
  const moves = raw.version !== 3
  const phaseId = (id: string) => (moves ? v3PhaseId(id) : id)
  const base = defaultSave()
  const cleaned = cleanProgress(raw.progress, fromV1)
  const progress = moves ? Object.fromEntries(Object.entries(cleaned).map(([id, entry]) => [phaseId(id), entry])) : cleaned
  const draft =
    isObject(raw.draft) && typeof raw.draft.phaseId === "string" && (!catalog || isValidDoc(raw.draft.doc, catalog)) && isObject(raw.draft.doc)
      ? { phaseId: phaseId(raw.draft.phaseId), doc: raw.draft.doc as CircuitDoc }
      : null
  const seenGroups = Array.isArray(raw.seenGroups) ? raw.seenGroups.filter((g): g is string => isString(g)) : []
  return {
    version: 3,
    progress,
    settings: cleanSettings(raw.settings),
    draft: draft && draft.phaseId.startsWith("legacy:") ? null : draft,
    sessionLog: Array.isArray(raw.sessionLog) ? raw.sessionLog.filter(validAttempt).map(cleanAttempt).map((a) => ({ ...a, phaseId: phaseId(a.phaseId) })) : [],
    seenDatasheets: Array.isArray(raw.seenDatasheets) ? raw.seenDatasheets.filter((k): k is string => typeof k === "string") : [],
    xp: fromV1 ? Object.values(progress).filter((p) => p.won).length * 100 : isNumber(raw.xp) && raw.xp > 0 ? raw.xp : 0,
    cosmetics: fromV1 ? base.cosmetics : cleanCosmetics(raw.cosmetics),
    daily: fromV1 ? base.daily : cleanDaily(raw.daily),
    tutorialSeen: raw.tutorialSeen === true,
    seenGroups: moves ? seenGroups.map((g) => V3_GROUP_MOVES[g] ?? g) : seenGroups,
    discovered: stringList(raw.discovered),
    conceptSeen: stringList(raw.conceptSeen),
  }
}

export function loadSandbox(storage: StorageLike | null, catalog: PartsCatalog): CircuitDoc | null {
  if (!storage) return null
  try {
    const text = storage.getItem(SANDBOX_KEY)
    if (!text) return null
    const doc: unknown = JSON.parse(text)
    return isValidDoc(doc, catalog) ? doc : null
  } catch {
    return null
  }
}

export function saveSandbox(storage: StorageLike | null, doc: CircuitDoc): void {
  if (!storage) return
  try {
    storage.setItem(SANDBOX_KEY, JSON.stringify(doc))
  } catch {
    return
  }
}

function parseSave(text: string | null, catalog: PartsCatalog): SaveData {
  if (!text) return defaultSave()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return defaultSave()
  }
  return migrateSave(raw, catalog) ?? defaultSave()
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

function validAttempt(a: unknown): a is SessionAttempt {
  return (
    isObject(a) &&
    isString(a.phaseId) &&
    isString(a.startedAt) &&
    (a.endedAt === null || isString(a.endedAt)) &&
    typeof a.won === "boolean" &&
    isNumber(a.changes) &&
    isObject(a.divergences) &&
    Array.isArray(a.meterModes)
  )
}

function closeActive(log: SessionAttempt[], won: boolean, now: Date): SessionAttempt[] {
  const last = log.at(-1)
  if (!last || last.endedAt !== null) return log
  const durationMs = now.getTime() - new Date(last.startedAt).getTime()
  return [...log.slice(0, -1), { ...last, endedAt: now.toISOString(), won, durationMs }]
}

export function startAttempt(data: SaveData, phaseId: string, now: Date): SaveData {
  const attempt: SessionAttempt = {
    phaseId,
    startedAt: now.toISOString(),
    endedAt: null,
    won: false,
    durationMs: null,
    changes: 0,
    hintsOffered: 0,
    hintsOpened: 0,
    divergences: { pending: 0, wiring: 0, value: 0 },
    meterPlacements: 0,
    meterModes: [],
    starsEarned: [],
    xpEarned: 0,
  }
  const log = [...closeActive(data.sessionLog, false, now), attempt]
  return { ...data, sessionLog: log.slice(Math.max(0, log.length - SESSION_LOG_LIMIT)) }
}

export function updateAttempt(data: SaveData, patch: (a: SessionAttempt) => SessionAttempt): SaveData {
  const last = data.sessionLog.at(-1)
  if (!last || last.endedAt !== null) return data
  return { ...data, sessionLog: [...data.sessionLog.slice(0, -1), patch(last)] }
}

export function recordReward(data: SaveData, starsEarned: number[], xpEarned: number): SaveData {
  return updateAttempt(data, (a) => ({ ...a, starsEarned, xpEarned }))
}

export function finishAttempt(data: SaveData, won: boolean, now: Date): SaveData {
  const log = closeActive(data.sessionLog, won, now)
  return log === data.sessionLog ? data : { ...data, sessionLog: log }
}

export function trackDivergences(prev: Divergence[], next: Divergence[], counts: SessionAttempt["divergences"]): SessionAttempt["divergences"] {
  const key = (d: Divergence) => `${d.kind}|${d.partId}|${d.pin ?? ""}`
  const seen = new Set(prev.map(key))
  const result = { ...counts }
  for (const d of next) if (!seen.has(key(d))) result[d.kind]++
  return result
}

export function exportLog(data: SaveData, now: Date): string {
  const sessionLog = data.sessionLog.map((a) =>
    a.endedAt === null ? { ...a, durationMs: now.getTime() - new Date(a.startedAt).getTime(), inProgress: true } : a,
  )
  return JSON.stringify({ app: "fio-continuo", version: 1, exportedAt: now.toISOString(), progress: data.progress, sessionLog }, null, 2)
}
