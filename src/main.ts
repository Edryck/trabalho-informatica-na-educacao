import "@fontsource/ibm-plex-sans/400.css"
import "@fontsource/ibm-plex-sans/500.css"
import "@fontsource/ibm-plex-sans/600.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "@fontsource/rubik/500.css"
import "@fontsource/rubik/600.css"
import "@fontsource/rubik/700.css"
import "./style.css"
import partsJson from "../data/parts.json"
import phasesJson from "../data/phases.json"
import datasheetsJson from "../data/datasheets.json"
import rewardsJson from "../data/rewards.json"
import { createAudio } from "./audio"
import { levelFor, starsTotal, type Rewards } from "./game"
import { bandHex, createBench, resistorBands, WIRE_PALETTE, type BenchTool } from "./bench"
import { createBlueprint } from "./blueprint"
import { benchToNetlist, blueprintToNetlist, type PartsCatalog } from "./netlist"
import {
  evaluate,
  evaluateScenarios,
  findPhase,
  referenceCost,
  isPhaseAvailable,
  loadPhases,
  phaseOrder,
  shouldOfferHint,
  type Evaluation,
  type Phase,
  type TutorialEvent,
} from "./phases"
import { solve, type DiscreteState } from "./solver"
import {
  createHistory,
  createStore,
  current,
  emptyDoc,
  isValidDoc,
  exportLog,
  finishAttempt,
  pushSnapshot,
  redo,
  rewindTo,
  startAttempt,
  trackDivergences,
  updateAttempt,
  undo,
  type AppView,
  type CircuitDoc,
  type History,
} from "./state"
import {
  createDatasheetCard,
  createDivergenceBar,
  createHint,
  createMeterHud,
  createValuePicker,
  formatValue,
  setReducedMotion,
  warningText,
  createPendingList,
  createPhaseBrief,
  createCompleteScreen,
  createPhaseMap,
  createSettingsScreen,
  createTitleScreen,
  createPreviewBanner,
  createRewindBar,
  createToastHost,
  createToolbar,
  createTray,
  createViewToggle,
  createWirePalette,
  scenarioLabel,
  type Datasheet,
  type PendingItem,
  type ToolId,
  type TrayItem,
  type ViewName,
} from "./ui"

const catalog = partsJson as unknown as PartsCatalog
const rewards = rewardsJson as unknown as Rewards
const audio = createAudio({ volume: 0.8 })
const phases = loadPhases(phasesJson)

const PART_LABELS: Record<string, string> = {
  battery: "Bateria",
  lamp: "Lâmpada",
  switch: "Chave",
  push_button: "Botão",
  dc_motor: "Motor",
  buzzer: "Buzzer",
  resistor: "Resistor",
  led: "LED",
  logic_switch: "Chave lógica",
  logic_probe: "Ponta lógica",
  chip_not: "CI NOT 7404",
  chip_and: "CI AND 7408",
  chip_or: "CI OR 7432",
  chip_xor: "CI XOR 7486",
  chip_nand: "CI NAND 7400",
  chip_nor: "CI NOR 7402",
  chip_xnor: "CI XNOR",
}

const HINT_CHECK_MS = 10_000

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const store = createStore(safeLocalStorage(), catalog)

const app = document.getElementById("app")!
app.innerHTML = `
  <div class="layout">
    <nav class="toolbar-host"></nav>
    <main class="stage" tabindex="0" aria-label="Bancada">
      <div class="layer layer-blueprint"></div>
      <div class="layer layer-bench"></div>
    </main>
    <section class="tray-host"></section>
  </div>`
const toolbarEl = app.querySelector<HTMLElement>(".toolbar-host")!
const stageEl = app.querySelector<HTMLElement>(".stage")!
const blueprintLayer = app.querySelector<HTMLElement>(".layer-blueprint")!
const benchLayer = app.querySelector<HTMLElement>(".layer-bench")!
const trayEl = app.querySelector<HTMLElement>(".tray-host")!
const [paletteEl, hintEl, toggleEl, barEl, pendingEl, briefEl, listEl, toastEl, previewEl, meterEl, pickerEl, sheetEl, rewindEl] = Array.from({ length: 13 }, () =>
  document.createElement("div"),
)
stageEl.append(toggleEl, barEl, hintEl, briefEl, previewEl, listEl, toastEl, pickerEl, sheetEl, rewindEl)
benchLayer.append(paletteEl, meterEl)
blueprintLayer.append(pendingEl)

type Session = {
  phase: Phase
  startedAt: number
  changes: number
  hintsOpened: number
  offeredAt: number
  hintOffered: number
  stepIndex: number | null
  events: Set<TutorialEvent>
  previewIndex: number | null
  won: boolean
}

let history: History = createHistory(emptyDoc())
let view: AppView
let evaluation: Evaluation | null = null
let session: Session | null = null
type Overlay = "title" | "map" | "settings" | "complete" | null
let overlay: Overlay = null
let overlayReturn: Overlay = null
let lastDivergences: import("./netlist").Divergence[] = []
let benchDiscrete: DiscreteState | undefined
let blueprintDiscrete: DiscreteState | undefined
let currentView = false
let activePart: string | null = null
let activeView: ViewName = "bench"
const hints: Record<ViewName, string | null> = { bench: null, blueprint: null }
const systemReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
let reducedMotion = systemReducedMotion || store.data.settings.reducedMotion
document.body.classList.toggle("reduce-motion", reducedMotion)
setReducedMotion(reducedMotion)

function overlayOpen(): boolean {
  return overlay !== null
}

const hint = createHint(hintEl)
const bar = createDivergenceBar(barEl)
const toggle = createViewToggle(toggleEl, switchView)
const toasts = createToastHost(toastEl)
const preview = createPreviewBanner(previewEl, () => setPreview(null))
const brief = createPhaseBrief(briefEl, {
  onPreview: (index) => {
    if (rewinding) return
    setPreview(session?.previewIndex === index ? null : index)
  },
  onHint: openHint,
  onPhases: showPhaseList,
  onRestart: restartPhase,
})

function restartPhase() {
  if (!session) return
  const id = session.phase.id
  if (id === "sandbox") return startSandbox()
  store.data.draft = null
  store.flush()
  startPhase(id)
  toasts.show("info", "Fase recomeçada do zero.")
}
let rewinding = false
const rewindBar = createRewindBar(rewindEl, {
  onPreview: (index) => {
    // só mostra o momento escolhido; o histórico só muda se confirmar
    view = compute(structuredClone(history.snapshots[index]))
    render()
  },
  onCommit: (index) => {
    rewinding = false
    rewindBar.hide()
    restore(rewindTo(history, index))
  },
  onCancel: () => {
    rewinding = false
    rewindBar.hide()
    restore(history)
  },
})

function openRewind() {
  if (!session || overlayOpen() || history.snapshots.length < 2) return
  rewinding = true
  setTool("select")
  rewindBar.show(history.snapshots.length, history.index)
}

const titleEl = document.createElement("div")
const completeEl = document.createElement("div")
const settingsEl = document.createElement("div")
app.append(titleEl, completeEl, settingsEl)
const phaseMap = createPhaseMap(listEl, startPhase, {
  onSettings: () => showSettings("map"),
  onHome: showTitle,
  onUnlockSeen: (groupId) => {
    if (!store.data.seenGroups.includes(groupId)) store.data.seenGroups.push(groupId)
    store.save()
  },
})
const titleScreen = createTitleScreen(titleEl)
const completeScreen = createCompleteScreen(completeEl)
const settingsScreen = createSettingsScreen(settingsEl, {
  onStandard: (standard) => {
    store.data.settings.standard = standard
    store.save()
    showSettings(overlayReturn)
    render()
  },
  onReducedMotion: (on) => {
    store.data.settings.reducedMotion = on
    store.save()
    reducedMotion = systemReducedMotion || on
    document.body.classList.toggle("reduce-motion", reducedMotion)
setReducedMotion(reducedMotion)
    showSettings(overlayReturn)
    render()
  },
  onReset: () => {
    store.data.progress = {}
    store.data.draft = null
    store.data.seenDatasheets = []
    store.flush()
    session = null
    toasts.show("info", "Progresso apagado. Os dados de uso continuam guardados pra exportar.")
    showTitle()
  },
  onExport: () => {
    const blob = new Blob([exportLog(store.data, new Date())], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `fio-continuo-dados-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  onBack: () => {
    settingsScreen.hide()
    if (overlayReturn === "map") showPhaseList()
    else if (overlayReturn === "title" || !session) showTitle()
    else closeOverlay()
  },
})

const callbacks = (name: ViewName) => ({
  onChange: (doc: CircuitDoc, commit: boolean) => {
    if (rewinding) return
    if (session?.previewIndex !== null && session?.previewIndex !== undefined) return
    update(doc, { commit })
  },
  onEvent: (event: string) => {
    if (event === "toolReset") setTool("select")
    else if (event === "lockedLabel") toasts.show("info", "A fase usa esse nome pra conferir o circuito, então ele fica assim.")
    else if (event.startsWith("editValue:")) void editValue(event.slice("editValue:".length))
    else record(event as TutorialEvent)
  },
  onHint: (text: string | null) => {
    hints[name] = text
    if (activeView === name) hint.show(text)
  },
})

const bench = createBench(benchLayer, catalog, { ...callbacks("bench"), onSelect: (selection) => palette.show(selection?.kind === "wire") })
const blueprint = createBlueprint(blueprintLayer, catalog, callbacks("blueprint"))

const toolbar = createToolbar(toolbarEl, onToolbar)
const tray = createTray(trayEl, (type) => void pickFromTray(type), (type) => openDatasheet(type, false))
const datasheets = datasheetsJson as unknown as Record<string, Datasheet>
let sheetQueue: string[] = []
const sheetCard = createDatasheetCard(sheetEl, (key) => {
  if (!store.data.seenDatasheets.includes(key)) {
    store.data.seenDatasheets.push(key)
    store.save()
  }
  const next = sheetQueue.shift()
  if (next) openDatasheet(next, true)
})

function openDatasheet(type: string, isNew: boolean) {
  const key = catalog[type]?.datasheet ?? type
  const sheet = datasheets[key]
  if (!sheet) return
  sheetCard.open(key, sheet, blueprint.symbolMarkup(type, store.data.settings.standard), isNew)
  record("datasheetOpened")
}

function queueNewDatasheets(phase: Phase) {
  const group = phases.groups.find((g) => g.phases.some((p) => p.id === phase.id))
  const fresh = (group?.unlocks ?? []).filter((key) => key in catalog && key in datasheets && !store.data.seenDatasheets.includes(key))
  sheetQueue = fresh.slice(1)
  if (fresh[0]) openDatasheet(fresh[0], true)
}

async function pickFromTray(type: string) {
  if (!session || overlayOpen() || rewinding || session.previewIndex !== null) return
  const item = type.startsWith("pending:") ? pendingFor("bench").find((p) => `pending:${p.id}` === type) : undefined
  const partType = item?.type ?? type
  const values = activeView === "bench" ? session.phase.trayValues?.[partType] : undefined
  let value: number | undefined
  if (values && values.length > 1) {
    const chosen = await valuePicker.open(
      partType === "resistor" ? "Qual resistor você pega?" : "Qual peça você pega?",
      values.map((v) => ({ value: v, html: physicalHtml(partType, v), label: partType === "resistor" ? `Resistor com faixas ${resistorBands(v).join(", ")}` : String(v) })),
    )
    if (chosen === null) return
    value = chosen
  } else if (values?.length === 1) value = values[0]
  else if (!item) {
    const options = catalog[partType]?.values ?? []
    if (options.length > 1) {
      const unit = partType === "battery" ? "V" : "Ω"
      const chosen = await valuePicker.open(
        `Valor ${partType === "battery" ? "da bateria" : "do resistor"}`,
        options.map((v) => ({ value: v, html: `<span class="mono">${formatValue(v, unit)}</span>`, label: formatValue(v, unit) })),
      )
      if (chosen === null) return
      value = chosen
    }
  }
  setTool(item ? { place: item.type, id: item.id, value } : { place: type, value })
  activePart = type
  tray.update(trayItems(view.doc), activePart)
}

function physicalHtml(type: string, value: number): string {
  // no código de cores o jogador vê só as faixas, sem o número
  if (type === "resistor")
    return `<span class="band-resistor">${resistorBands(value)
      .map((band) => `<span class="band" style="background:${bandHex(band)}"></span>`)
      .join("")}</span>`
  return `<span class="mono">${formatValue(value, type === "battery" ? "V" : "Ω")}</span>`
}

async function editValue(id: string) {
  if (rewinding) return
  const instance = view.doc.instances.find((i) => i.id === id)
  const values = instance ? catalog[instance.type]?.values : undefined
  if (!instance || !values || values.length === 0 || !session) return
  const unit = instance.type === "battery" ? "V" : "Ω"
  const chosen = await valuePicker.open(
    `Valor de ${id} no esquema`,
    values.map((v) => ({ value: v, html: `<span class="mono">${formatValue(v, unit)}</span>`, label: formatValue(v, unit) })),
  )
  if (chosen === null) return
  const doc = structuredClone(view.doc)
  const target = doc.instances.find((i) => i.id === id)!
  target.value = chosen
  if (!doc.bench.placements.some((p) => p.id === id)) target.actualValue = chosen
  update(doc, { commit: true })
}
const valuePicker = createValuePicker(pickerEl)
const meterHud = createMeterHud(meterEl, (mode) => setMeterMode(mode))
let lastMeterMode: "V" | "A" | "ohm" = "V"
let meterWasPlaced = false
let shownWarnings = new Set<string>()
const palette = createWirePalette(paletteEl, WIRE_PALETTE, (color) => bench.setWireColor(color))
palette.show(false)
const pendingList = createPendingList(pendingEl, "Na protoboard, falta no esquema", (item: PendingItem) => setTool({ place: item.type, id: item.id }))

function compute(doc: CircuitDoc): AppView {
  const started = import.meta.env.DEV ? performance.now() : 0
  const benchNet = benchToNetlist(doc, catalog)
  const blueprintNet = blueprintToNetlist(doc, catalog)
  const benchResult = solve(benchNet, catalog, { previous: benchDiscrete })
  const blueprintResult = solve(blueprintNet, catalog, { previous: blueprintDiscrete })
  benchDiscrete = benchResult.discrete
  blueprintDiscrete = blueprintResult.discrete
  evaluation = session ? evaluate(session.phase, doc, catalog) : null
  if (import.meta.env.DEV) console.debug(`[fio] netlists + solves + cenários: ${(performance.now() - started).toFixed(2)} ms`)
  return { doc, benchNet, benchResult, blueprintNet, blueprintResult }
}

function pendingFor(missingOn: ViewName): PendingItem[] {
  const placedOn = (side: ViewName, id: string) =>
    side === "bench" ? view.doc.bench.placements.some((p) => p.id === id) : view.doc.blueprint.placements.some((p) => p.id === id)
  const other: ViewName = missingOn === "bench" ? "blueprint" : "bench"
  return view.doc.instances
    .filter((i) => placedOn(other, i.id) && !placedOn(missingOn, i.id) && !catalog[i.type]?.isTool)
    .map((i) => ({ id: i.id, type: i.type, label: PART_LABELS[i.type] ?? i.type }))
}

function trayItems(doc: CircuitDoc): TrayItem[] {
  if (!session) return []
  const pending: TrayItem[] =
    activeView === "bench" ? pendingFor("bench").map((p) => ({ type: `pending:${p.id}`, icon: p.type, label: `${p.id} · posicionar`, count: 1 })) : []
  const initialCounts = new Map<string, number>()
  for (const i of session.phase.initial?.instances ?? []) initialCounts.set(i.type, (initialCounts.get(i.type) ?? 0) + 1)
  const stock: TrayItem[] = Object.entries(session.phase.tray)
    .filter(([type]) => activeView === "bench" || !catalog[type]?.isTool)
    .map(([type, total]) => {
    const used = doc.instances.filter((i) => i.type === type).length - (initialCounts.get(type) ?? 0)
    return { type, label: PART_LABELS[type] ?? type, count: Math.max(0, total - Math.max(0, used)) }
  })
  return [...pending, ...stock]
}

function previewText(index: number): string {
  const scenario = session?.phase.expect[index]
  if (!scenario) return ""
  const label = scenarioLabel(scenario)
  return label.when || "estado atual"
}

function render() {
  const phase = session?.phase
  const ev = evaluation
  const showMarkers = !!phase && phase.showDivergence
  const divergences = showMarkers && ev ? ev.divergences : []
  const previewResult = session?.previewIndex !== null && session?.previewIndex !== undefined ? ev?.scenarios[session.previewIndex]?.result : undefined
  const evaluatesBench = phase?.evaluateOn !== "blueprint"
  bench.render(view, { currentView, reducedMotion, divergences, preview: evaluatesBench ? previewResult : undefined })
  blueprint.render(view, { currentView, reducedMotion, standard: store.data.settings.standard, divergences, preview: evaluatesBench ? undefined : previewResult })
  bar.show(divergences, (partId) => (view.doc.instances.find((i) => i.id === partId)?.type === "battery" ? "V" : "Ω"))
  const meter = view.doc.bench.meter
  meterHud.render(meter.mode, (previewResult && evaluatesBench ? previewResult : view.benchResult).meter, !!meter.red && !!meter.black)
  toolbar.setMeterAvailable(meterAvailable())
  pendingList.update(phase?.showDivergence ? pendingFor("blueprint") : [])
  tray.update(trayItems(view.doc), activePart)
  toolbar.setHistory(history.index > 0, history.index < history.snapshots.length - 1)
  toolbar.setRewind(history.snapshots.length > 1)
  toolbar.setCurrentView(currentView)
  stageEl.classList.toggle("previewing", previewResult !== undefined)
  preview.show(previewResult !== undefined && session ? previewText(session.previewIndex!) : null)
  if (phase && ev && session) {
    brief.render(phase, {
      rows: ev.scenarios.map((s) => ({ ok: s.ok, isCurrent: s.isCurrent })),
      cost: ev.cost,
      budgetOk: ev.budgetOk,
      previewIndex: session.previewIndex,
      stepIndex: session.stepIndex,
      hintsOpened: session.hintsOpened,
      won: session.won,
    })
  } else brief.hide()
}

function update(doc: CircuitDoc, opts: { commit: boolean }) {
  if (opts.commit) {
    history = pushSnapshot(history, doc)
    if (session) session.changes++
  }
  view = compute(doc)
  if (opts.commit && session && session.phase.id !== "sandbox") {
    const divergences = session.phase.showDivergence ? evaluation?.divergences ?? [] : []
    store.data = updateAttempt(store.data, (a) => ({ ...a, changes: a.changes + 1, divergences: trackDivergences(lastDivergences, divergences, a.divergences) }))
    lastDivergences = divergences
    if (!session.won) store.saveDraftSoon(session.phase.id, doc)
  }
  if (opts.commit) noticeMeterAndWarnings()
  // arrasto manda estados intermediários: só conta vitória no que o jogador soltou
  if (opts.commit) {
    advanceSteps()
    checkVictory()
  }
  render()
  if (opts.commit) maybeOfferHint()
}

function restore(next: History) {
  history = next
  view = compute(current(history))
  if (session && !session.won && session.phase.id !== "sandbox") store.saveDraftSoon(session.phase.id, view.doc)
  advanceSteps()
  checkVictory()
  render()
}

function activeEditor() {
  return activeView === "bench" ? bench : blueprint
}

function meterAvailable(): boolean {
  if (!session) return false
  const groupIndex = phases.groups.findIndex((g) => g.phases.some((p) => p.id === session!.phase.id))
  const unlockIndex = phases.groups.findIndex((g) => g.unlocks.includes("multimeter"))
  return unlockIndex >= 0 && groupIndex >= unlockIndex
}

function setMeterMode(mode: "off" | "V" | "A" | "ohm") {
  if (!session || rewinding) return
  const doc = structuredClone(view.doc)
  doc.bench.meter.mode = mode
  if (mode !== "off") lastMeterMode = mode
  update(doc, { commit: true })
}

function toggleMeter() {
  if (!meterAvailable() || activeView !== "bench") return
  if (view.doc.bench.meter.mode === "off") {
    setMeterMode(lastMeterMode)
    const meter = view.doc.bench.meter
    if (!meter.red || !meter.black) setTool("meter")
  } else {
    setMeterMode("off")
    setTool("select")
  }
}

const QUIET_WARNINGS = new Set(["floatingInput", "undefinedInput", "unpoweredChip"])

function noticeMeterAndWarnings() {
  const result = view.benchResult
  const reading = result.meter
  const meter = view.doc.bench.meter
  const placed = meter.mode !== "off" && !!meter.red && !!meter.black
  if (placed && session?.phase.id !== "sandbox") {
    record("meterPlaced")
    const mode = meter.mode as "V" | "A" | "ohm"
    if (!meterWasPlaced) store.data = updateAttempt(store.data, (a) => ({ ...a, meterPlacements: a.meterPlacements + 1 }))
    store.data = updateAttempt(store.data, (a) => (a.meterModes.includes(mode) ? a : { ...a, meterModes: [...a.meterModes, mode] }))
  }
  meterWasPlaced = placed
  if (reading?.display === "value" && reading.value !== null) {
    if (reading.mode === "V" && Math.abs(reading.value) > 0.1) record("meterReadVoltage")
    if (reading.mode === "A" && Math.abs(reading.value) > 1e-4) record("meterReadCurrent")
  }
  const now = new Set(result.warnings.map((w) => `${w.kind}|${w.partId ?? ""}`))
  for (const w of result.warnings) {
    const key = `${w.kind}|${w.partId ?? ""}`
    // aviso de CI aparece o tempo todo enquanto a pessoa monta; a ponta lógica com ? já conta essa história
    if (shownWarnings.has(key) || QUIET_WARNINGS.has(w.kind)) continue
    const text = warningText(w)
    if (text) toasts.show("warning", text)
  }
  shownWarnings = now
}

function setTool(tool: BenchTool) {
  bench.setTool(activeView === "bench" ? tool : "select")
  blueprint.setTool(activeView === "blueprint" ? tool : "select")
  activePart = typeof tool === "object" ? tool.place : null
  toolbar.setActive(tool === "select" || tool === "wire" || tool === "meter" ? tool : null)
  tray.update(trayItems(view.doc), activePart)
}

function switchView(next: ViewName) {
  if (next === activeView) return
  activeView = next
  stageEl.dataset.view = next
  stageEl.setAttribute("aria-label", next === "bench" ? "Bancada" : "Blueprint")
  toggle.set(next)
  setTool("select")
  if (next === "blueprint") blueprint.activate()
  hint.show(hints[next])
  palette.show(false)
  record("viewSwitched")
  render()
}

function setPreview(index: number | null) {
  if (!session) return
  session.previewIndex = index
  if (index !== null) setTool("select")
  render()
}

function record(event: TutorialEvent) {
  if (!session) return
  session.events.add(event)
  if (advanceSteps()) {
    checkVictory()
    render()
  }
}

function stepDone(phase: Phase, index: number): boolean {
  const step = phase.steps?.[index]
  if (!step || !session) return false
  if ("event" in step.until) return session.events.has(step.until.event)
  const net = phase.evaluateOn === "bench" ? view.benchNet : view.blueprintNet
  return evaluateScenarios(step.until.expect, net, catalog).every((s) => s.ok)
}

function advanceSteps(): boolean {
  if (!session || session.stepIndex === null || !session.phase.steps) return false
  let moved = false
  while (session.stepIndex < session.phase.steps.length && stepDone(session.phase, session.stepIndex)) {
    session.stepIndex++
    moved = true
  }
  if (moved && session.stepIndex < session.phase.steps.length) session.events.clear()
  return moved
}

function checkVictory() {
  if (!session || session.won || !evaluation || session.phase.id === "sandbox") return
  const steps = session.phase.steps
  const stepsDone = steps !== null && session.stepIndex !== null && session.stepIndex >= steps.length
  const expectOk = session.phase.expect.length === 0 || evaluation.won
  const won = steps !== null ? stepsDone && expectOk : evaluation.won
  if (!won) return
  session.won = true
  const id = session.phase.id
  const previous = store.data.progress[id]
  const cost = evaluation.cost
  store.data.progress[id] = {
    won: true,
    bestCost: previous?.bestCost === null || previous?.bestCost === undefined ? cost : Math.min(previous.bestCost, cost),
    stars: [...new Set([...(previous?.stars ?? []), 0])].sort(),
  }
  store.data.draft = null
  store.data = finishAttempt(store.data, true, new Date())
  store.flush()
  showComplete()
}

function openHint() {
  if (!session || session.hintsOpened >= session.phase.hints.length) return
  session.hintsOpened++
  session.hintOffered = Math.max(session.hintOffered, session.hintsOpened)
  store.data = updateAttempt(store.data, (a) => ({ ...a, hintsOpened: a.hintsOpened + 1 }))
  render()
}

function maybeOfferHint() {
  if (!session || session.won || overlayOpen()) return
  const total = session.phase.hints.length
  if (session.hintOffered > session.hintsOpened) return
  if (!shouldOfferHint(session.changes, performance.now() - session.offeredAt, session.hintsOpened, total)) return
  session.hintOffered = session.hintsOpened + 1
  session.changes = 0
  session.offeredAt = performance.now()
  store.data = updateAttempt(store.data, (a) => ({ ...a, hintsOffered: a.hintsOffered + 1 }))
  toasts.show("info", "Quer uma dica?", { label: "Ver dica", run: openHint })
}

function startPhase(phaseId: string, synthetic?: Phase) {
  const phase = synthetic ?? findPhase(phases, phaseId)
  if (!phase) return
  rewinding = false
  rewindBar.hide()
  const draft = store.data.draft
  let resumed = draft && draft.phaseId === phaseId && isValidDoc(draft.doc, catalog) ? draft.doc : null
  if (resumed) {
    try {
      compute(resumed)
    } catch {
      resumed = null
      store.data.draft = null
      store.flush()
    }
  }
  const doc = structuredClone(resumed ?? phase.initial ?? emptyDoc())
  const now = performance.now()
  session = {
    phase,
    startedAt: now,
    changes: 0,
    hintsOpened: 0,
    offeredAt: now,
    hintOffered: 0,
    stepIndex: phase.steps ? 0 : null,
    events: new Set(),
    previewIndex: null,
    won: false,
  }
  hideOverlays()
  toasts.clear()
  blueprint.setLockedIds(phase.keyParts.map((k) => k.id))
  shownWarnings = new Set()
  valuePicker.close()
  sheetQueue = []
  sheetCard.close()
  history = createHistory(doc)
  benchDiscrete = undefined
  blueprintDiscrete = undefined
  view = compute(doc)
  setTool("select")
  bench.frame()
  if (resumed) toasts.show("info", "Continuando de onde você parou.")
  lastDivergences = evaluation?.divergences ?? []
  if (!synthetic) {
    store.data = startAttempt(store.data, phase.id, new Date())
    store.save()
  }
  render()
  if (!synthetic) queueNewDatasheets(phase)
}

function hideOverlays() {
  document.body.classList.remove("showcase")
  bench.setShowcase(false)
  phaseMap.hide()
  titleScreen.hide()
  completeScreen.hide()
  settingsScreen.hide()
  overlay = null
  stageEl.classList.remove("choosing")
}

function cancelRewind() {
  if (!rewinding) return
  rewinding = false
  rewindBar.hide()
  restore(history)
}

function openOverlay(kind: Exclude<Overlay, null>) {
  cancelRewind()
  hideOverlays()
  overlay = kind
  setTool("select")
  stageEl.classList.add("choosing")
}

function closeOverlay() {
  if (!session) return showTitle()
  hideOverlays()
  render()
}

function progressWon(): Set<string> {
  return new Set(Object.entries(store.data.progress).filter(([, p]) => p.won).map(([id]) => id))
}

function nextAvailablePhase(): string | undefined {
  const won = progressWon()
  return phaseOrder(phases).find((id) => !won.has(id) && isPhaseAvailable(phases, won, id)) ?? phaseOrder(phases)[0]
}

function showPhaseList() {
  const won = progressWon()
  openOverlay("map")
  const groups = phases.groups.map((g) => {
    const firstAvailable = g.phases.some((p) => won.has(p.id) || isPhaseAvailable(phases, won, p.id))
    return {
      id: g.id,
      title: g.title,
      concept: g.concept,
      comingSoon: !g.demo,
      // grupo recém-liberado (não o primeiro) ganha a cena de desbloqueio uma vez só
      justUnlocked: g.demo && firstAvailable && g.id !== phases.groups[0].id && !store.data.seenGroups.includes(g.id),
      phases: g.phases.map((p) => ({
        id: p.id,
        goal: p.goal,
        type: p.type,
        won: won.has(p.id),
        available: isPhaseAvailable(phases, won, p.id),
        stars: store.data.progress[p.id]?.stars ?? [],
        bestCost: store.data.progress[p.id]?.bestCost ?? null,
        budget: p.budget,
      })),
    }
  })
  const result = phaseMap.show(
    groups,
    badgeData(),
    session && session.phase.id !== "sandbox" ? { label: `Voltar pra ${session.phase.id}`, run: closeOverlay } : session ? { label: "Voltar pro sandbox", run: closeOverlay } : null,
  )
  if (result.unlockedGroups.length > 0) audio.play("unlock")
}

function badgeData() {
  return { ...levelFor(store.data.xp, rewards), stars: starsTotal(store.data.progress, phases) }
}

const SHOWCASE_PHASE = "g2p3"

function showTitle() {
  openOverlay("title")
  document.body.classList.add("showcase")
  if (!session) {
    const showcase = findPhase(phases, SHOWCASE_PHASE)?.referenceSolution
    if (showcase) {
      view = compute(structuredClone(showcase))
      render()
    }
  }
  bench.setShowcase(true)
  const hasProgress = Object.keys(store.data.progress).length > 0 || store.data.draft !== null
  titleScreen.show({
    canContinue: hasProgress,
    sandboxAvailable: progressWon().size > 0,
    workshopAvailable: false,
    badge: badgeData(),
    daily: { unlocked: false, done: false, streak: store.data.daily.streak },
    onWorkshop: () => undefined,
    onDaily: () => undefined,
    onContinue: () => {
      const draft = store.data.draft?.phaseId
      startPhase(draft && findPhase(phases, draft) ? draft : nextAvailablePhase()!)
    },
    onNew: () => {
      store.data.progress = {}
      store.data.draft = null
      store.data.seenDatasheets = []
      store.data.xp = 0
      store.flush()
      session = null
      startPhase(phaseOrder(phases)[0])
    },
    onSandbox: startSandbox,
    onSettings: () => showSettings("title"),
  })
}

function showSettings(from: Overlay) {
  overlayReturn = from
  openOverlay("settings")
  settingsScreen.show({
    standard: store.data.settings.standard,
    reducedMotion: store.data.settings.reducedMotion,
    systemReducedMotion,
    storageAvailable: store.available,
  })
}

function partsUsed(doc: CircuitDoc, side: "bench" | "blueprint"): { label: string; count: number }[] {
  const placed = new Set((side === "bench" ? doc.bench.placements : doc.blueprint.placements).map((p) => p.id))
  const counts = new Map<string, number>()
  for (const i of doc.instances) if (placed.has(i.id) && !catalog[i.type]?.isTool) counts.set(i.type, (counts.get(i.type) ?? 0) + 1)
  return [...counts].map(([type, count]) => ({ label: PART_LABELS[type] ?? type, count }))
}

function showComplete() {
  if (!session || !evaluation) return
  const phase = session.phase
  const order = phaseOrder(phases)
  const nextId = order[order.indexOf(phase.id) + 1]
  openOverlay("complete")
  completeScreen.show(
    {
      phaseId: phase.id,
      goal: phase.goal,
      rows: phase.expect.map((s) => {
        const label = scenarioLabel(s)
        return { label: label.when ? `${label.when} \u2192 ${label.then}` : label.then, ok: true }
      }),
      parts: partsUsed(view.doc, phase.evaluateOn),
      cost: evaluation.cost,
      budget: phase.budget,
      referenceCost: referenceCost(phase, catalog),
      bestCost: store.data.progress[phase.id]?.bestCost ?? null,
    },
    {
      onNext: nextId ? () => startPhase(nextId) : null,
      onCheaper: () => {
        if (!session) return
        session.won = false
        store.data = startAttempt(store.data, session.phase.id, new Date())
        closeOverlay()
      },
      onMap: showPhaseList,
    },
  )
}

function startSandbox() {
  store.data = finishAttempt(store.data, false, new Date())
  store.save()
  const won = progressWon()
  const unlocked = phases.groups.filter((g) => g.demo && g.phases[0] && (isPhaseAvailable(phases, won, g.phases[0].id) || won.has(g.phases[0].id)))
  const tray: Record<string, number> = {}
  for (const g of unlocked) for (const key of g.unlocks) if (key in catalog) tray[key] = 99
  const sandbox: Phase = {
    id: "sandbox",
    type: "build",
    goal: "sandbox",
    brief: "Monta o que quiser com as peças que você já liberou.",
    tray,
    keyParts: [],
    expect: [],
    evaluateOn: "bench",
    requireMatch: false,
    showDivergence: true,
    budget: null,
    initial: null,
    steps: null,
    hints: [],
    referenceSolution: null,
    stars: [{ kind: "solved" }],
  }
  startPhase("sandbox", sandbox)
}

function onToolbar(id: ToolId) {
  if (overlayOpen() || !session || rewinding) return
  if (session?.previewIndex !== null && session?.previewIndex !== undefined && id !== "currentView") return
  if (id === "select" || id === "wire") setTool(id)
  else if (id === "meter") toggleMeter()
  else if (id === "currentView") {
    currentView = !currentView
    if (currentView) record("currentViewToggled")
    render()
  } else if (id === "rewind") openRewind()
  else if (id === "undo") restore(undo(history))
  else if (id === "redo") restore(redo(history))
}

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  const ctrl = event.ctrlKey || event.metaKey
  if (import.meta.env.DEV && event.ctrlKey && event.altKey && event.code === "KeyE") {
    event.preventDefault()
    void navigator.clipboard.writeText(JSON.stringify(view.doc, null, 2)).then(
      () => toasts.show("info", "Documento copiado."),
      () => toasts.show("warning", "Não deu pra copiar o documento."),
    )
    return
  }
  if (rewinding) return
  if (overlayOpen()) {
    if (event.key === "Escape" && session && overlay === "map") {
      event.preventDefault()
      closeOverlay()
    }
    return
  }
  if (session?.previewIndex !== null && session?.previewIndex !== undefined) {
    if (event.key === "Escape") {
      event.preventDefault()
      setPreview(null)
    }
    return
  }
  if (ctrl && !event.shiftKey && event.key.toLowerCase() === "z") {
    event.preventDefault()
    return restore(undo(history))
  }
  if (ctrl && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
    event.preventDefault()
    return restore(redo(history))
  }
  if (ctrl || event.altKey || !session) return
  if (event.key === "Tab" && !event.shiftKey && document.activeElement === stageEl) {
    event.preventDefault()
    return switchView(activeView === "bench" ? "blueprint" : "bench")
  }
  if (activeEditor().handleKey(event)) {
    event.preventDefault()
    return
  }
  const key = event.key.toLowerCase()
  if (key === "s") setTool("select")
  else if (key === "w") setTool("wire")
  else if (key === "c") onToolbar("currentView")
  else if (key === "m") toggleMeter()
  else if (key === "t") openRewind()
  else if (key === "v") switchView(activeView === "bench" ? "blueprint" : "bench")
})

stageEl.addEventListener(
  "pointerdown",
  (event) => {
    stageEl.focus({ preventScroll: true })
    const target = event.target as HTMLElement
    if (session?.previewIndex !== null && session?.previewIndex !== undefined && !target.closest(".phase-brief")) {
      event.stopPropagation()
      setPreview(null)
    }
  },
  { capture: true },
)

document.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button")
  if (button && !button.disabled) audio.play("click")
})
audio.setVolume(store.data.settings.volume)
audio.preload()

window.addEventListener("pagehide", () => {
  store.data = finishAttempt(store.data, false, new Date())
  store.flush()
})
setInterval(maybeOfferHint, HINT_CHECK_MS)

view = compute(current(history))
stageEl.dataset.view = activeView
toggle.set(activeView)
setTool("select")
render()

showTitle()

if (!store.available) toasts.show("warning", "Não deu pra salvar neste navegador. Dá pra jogar normal, só o progresso não fica guardado.", undefined, 12000)

if (import.meta.env.DEV) Object.assign(window, { __fio: { update, getView: () => view, getEvaluation: () => evaluation, getSave: () => store.data, bench, blueprint, switchView, startPhase, startSandbox } })
