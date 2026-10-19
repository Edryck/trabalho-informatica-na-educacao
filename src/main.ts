import "@fontsource/ibm-plex-sans/400.css"
import "@fontsource/ibm-plex-sans/500.css"
import "@fontsource/ibm-plex-sans/600.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "./style.css"
import partsJson from "../data/parts.json"
import { createBench, WIRE_PALETTE, type BenchTool } from "./bench"
import { createBlueprint } from "./blueprint"
import { benchToNetlist, blueprintToNetlist, compare, type Divergence, type PartsCatalog } from "./netlist"
import { solve, type DiscreteState } from "./solver"
import { createHistory, current, emptyDoc, pushSnapshot, redo, undo, type AppView, type CircuitDoc, type History } from "./state"
import {
  createDivergenceBar,
  createHint,
  createPendingList,
  createToolbar,
  createTray,
  createViewToggle,
  createWirePalette,
  type PendingItem,
  type ToolId,
  type TrayItem,
  type ViewName,
} from "./ui"

const catalog = partsJson as unknown as PartsCatalog

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

const SANDBOX_TRAY: Record<string, number> = { battery: 1, lamp: 2, switch: 1, push_button: 1, dc_motor: 1, buzzer: 1 }

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
const [paletteEl, hintEl, toggleEl, barEl, pendingEl] = Array.from({ length: 5 }, () => document.createElement("div"))
stageEl.append(toggleEl, barEl, hintEl)
benchLayer.append(paletteEl)
blueprintLayer.append(pendingEl)

let history: History = createHistory(emptyDoc())
let view: AppView
let divergences: Divergence[] = []
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

const callbacks = (name: ViewName) => ({
  onChange: (doc: CircuitDoc, commit: boolean) => update(doc, { commit }),
  onEvent: (event: string) => {
    if (event === "toolReset") setTool("select")
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
  divergences = compare(blueprintNet, benchNet, catalog)
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
  const pending: TrayItem[] =
    activeView === "bench" ? pendingFor("bench").map((p) => ({ type: `pending:${p.id}`, icon: p.type, label: `${p.id} · posicionar`, count: 1 })) : []
  const stock: TrayItem[] = Object.entries(SANDBOX_TRAY).map(([type, total]) => ({
    type,
    label: PART_LABELS[type] ?? type,
    count: total - doc.instances.filter((i) => i.type === type).length,
  }))
  return [...pending, ...stock]
}

function render() {
  bench.render(view, { currentView, reducedMotion, divergences })
  blueprint.render(view, { currentView, reducedMotion, standard: "IEC", divergences })
  bar.show(divergences)
  pendingList.update(pendingFor("blueprint"))
  tray.update(trayItems(view.doc), activePart)
  toolbar.setHistory(history.index > 0, history.index < history.snapshots.length - 1)
  toolbar.setCurrentView(currentView)
}

function update(doc: CircuitDoc, opts: { commit: boolean }) {
  if (opts.commit) history = pushSnapshot(history, doc)
  view = compute(doc)
  render()
}

function restore(next: History) {
  history = next
  view = compute(current(history))
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
  render()
}

function onToolbar(id: ToolId) {
  if (id === "select" || id === "wire") setTool(id)
  else if (id === "currentView") {
    currentView = !currentView
    render()
  } else if (id === "undo") restore(undo(history))
  else if (id === "redo") restore(redo(history))
}

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  const ctrl = event.ctrlKey || event.metaKey
  if (ctrl && !event.shiftKey && event.key.toLowerCase() === "z") {
    event.preventDefault()
    return restore(undo(history))
  }
  if (ctrl && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
    event.preventDefault()
    return restore(redo(history))
  }
  if (ctrl || event.altKey) return
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

stageEl.addEventListener("pointerdown", () => stageEl.focus({ preventScroll: true }))

view = compute(current(history))
stageEl.dataset.view = activeView
toggle.set(activeView)
setTool("select")
render()

if (import.meta.env.DEV) Object.assign(window, { __fio: { update, getView: () => view, bench, blueprint, switchView } })
