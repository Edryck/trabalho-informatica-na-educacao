import "@fontsource/ibm-plex-sans/400.css"
import "@fontsource/ibm-plex-sans/500.css"
import "@fontsource/ibm-plex-sans/600.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "./style.css"
import partsJson from "../data/parts.json"
import phasesJson from "../data/phases.json"
import { createBench, WIRE_PALETTE, type BenchTool } from "./bench"
import { createBlueprint } from "./blueprint"
import { benchToNetlist, blueprintToNetlist, type PartsCatalog } from "./netlist"
import {
  evaluate,
  evaluateScenarios,
  findPhase,
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
  pushSnapshot,
  redo,
  undo,
  type AppView,
  type CircuitDoc,
  type History,
} from "./state"
import {
  createDivergenceBar,
  createHint,
  createPendingList,
  createPhaseBrief,
  createPhaseList,
  createPreviewBanner,
  createToastHost,
  createToolbar,
  createTray,
  createViewToggle,
  createWirePalette,
  scenarioLabel,
  type PendingItem,
  type ToolId,
  type TrayItem,
  type ViewName,
} from "./ui"

const catalog = partsJson as unknown as PartsCatalog
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
const [paletteEl, hintEl, toggleEl, barEl, pendingEl, briefEl, listEl, toastEl, previewEl] = Array.from({ length: 9 }, () => document.createElement("div"))
stageEl.append(toggleEl, barEl, hintEl, briefEl, previewEl, listEl, toastEl)
benchLayer.append(paletteEl)
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
let choosing = false
let benchDiscrete: DiscreteState | undefined
let blueprintDiscrete: DiscreteState | undefined
let currentView = false
let activePart: string | null = null
let activeView: ViewName = "bench"
const hints: Record<ViewName, string | null> = { bench: null, blueprint: null }
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

const hint = createHint(hintEl)
const bar = createDivergenceBar(barEl)
const toggle = createViewToggle(toggleEl, switchView)
const toasts = createToastHost(toastEl)
const preview = createPreviewBanner(previewEl, () => setPreview(null))
const brief = createPhaseBrief(briefEl, {
  onPreview: (index) => setPreview(session?.previewIndex === index ? null : index),
  onHint: openHint,
  onPhases: showPhaseList,
})
const phaseList = createPhaseList(listEl, startPhase)

const callbacks = (name: ViewName) => ({
  onChange: (doc: CircuitDoc, commit: boolean) => {
    if (session?.previewIndex !== null && session?.previewIndex !== undefined) return
    update(doc, { commit })
  },
  onEvent: (event: string) => {
    if (event === "toolReset") setTool("select")
    else if (event === "lockedLabel") toasts.show("info", "A fase usa esse nome pra conferir o circuito, então ele fica assim.")
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
const tray = createTray(trayEl, (type) => {
  if (!session || choosing || session.previewIndex !== null) return
  const item = type.startsWith("pending:") ? pendingFor("bench").find((p) => `pending:${p.id}` === type) : undefined
  setTool(item ? { place: item.type, id: item.id } : { place: type })
  activePart = type
  tray.update(trayItems(view.doc), activePart)
})
const palette = createWirePalette(paletteEl, WIRE_PALETTE, (color) => bench.setWireColor(color))
palette.show(false)
const pendingList = createPendingList(pendingEl, "Na protoboard, falta no esquema", (item: PendingItem) => setTool({ place: item.type, id: item.id }))

function compute(doc: CircuitDoc): AppView {
  const benchNet = benchToNetlist(doc, catalog)
  const blueprintNet = blueprintToNetlist(doc, catalog)
  const benchResult = solve(benchNet, catalog, { previous: benchDiscrete })
  const blueprintResult = solve(blueprintNet, catalog, { previous: blueprintDiscrete })
  benchDiscrete = benchResult.discrete
  blueprintDiscrete = blueprintResult.discrete
  evaluation = session ? evaluate(session.phase, doc, catalog) : null
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
  const stock: TrayItem[] = Object.entries(session.phase.tray).map(([type, total]) => {
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
  bar.show(divergences)
  pendingList.update(pendingFor("blueprint"))
  tray.update(trayItems(view.doc), activePart)
  toolbar.setHistory(history.index > 0, history.index < history.snapshots.length - 1)
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
    if (session) {
      session.changes++
      if (!session.won) store.saveDraftSoon(session.phase.id, doc)
    }
  }
  view = compute(doc)
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
  if (session && !session.won) store.saveDraftSoon(session.phase.id, view.doc)
  advanceSteps()
  checkVictory()
  render()
}

function activeEditor() {
  return activeView === "bench" ? bench : blueprint
}

function setTool(tool: BenchTool) {
  bench.setTool(activeView === "bench" ? tool : "select")
  blueprint.setTool(activeView === "blueprint" ? tool : "select")
  activePart = typeof tool === "object" ? tool.place : null
  toolbar.setActive(tool === "select" || tool === "wire" ? tool : null)
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
  if (!session || session.won || !evaluation) return
  const steps = session.phase.steps
  const stepsDone = steps !== null && session.stepIndex !== null && session.stepIndex >= steps.length
  const expectOk = session.phase.expect.length === 0 || evaluation.won
  const won = steps !== null ? stepsDone && expectOk : evaluation.won
  if (!won) return
  session.won = true
  const id = session.phase.id
  const previous = store.data.progress[id]
  const cost = evaluation.cost
  store.data.progress[id] = { won: true, bestCost: previous?.bestCost === null || previous?.bestCost === undefined ? cost : Math.min(previous.bestCost, cost) }
  store.data.draft = null
  store.flush()
  const order = phaseOrder(phases)
  const nextId = order[order.indexOf(id) + 1]
  toasts.show("success", "Fase concluída.", nextId ? { label: "Próxima fase", run: () => startPhase(nextId) } : { label: "Ver fases", run: showPhaseList }, 0)
}

function openHint() {
  if (!session || session.hintsOpened >= session.phase.hints.length) return
  session.hintsOpened++
  session.hintOffered = Math.max(session.hintOffered, session.hintsOpened)
  render()
}

function maybeOfferHint() {
  if (!session || session.won || choosing) return
  const total = session.phase.hints.length
  if (session.hintOffered > session.hintsOpened) return
  if (!shouldOfferHint(session.changes, performance.now() - session.offeredAt, session.hintsOpened, total)) return
  session.hintOffered = session.hintsOpened + 1
  session.changes = 0
  session.offeredAt = performance.now()
  toasts.show("info", "Quer uma dica?", { label: "Ver dica", run: openHint })
}

function startPhase(phaseId: string) {
  const phase = findPhase(phases, phaseId)
  if (!phase) return
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
  phaseList.hide()
  toasts.clear()
  choosing = false
  stageEl.classList.remove("choosing")
  blueprint.setLockedIds(phase.keyParts.map((k) => k.id))
  history = createHistory(doc)
  benchDiscrete = undefined
  blueprintDiscrete = undefined
  view = compute(doc)
  setTool("select")
  bench.frame()
  if (resumed) toasts.show("info", "Continuando de onde você parou.")
  render()
}

function showPhaseList() {
  const won = new Set(Object.entries(store.data.progress).filter(([, p]) => p.won).map(([id]) => id))
  choosing = true
  setTool("select")
  stageEl.classList.add("choosing")
  phaseList.show(
    phases.groups
      .filter((g) => g.demo)
      .map((g) => ({
        id: g.id,
        title: g.title,
        phases: g.phases.map((p) => ({ id: p.id, goal: p.goal, type: p.type, won: won.has(p.id), available: isPhaseAvailable(phases, won, p.id) })),
      })),
    session ? { label: `Voltar pra ${session.phase.id}`, run: hidePhaseList } : null,
  )
}

function hidePhaseList() {
  if (!session) return
  choosing = false
  stageEl.classList.remove("choosing")
  phaseList.hide()
  render()
}

function onToolbar(id: ToolId) {
  if (choosing || !session) return
  if (session?.previewIndex !== null && session?.previewIndex !== undefined && id !== "currentView") return
  if (id === "select" || id === "wire") setTool(id)
  else if (id === "currentView") {
    currentView = !currentView
    if (currentView) record("currentViewToggled")
    render()
  } else if (id === "undo") restore(undo(history))
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
  if (choosing) {
    if (event.key === "Escape" && session) {
      event.preventDefault()
      hidePhaseList()
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
  if (event.key === "Tab" && document.activeElement === stageEl) {
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

window.addEventListener("beforeunload", () => store.flush())
setInterval(maybeOfferHint, HINT_CHECK_MS)

view = compute(current(history))
stageEl.dataset.view = activeView
toggle.set(activeView)
setTool("select")
render()

const draftPhase = store.data.draft?.phaseId
if (draftPhase && findPhase(phases, draftPhase)) startPhase(draftPhase)
else showPhaseList()

if (!store.available) toasts.show("warning", "Não deu pra salvar neste navegador. Dá pra jogar normal, só o progresso não fica guardado.", undefined, 12000)

if (import.meta.env.DEV) Object.assign(window, { __fio: { update, getView: () => view, getEvaluation: () => evaluation, bench, blueprint, switchView, startPhase } })
