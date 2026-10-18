import "@fontsource/ibm-plex-sans/400.css"
import "@fontsource/ibm-plex-sans/500.css"
import "@fontsource/ibm-plex-sans/600.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "./style.css"
import partsJson from "../data/parts.json"
import { createBench, WIRE_PALETTE, type BenchTool } from "./bench"
import { benchToNetlist, blueprintToNetlist, type PartsCatalog } from "./netlist"
import { solve, type DiscreteState } from "./solver"
import { createHistory, current, emptyDoc, pushSnapshot, redo, undo, type AppView, type CircuitDoc, type History } from "./state"
import { createToolbar, createTray, createWirePalette, type ToolId, type TrayItem } from "./ui"

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
    <main class="stage" tabindex="0" aria-label="Bancada"></main>
    <section class="tray-host"></section>
  </div>`
const toolbarEl = app.querySelector<HTMLElement>(".toolbar-host")!
const stageEl = app.querySelector<HTMLElement>(".stage")!
const trayEl = app.querySelector<HTMLElement>(".tray-host")!
const paletteEl = document.createElement("div")
stageEl.appendChild(paletteEl)

let history: History = createHistory(emptyDoc())
let view: AppView
let benchDiscrete: DiscreteState | undefined
let blueprintDiscrete: DiscreteState | undefined
let currentView = false
let activePart: string | null = null
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

const bench = createBench(stageEl, catalog, {
  onChange: (doc, commit) => update(doc, { commit }),
  onEvent: (name) => {
    if (name === "toolReset") setTool("select")
  },
  onSelect: (selection) => palette.show(selection?.kind === "wire"),
})

const toolbar = createToolbar(toolbarEl, onToolbar)
const tray = createTray(trayEl, (type) => setTool({ place: type }))
const palette = createWirePalette(paletteEl, WIRE_PALETTE, (color) => bench.setWireColor(color))
palette.show(false)

function compute(doc: CircuitDoc): AppView {
  const benchNet = benchToNetlist(doc, catalog)
  const blueprintNet = blueprintToNetlist(doc, catalog)
  const benchResult = solve(benchNet, catalog, { previous: benchDiscrete })
  const blueprintResult = solve(blueprintNet, catalog, { previous: blueprintDiscrete })
  benchDiscrete = benchResult.discrete
  blueprintDiscrete = blueprintResult.discrete
  return { doc, benchNet, benchResult, blueprintNet, blueprintResult }
}

function trayItems(doc: CircuitDoc): TrayItem[] {
  return Object.entries(SANDBOX_TRAY).map(([type, total]) => ({
    type,
    label: PART_LABELS[type] ?? type,
    count: total - doc.instances.filter((i) => i.type === type).length,
  }))
}

function render() {
  bench.render(view, { currentView, reducedMotion })
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

function setTool(tool: BenchTool) {
  bench.setTool(tool)
  activePart = typeof tool === "object" ? tool.place : null
  toolbar.setActive(tool === "select" || tool === "wire" ? tool : null)
  tray.update(trayItems(view.doc), activePart)
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
  if (bench.handleKey(event)) {
    event.preventDefault()
    return
  }
  const key = event.key.toLowerCase()
  if (key === "s") setTool("select")
  else if (key === "w") setTool("wire")
  else if (key === "c") onToolbar("currentView")
})

view = compute(current(history))
setTool("select")
render()

if (import.meta.env.DEV) Object.assign(window, { __fio: { update, getView: () => view, bench } })
