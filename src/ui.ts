import type { Divergence, PinRef } from "./netlist"
import type { Warning } from "./solver"

export type Unit = "V" | "A" | "Ω" | "W"

const PREFIXES: Record<number, string> = { [-9]: "n", [-6]: "µ", [-3]: "m", 0: "", 3: "k", 6: "M" }
const THIN_SPACE = " "
const MINUS = "−"

function decimalsFor(scaled: number): number {
  if (scaled >= 100) return 0
  if (scaled >= 10) return 1
  return 2
}

export function formatValue(value: number, unit: Unit): string {
  const abs = Math.abs(value)
  if (!Number.isFinite(abs)) return `—${THIN_SPACE}${unit}`
  if (abs === 0) return `0,00${THIN_SPACE}${unit}`
  let exponent = Math.min(6, Math.max(-9, Math.floor(Math.log10(abs) / 3) * 3))
  let scaled = abs / 10 ** exponent
  let text = scaled.toFixed(decimalsFor(scaled))
  if (Number(text) >= 1000 && exponent < 6) {
    exponent += 3
    scaled = abs / 10 ** exponent
    text = scaled.toFixed(decimalsFor(scaled))
  }
  const sign = value < 0 ? MINUS : ""
  return `${sign}${text.replace(".", ",")}${THIN_SPACE}${PREFIXES[exponent]}${unit}`
}

const SPEED_MIN = 0.5
const SPEED_MAX = 8
const CURRENT_VISIBLE = 1e-6

export function particleSpeed(current: number): number {
  const abs = Math.abs(current)
  if (abs < CURRENT_VISIBLE) return 0
  const t = (Math.log10(abs) + 4) / 4
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, SPEED_MIN + t * (SPEED_MAX - SPEED_MIN)))
}

export type ToolId = "select" | "wire" | "meter" | "currentView" | "undo" | "redo" | "rewind"

const ICONS: Record<ToolId, string> = {
  select: '<path d="M5 3l12 6-5 2-2 5z"/>',
  wire: '<path d="M4 16c4 0 4-12 8-12s4 12 8 12"/><circle cx="4" cy="16" r="1.6"/><circle cx="20" cy="16" r="1.6"/>',
  meter: '<rect x="6" y="3" width="12" height="18" rx="2"/><rect x="8.5" y="5.5" width="7" height="4" rx="0.5"/><circle cx="12" cy="15" r="2.5"/><path d="M12 15l1.5-1.5"/>',
  currentView: '<path d="M3 12h14"/><path d="M13 7l5 5-5 5"/><circle cx="6" cy="12" r="1.2"/><circle cx="10" cy="12" r="1.2"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 010 12"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 000 12"/>',
  rewind: '<path d="M11 6l-6 6 6 6"/><path d="M19 6l-6 6 6 6"/><path d="M4 21h16"/>',
}

const TOOL_LABELS: Record<ToolId, string> = {
  select: "Selecionar (S)",
  wire: "Fio (W)",
  meter: "Multímetro (M)",
  currentView: "Visão de corrente (C)",
  undo: "Desfazer (Ctrl+Z)",
  redo: "Refazer (Ctrl+Y)",
  rewind: "Linha do tempo (T)",
}

function icon(id: ToolId): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>`
}

export function createToolbar(el: HTMLElement, onTool: (tool: ToolId) => void) {
  el.classList.add("toolbar")
  el.setAttribute("role", "toolbar")
  el.setAttribute("aria-orientation", "vertical")
  const buttons = new Map<ToolId, HTMLButtonElement>()
  for (const id of Object.keys(ICONS) as ToolId[]) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "tool"
    button.innerHTML = icon(id)
    button.title = TOOL_LABELS[id]
    button.setAttribute("aria-label", TOOL_LABELS[id])
    button.addEventListener("click", () => onTool(id))
    if (id === "undo") el.appendChild(Object.assign(document.createElement("div"), { className: "toolbar-gap" }))
    el.appendChild(button)
    buttons.set(id, button)
  }
  return {
    setMeterAvailable(available: boolean) {
      buttons.get("meter")!.hidden = !available
    },
    setActive(active: "select" | "wire" | "meter" | null) {
      for (const id of ["select", "wire", "meter"] as const) {
        const on = id === active
        buttons.get(id)!.classList.toggle("active", on)
        buttons.get(id)!.setAttribute("aria-pressed", String(on))
      }
    },
    setCurrentView(on: boolean) {
      buttons.get("currentView")!.classList.toggle("active", on)
      buttons.get("currentView")!.setAttribute("aria-pressed", String(on))
    },
    setRewind(enabled: boolean) {
      buttons.get("rewind")!.disabled = !enabled
    },
    setHistory(canUndo: boolean, canRedo: boolean) {
      buttons.get("undo")!.disabled = !canUndo
      buttons.get("redo")!.disabled = !canRedo
    },
  }
}

export type TrayItem = { type: string; label: string; count: number; icon?: string }

const PART_ICONS: Record<string, string> = {
  battery: '<rect x="5" y="7" width="14" height="13" rx="1.5"/><path d="M9 4v3M15 4v3M8.5 12h3M10 10.5v3M13 12h2.5"/>',
  lamp: '<path d="M9 17h6M10 20h4"/><path d="M12 3a6 6 0 00-3.5 10.9V17h7v-3.1A6 6 0 0012 3z"/>',
  switch: '<circle cx="5" cy="15" r="1.5"/><circle cx="19" cy="15" r="1.5"/><path d="M6.4 14.3L17 8"/>',
  push_button: '<rect x="4" y="11" width="16" height="7" rx="1.5"/><path d="M9 11V8h6v3"/>',
  dc_motor: '<circle cx="12" cy="12" r="7"/><path d="M9 15V9l3 4 3-4v6"/>',
  buzzer: '<circle cx="9" cy="13" r="5"/><path d="M16 9a5 5 0 010 8M18.5 6.5a8.5 8.5 0 010 13"/>',
  resistor: '<path d="M2 12h4l1.5-3 3 6 3-6 3 6 1.5-3h4"/>',
  led: '<path d="M7 7l7 5-7 5z"/><path d="M14 7v10M3 12h4M14 12h7M16 5l2-2M18 7l2-2"/>',
  chip: '<rect x="7" y="4" width="10" height="16" rx="1"/><path d="M10.5 4a1.5 1.5 0 003 0M4 7h3M4 10.5h3M4 14h3M4 17.5h3M17 7h3M17 10.5h3M17 14h3M17 17.5h3"/>',
  logic_switch: '<rect x="4" y="9" width="16" height="7" rx="3.5"/><circle cx="16" cy="12.5" r="2"/><path d="M7 5h2M8 4v2M15 5h2"/>',
  logic_probe: '<path d="M14 3l7 7-9 9-4 1 1-4z"/><path d="M8 16l-5 5"/><path d="M12 7l5 5"/>',
}

function partIcon(type: string): string {
  const body = PART_ICONS[type.startsWith("chip_") ? "chip" : type] ?? '<rect x="5" y="5" width="14" height="14" rx="2"/>'
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

export function createTray(el: HTMLElement, onPick: (type: string) => void, onInfo?: (type: string) => void) {
  el.classList.add("tray")
  el.setAttribute("aria-label", "Bandeja de peças")
  return {
    update(items: TrayItem[], active: string | null, emptyText = "Nenhuma peça extra nesta fase.") {
      el.replaceChildren()
      if (items.length === 0) {
        const empty = document.createElement("p")
        empty.className = "tray-empty"
        empty.textContent = emptyText
        el.appendChild(empty)
        return
      }
      for (const item of items) {
        const wrap = document.createElement("div")
        wrap.className = "tray-slot"
        const button = document.createElement("button")
        button.type = "button"
        button.className = "tray-item"
        button.disabled = item.count <= 0
        button.classList.toggle("active", item.type === active)
        button.setAttribute("aria-label", `${item.label}, ${item.count} disponível`)
        button.classList.toggle("pending", item.type.startsWith("pending:"))
        button.innerHTML = `<span class="tray-icon">${partIcon(item.icon ?? item.type)}</span><span class="tray-name">${item.label}</span><span class="tray-count" aria-hidden="true">${item.count}</span>`
        button.addEventListener("click", () => onPick(item.type))
        wrap.appendChild(button)
        const infoType = item.icon ?? item.type
        if (onInfo && !infoType.startsWith("pending:")) {
          const info = document.createElement("button")
          info.type = "button"
          info.className = "tray-info"
          info.setAttribute("aria-label", `Datasheet: ${item.label}`)
          info.title = "Datasheet"
          info.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>'
          info.addEventListener("click", () => onInfo(infoType))
          wrap.appendChild(info)
        }
        el.appendChild(wrap)
      }
    },
  }
}

export function createWirePalette(el: HTMLElement, colors: { value: string; name: string }[], onPick: (color: string) => void) {
  el.classList.add("wire-palette")
  el.setAttribute("role", "group")
  el.setAttribute("aria-label", "Cor do fio")
  const title = document.createElement("span")
  title.className = "palette-title"
  title.textContent = "Cor do fio"
  el.appendChild(title)
  for (const { value: color, name } of colors) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "swatch"
    button.style.background = color
    button.title = name
    button.setAttribute("aria-label", name)
    button.addEventListener("click", () => onPick(color))
    el.appendChild(button)
  }
  return {
    show(visible: boolean) {
      el.hidden = !visible
    },
  }
}

export function createHint(el: HTMLElement) {
  el.className = "stage-hint"
  el.setAttribute("role", "status")
  el.hidden = true
  return {
    show(text: string | null) {
      el.hidden = text === null
      el.textContent = text ?? ""
    },
  }
}

export function visibleDivergences(list: Divergence[]): { shown: Divergence[]; more: number } {
  return { shown: list.slice(0, 2), more: Math.max(0, list.length - 2) }
}

function pinText(ref: PinRef): string {
  const dot = ref.indexOf(".")
  const pin = ref.slice(dot + 1)
  return `${ref.slice(0, dot)} ${pin === "-" ? MINUS : pin}`
}

export function divergenceLabel(d: Divergence, unitFor: (partId: string) => Unit = () => "Ω"): string {
  if (d.kind === "value") {
    const unit = unitFor(d.partId)
    return `${d.partId} no esquema é ${formatValue(d.specValue ?? 0, unit)}, a peça na protoboard é ${formatValue(d.actualValue ?? 0, unit)}`
  }
  if (d.kind === "pending") {
    return d.side === "bench" ? `${d.partId} está no esquema, mas ainda não está na protoboard` : `${d.partId} está na protoboard, mas ainda não está no esquema`
  }
  const where = pinText(`${d.partId}.${d.pin ?? ""}`)
  const expected = d.expected?.length ? `liga em ${d.expected.map(pinText).join(", ")}` : "fica solta"
  const actual = d.actual?.length ? `liga em ${d.actual.map(pinText).join(", ")}` : "está solta"
  return `${where}: no esquema ${expected}, na protoboard ${actual}`
}

const WARNING_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/></svg>'

export function createDivergenceBar(el: HTMLElement) {
  el.className = "divergence-bar"
  el.setAttribute("role", "status")
  el.hidden = true
  return {
    show(list: Divergence[], unitFor?: (partId: string) => Unit) {
      const { shown, more } = visibleDivergences(list)
      el.hidden = shown.length === 0
      if (shown.length === 0) return
      el.innerHTML = `${WARNING_ICON}<ul>${shown.map((d) => `<li>${divergenceLabel(d, unitFor)}</li>`).join("")}</ul>${more > 0 ? `<span class="divergence-more">+${more}</span>` : ""}`
    },
  }
}

export type ViewName = "blueprint" | "bench"

export function createViewToggle(el: HTMLElement, onSwitch: (view: ViewName) => void) {
  el.className = "view-toggle"
  el.setAttribute("role", "tablist")
  el.setAttribute("aria-label", "Vista")
  const buttons = new Map<ViewName, HTMLButtonElement>()
  for (const [name, text] of [["blueprint", "Blueprint"], ["bench", "Bancada"]] as const) {
    const button = document.createElement("button")
    button.type = "button"
    button.setAttribute("role", "tab")
    button.textContent = text
    button.title = `${text} (V)`
    button.addEventListener("click", () => onSwitch(name))
    el.appendChild(button)
    buttons.set(name, button)
  }
  return {
    set(active: ViewName) {
      for (const [name, button] of buttons) {
        button.setAttribute("aria-selected", String(name === active))
        button.classList.toggle("active", name === active)
      }
    },
  }
}

export type PendingItem = { id: string; type: string; label: string }

export function createPendingList(el: HTMLElement, title: string, onPick: (item: PendingItem) => void) {
  el.className = "pending-list"
  el.hidden = true
  return {
    update(items: PendingItem[]) {
      el.hidden = items.length === 0
      el.replaceChildren()
      if (items.length === 0) return
      const heading = document.createElement("p")
      heading.className = "pending-title"
      heading.textContent = title
      el.appendChild(heading)
      for (const item of items) {
        const button = document.createElement("button")
        button.type = "button"
        button.className = "pending-item"
        button.innerHTML = `<span class="tray-icon">${partIcon(item.type)}</span><span>${item.id}</span><span class="pending-type">${item.label}</span>`
        button.setAttribute("aria-label", `Posicionar ${item.id}, ${item.label}`)
        button.addEventListener("click", () => onPick(item))
        el.appendChild(button)
      }
    },
  }
}

const PHASE_TAGS: Record<string, string> = { tutorial: "tutorial", build: "montagem", repair: "conserto", order: "encomenda" }

const INPUT_WORDS: Record<string, string> = {
  on: "ligada",
  off: "desligada",
  pressed: "apertado",
  released: "solto",
  "1": "em 1",
  "0": "em 0",
}

const STATE_WORDS: Record<string, string> = {
  lit: "acesa",
  off: "apagada",
  spinning: "girando",
  cw: "girando no sentido horário",
  ccw: "girando no sentido anti-horário",
  sounding: "tocando",
  "1": "em 1",
  "0": "em 0",
}

function offWord(id: string): string {
  if (/^LED/.test(id)) return "apagado"
  if (/^M/.test(id)) return "parado"
  if (/^Z/.test(id)) return "em silêncio"
  return "apagada"
}

type ScenarioLike = { when: Record<string, string>; then: Record<string, string | { current?: [number, number]; voltage?: [number, number] }> }

export function scenarioLabel(scenario: ScenarioLike): { when: string; then: string } {
  const when = Object.entries(scenario.when).map(([id, v]) => `${id} ${INPUT_WORDS[v] ?? v}`)
  const then = Object.entries(scenario.then).map(([id, v]) => {
    if (v === "off") return `${id} ${offWord(id)}`
    if (typeof v === "string") return `${id} ${STATE_WORDS[v] ?? v}`
    const parts: string[] = []
    if (v.current) parts.push(`corrente entre ${formatValue(v.current[0], "A")} e ${formatValue(v.current[1], "A")}`)
    if (v.voltage) parts.push(`tensão entre ${formatValue(v.voltage[0], "V")} e ${formatValue(v.voltage[1], "V")}`)
    return `${id} com ${parts.join(" e ")}`
  })
  return { when: when.join(", "), then: then.join(", ") }
}

const CHECK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>'
const CROSS_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'

export type BriefPhase = { id: string; type: string; goal: string; brief: string; budget: number | null; expect: ScenarioLike[]; steps: { text: string }[] | null; hints: string[] }
export type BriefState = {
  rows: { ok: boolean; isCurrent: boolean }[]
  cost: number
  budgetOk: boolean
  previewIndex: number | null
  stepIndex: number | null
  hintsOpened: number
  won: boolean
}

export function createPhaseBrief(el: HTMLElement, handlers: { onPreview(index: number | null): void; onHint(): void; onPhases(): void; onRestart(): void }) {
  el.className = "phase-brief"
  el.setAttribute("aria-label", "Objetivo da fase")
  el.hidden = true
  let confirmingRestart = false
  el.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    const row = target.closest<HTMLElement>("[data-row]")
    if (row) handlers.onPreview(Number(row.dataset.row))
    if (target.closest("[data-action=hint]")) handlers.onHint()
    if (target.closest("[data-action=phases]")) handlers.onPhases()
    if (target.closest("[data-action=restart]")) {
      if (confirmingRestart) {
        confirmingRestart = false
        handlers.onRestart()
      } else {
        confirmingRestart = true
        const button = el.querySelector<HTMLButtonElement>("[data-action=restart]")
        if (button) button.textContent = "Confirmar recomeço"
      }
    }
  })
  return {
    hide() {
      el.hidden = true
    },
    render(phase: BriefPhase, state: BriefState) {
      el.hidden = false
      const step = state.stepIndex !== null && phase.steps ? phase.steps[state.stepIndex] : null
      const rows = phase.expect
        .map((s, i) => {
          const label = scenarioLabel(s)
          const row = state.rows[i]
          const ok = row?.ok ?? false
          const classes = ["check-row", ok ? "ok" : "fail", row?.isCurrent ? "current" : "", state.previewIndex === i ? "previewing" : ""].join(" ")
          const when = label.when ? `<span class="check-when">${label.when}</span>` : ""
          return `<li><button type="button" class="${classes}" data-row="${i}" aria-pressed="${state.previewIndex === i}" aria-label="${ok ? "Cumprido" : "Ainda não"}: ${label.when ? `${label.when}, ` : ""}${label.then}. Clique pra pré-visualizar."><span class="check-icon">${ok ? CHECK_ICON : CROSS_ICON}</span><span class="check-text">${when}<span class="check-then">${label.then}</span></span>${row?.isCurrent ? '<span class="check-now">agora</span>' : ""}</button></li>`
        })
        .join("")
      const budget =
        phase.budget !== null
          ? `<p class="brief-budget ${state.budgetOk ? "" : "over"}"><span>Custo</span><span class="mono">${state.cost} / ${phase.budget} créditos</span></p>`
          : ""
      const hints = phase.hints
        .slice(0, state.hintsOpened)
        .map((h, i) => `<li><span class="mono">${i + 1}</span>${h}</li>`)
        .join("")
      const moreHints = state.hintsOpened < phase.hints.length
      el.innerHTML = `
        <header class="brief-head">
          <span class="brief-tag">${PHASE_TAGS[phase.type] ?? phase.type}</span>
          <span class="brief-id mono">${phase.id}</span>
          <button type="button" class="brief-link" data-action="restart" title="Volta a fase pro começo">${confirmingRestart ? "Confirmar recomeço" : "Recomeçar"}</button>
          <button type="button" class="brief-link" data-action="phases">Fases</button>
        </header>
        <h2 class="brief-title">${phase.goal.charAt(0).toUpperCase()}${phase.goal.slice(1)}</h2>
        <p class="brief-text">${phase.brief}</p>
        ${step ? `<p class="brief-step"><span class="mono">${(state.stepIndex ?? 0) + 1}/${phase.steps!.length}</span>${step.text}</p>` : ""}
        ${rows ? `<ul class="checklist">${rows}</ul>` : ""}
        ${budget}
        ${hints ? `<ol class="hint-list">${hints}</ol>` : ""}
        ${phase.hints.length > 0 ? `<button type="button" class="brief-hint" data-action="hint" ${moreHints ? "" : "disabled"}>${moreHints ? (state.hintsOpened === 0 ? "Ver uma dica" : "Ver mais uma dica") : "Sem mais dicas"}</button>` : ""}`
    },
  }
}

export type PhaseMapGroup = {
  id: string
  title: string
  concept: string
  comingSoon: boolean
  phases: { id: string; goal: string; type: string; available: boolean; won: boolean; bestCost: number | null; budget: number | null }[]
}

const LOCK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="6" y="11" width="12" height="9" rx="1.5"/><path d="M9 11V8a3 3 0 016 0v3"/></svg>'
const OPEN_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="6"/></svg>'

export function createPhaseMap(el: HTMLElement, onPick: (phaseId: string) => void, nav: { onSettings(): void; onHome(): void }) {
  el.className = "phase-map"
  el.hidden = true
  let backAction: { label: string; run(): void } | null = null
  el.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    if (target.closest("[data-action=back]")) return backAction?.run()
    if (target.closest("[data-action=settings]")) return nav.onSettings()
    if (target.closest("[data-action=home]")) return nav.onHome()
    const button = target.closest<HTMLButtonElement>("[data-phase]")
    if (button && !button.disabled) onPick(button.dataset.phase!)
  })
  return {
    show(groups: PhaseMapGroup[], back: { label: string; run(): void } | null = null) {
      el.hidden = false
      backAction = back
      const columns = groups
        .map((g) => {
          if (g.comingSoon)
            return `<section class="map-group soon" aria-label="${g.title}, em breve"><h3>${g.title}</h3><p class="map-concept">${g.concept}</p><p class="map-soon">em breve</p></section>`
          const done = g.phases.filter((p) => p.won).length
          const nodes = g.phases
            .map((p) => {
              const state = p.won ? "won" : p.available ? "available" : "locked"
              const status = p.won ? "concluída" : p.available ? "disponível" : "bloqueada"
              const icon = p.won ? CHECK_ICON : p.available ? OPEN_ICON : LOCK_ICON
              const cost = p.won && p.budget !== null && p.bestCost !== null ? `<span class="map-cost mono">${p.bestCost}/${p.budget}</span>` : ""
              return `<li><button type="button" class="map-node ${state}" data-phase="${p.id}" ${p.available || p.won ? "" : "disabled"} aria-label="${p.id}, ${p.goal}, ${PHASE_TAGS[p.type] ?? p.type}, ${status}"><span class="map-dot">${icon}</span><span class="map-text"><span class="map-goal">${p.goal}</span><span class="map-meta"><span class="mono">${p.id}</span> \u00b7 ${PHASE_TAGS[p.type] ?? p.type}</span></span>${cost}</button></li>`
            })
            .join("")
          return `<section class="map-group"><h3>${g.title}</h3><p class="map-concept">${g.concept}</p><p class="map-progress mono">${done}/${g.phases.length}</p><ol>${nodes}</ol></section>`
        })
        .join("")
      el.innerHTML = `<header class="phase-list-head"><h2 class="phase-list-title">Mapa de fases</h2><button type="button" class="phase-back" data-action="home">Início</button><button type="button" class="phase-back" data-action="settings">Configurações</button>${back ? `<button type="button" class="phase-back primary" data-action="back">${back.label}</button>` : ""}</header><div class="map-columns">${columns}</div>`
    },
    hide() {
      el.hidden = true
    },
  }
}

export type TitleActions = { canContinue: boolean; onContinue(): void; onNew(): void; onSandbox(): void; onSettings(): void; sandboxAvailable: boolean }

export function createTitleScreen(el: HTMLElement) {
  el.className = "title-screen"
  el.hidden = true
  let actions: TitleActions | null = null
  let confirming = false
  el.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action
    if (!action || !actions) return
    if (action === "continue") actions.onContinue()
    if (action === "sandbox") actions.onSandbox()
    if (action === "settings") actions.onSettings()
    if (action === "new") {
      if (actions.canContinue && !confirming) {
        confirming = true
        render()
        return
      }
      confirming = false
      actions.onNew()
    }
    if (action === "cancel") {
      confirming = false
      render()
    }
  })
  function render() {
    if (!actions) return
    el.innerHTML = `
      <div class="title-inner">
        <h1 class="title-name">Fio Contínuo</h1>
        <p class="title-tagline">A corrente dá a volta inteira. Desenha, monta, mede e conserta.</p>
        <div class="title-actions">
          ${actions.canContinue ? '<button type="button" class="btn-primary" data-action="continue">Continuar</button>' : ""}
          ${
            confirming
              ? '<p class="title-confirm">Começar de novo apaga o progresso salvo neste navegador.</p><button type="button" class="btn-danger" data-action="new">Apagar e começar</button><button type="button" class="btn-secondary" data-action="cancel">Manter progresso</button>'
              : `<button type="button" class="${actions.canContinue ? "btn-secondary" : "btn-primary"}" data-action="new">Nova partida</button>`
          }
          ${actions.sandboxAvailable ? '<button type="button" class="btn-secondary" data-action="sandbox">Sandbox</button>' : ""}
          <button type="button" class="btn-secondary" data-action="settings">Configurações</button>
        </div>
      </div>`
    el.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true })
  }
  return {
    show(next: TitleActions) {
      actions = next
      confirming = false
      el.hidden = false
      render()
    },
    hide() {
      el.hidden = true
    },
  }
}

export type CompleteSummary = {
  phaseId: string
  goal: string
  rows: { label: string; ok: boolean }[]
  parts: { label: string; count: number }[]
  cost: number
  budget: number | null
  referenceCost: number | null
  bestCost: number | null
}

export function createCompleteScreen(el: HTMLElement) {
  el.className = "complete-screen"
  el.hidden = true
  let handlers: { onNext: (() => void) | null; onCheaper(): void; onMap(): void } | null = null
  el.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action
    if (!handlers) return
    if (action === "next") handlers.onNext?.()
    if (action === "cheaper") handlers.onCheaper()
    if (action === "map") handlers.onMap()
  })
  return {
    show(summary: CompleteSummary, next: { onNext: (() => void) | null; onCheaper(): void; onMap(): void }) {
      handlers = next
      el.hidden = false
      const cheaper = summary.referenceCost !== null && summary.cost > summary.referenceCost
      const costLine =
        summary.referenceCost === null
          ? ""
          : cheaper
            ? `<p class="complete-cost">Seu circuito: <span class="mono">${summary.cost} créditos</span> \u00b7 dá pra fazer com <span class="mono">${summary.referenceCost}</span>.</p>`
            : `<p class="complete-cost">Seu circuito: <span class="mono">${summary.cost} créditos</span>. Esse é o menor custo que a gente conhece.</p>`
      el.innerHTML = `
        <div class="complete-card" role="dialog" aria-label="Fase concluída">
          <p class="complete-tag mono">${summary.phaseId}</p>
          <h2>Fase concluída</h2>
          <p class="complete-goal">${summary.goal.charAt(0).toUpperCase()}${summary.goal.slice(1)}</p>
          ${summary.rows.length ? `<ul class="complete-rows">${summary.rows.map((r) => `<li><span class="check-icon ok">${CHECK_ICON}</span>${r.label}</li>`).join("")}</ul>` : ""}
          ${summary.parts.length ? `<p class="complete-parts">Peças usadas: ${summary.parts.map((p) => `${p.count}\u00d7 ${p.label}`).join(", ")}</p>` : ""}
          ${costLine}
          ${summary.bestCost !== null && summary.budget !== null ? `<p class="complete-best">Melhor versão até agora: <span class="mono">${summary.bestCost} créditos</span></p>` : ""}
          <div class="complete-actions">
            ${next.onNext ? '<button type="button" class="btn-primary" data-action="next">Próxima fase</button>' : ""}
            ${cheaper ? '<button type="button" class="btn-secondary" data-action="cheaper">Tentar versão mais barata</button>' : ""}
            <button type="button" class="btn-secondary" data-action="map">Mapa de fases</button>
          </div>
        </div>`
      el.querySelector<HTMLButtonElement>(".btn-primary, .btn-secondary")?.focus({ preventScroll: true })
    },
    hide() {
      el.hidden = true
    },
  }
}

export type SettingsView = { standard: "IEC" | "ANSI"; reducedMotion: boolean; systemReducedMotion: boolean; storageAvailable: boolean }
export type SettingsHandlers = { onStandard(s: "IEC" | "ANSI"): void; onReducedMotion(on: boolean): void; onReset(): void; onExport(): void; onBack(): void }

export function createSettingsScreen(el: HTMLElement, handlers: SettingsHandlers) {
  el.className = "settings-screen"
  el.hidden = true
  let confirming = false
  let state: SettingsView | null = null
  el.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")
    const action = target?.dataset.action
    if (action === "iec") handlers.onStandard("IEC")
    if (action === "ansi") handlers.onStandard("ANSI")
    if (action === "export") handlers.onExport()
    if (action === "back") handlers.onBack()
    if (action === "reset") {
      if (!confirming) {
        confirming = true
        render()
        return
      }
      confirming = false
      handlers.onReset()
    }
    if (action === "keep") {
      confirming = false
      render()
    }
  })
  el.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement
    if (input.name === "motion") handlers.onReducedMotion(input.checked)
  })
  function render() {
    if (!state) return
    el.innerHTML = `
      <div class="settings-card">
        <header class="phase-list-head"><h2 class="phase-list-title">Configurações</h2><button type="button" class="phase-back" data-action="back">Voltar</button></header>
        <section class="settings-row">
          <div><h3>Norma dos símbolos</h3><p>Como os componentes aparecem no blueprint e nos datasheets.</p></div>
          <div class="segmented" role="radiogroup" aria-label="Norma dos símbolos">
            <button type="button" role="radio" aria-checked="${state.standard === "IEC"}" data-action="iec">IEC</button>
            <button type="button" role="radio" aria-checked="${state.standard === "ANSI"}" data-action="ansi">ANSI</button>
          </div>
        </section>
        <section class="settings-row">
          <div><h3>Movimento reduzido</h3><p>Troca as partículas da corrente por setas paradas e corta as transições.${state.systemReducedMotion ? " Seu sistema já pede isso, então fica ligado." : ""}</p></div>
          <label class="switch-control"><input type="checkbox" name="motion" ${state.reducedMotion || state.systemReducedMotion ? "checked" : ""} ${state.systemReducedMotion ? "disabled" : ""}/><span>Ligado</span></label>
        </section>
        <section class="settings-row">
          <div><h3>Volume</h3><p>Os sons chegam numa versão futura.</p></div>
          <input type="range" min="0" max="1" step="0.1" value="0.8" disabled aria-label="Volume (indisponível)"/>
        </section>
        <section class="settings-row shortcuts">
          <div><h3>Atalhos</h3>
            <dl class="shortcut-list">
              <dt>S</dt><dd>selecionar</dd><dt>W</dt><dd>fio</dd><dt>M</dt><dd>multímetro</dd><dt>C</dt><dd>visão de corrente</dd>
              <dt>V ou Tab</dt><dd>trocar blueprint e bancada</dd><dt>R</dt><dd>girar peça / inverter LED</dd><dt>F</dt><dd>enquadrar</dd>
              <dt>Delete</dt><dd>remover</dd><dt>Esc</dt><dd>cancelar</dd><dt>Ctrl+Z / Ctrl+Y</dt><dd>desfazer / refazer</dd><dt>T</dt><dd>linha do tempo</dd>
            </dl>
          </div>
        </section>
        <section class="settings-row">
          <div><h3>Dados de uso</h3><p>Baixa um arquivo JSON com o tempo, as alterações, as dicas e as medições de cada fase jogada neste navegador.</p></div>
          <button type="button" class="btn-secondary" data-action="export">Exportar dados</button>
        </section>
        <section class="settings-row">
          <div><h3>Progresso</h3><p>${state.storageAvailable ? "Fica salvo só neste navegador." : "Este navegador não está deixando salvar."}</p></div>
          ${
            confirming
              ? '<div class="settings-confirm"><button type="button" class="btn-danger" data-action="reset">Apagar tudo</button><button type="button" class="btn-secondary" data-action="keep">Cancelar</button></div>'
              : '<button type="button" class="btn-secondary" data-action="reset">Zerar progresso</button>'
          }
        </section>
      </div>`
  }
  return {
    show(next: SettingsView) {
      state = next
      el.hidden = false
      render()
    },
    hide() {
      el.hidden = true
      confirming = false
    },
  }
}

export function createToastHost(el: HTMLElement) {
  el.className = "toast-host"
  el.setAttribute("aria-live", "polite")
  return {
    clear() {
      el.replaceChildren()
    },
    show(kind: "success" | "warning" | "error" | "info", text: string, action?: { label: string; run(): void }, durationMs = 6000) {
      const toast = document.createElement("div")
      toast.className = `toast toast-${kind}`
      toast.setAttribute("role", kind === "error" ? "alert" : "status")
      const message = document.createElement("span")
      message.textContent = text
      toast.appendChild(message)
      if (action) {
        const button = document.createElement("button")
        button.type = "button"
        button.textContent = action.label
        button.addEventListener("click", () => {
          action.run()
          toast.remove()
        })
        toast.appendChild(button)
      }
      const close = document.createElement("button")
      close.type = "button"
      close.className = "toast-close"
      close.setAttribute("aria-label", "Fechar aviso")
      close.innerHTML = CROSS_ICON
      close.addEventListener("click", () => toast.remove())
      toast.appendChild(close)
      el.appendChild(toast)
      if (durationMs > 0) setTimeout(() => toast.remove(), durationMs)
    },
  }
}

export function createPreviewBanner(el: HTMLElement, onExit: () => void) {
  el.className = "preview-banner"
  el.hidden = true
  el.setAttribute("role", "status")
  el.addEventListener("click", onExit)
  return {
    show(text: string | null) {
      el.hidden = text === null
      el.innerHTML = text === null ? "" : `<span>Pré-visualizando: ${text}</span><span class="preview-exit">Esc ou clique pra voltar</span>`
    },
  }
}

export type MeterMode = "off" | "V" | "A" | "ohm"
export type MeterView = { mode: "V" | "A" | "ohm"; value: number | null; display: "value" | "OL" | "----" } | undefined

const MODE_LABELS: Record<Exclude<MeterMode, "off">, { short: string; name: string; unit: Unit }> = {
  V: { short: "V", name: "Tensão", unit: "V" },
  A: { short: "A", name: "Corrente", unit: "A" },
  ohm: { short: "Ω", name: "Resistência", unit: "Ω" },
}

export function createMeterHud(el: HTMLElement, onMode: (mode: Exclude<MeterMode, "off">) => void) {
  el.className = "meter-hud"
  el.setAttribute("aria-label", "Multímetro")
  el.hidden = true
  el.innerHTML = `<div class="meter-display" role="status" aria-live="polite"><span class="meter-value mono">—</span><span class="meter-mode"></span></div><div class="meter-modes" role="radiogroup" aria-label="Escala"></div>`
  const valueEl = el.querySelector<HTMLElement>(".meter-value")!
  const modeEl = el.querySelector<HTMLElement>(".meter-mode")!
  const modesEl = el.querySelector<HTMLElement>(".meter-modes")!
  const buttons = new Map<string, HTMLButtonElement>()
  for (const mode of ["V", "A", "ohm"] as const) {
    const button = document.createElement("button")
    button.type = "button"
    button.setAttribute("role", "radio")
    button.textContent = MODE_LABELS[mode].short
    button.title = MODE_LABELS[mode].name
    button.setAttribute("aria-label", MODE_LABELS[mode].name)
    button.addEventListener("click", () => onMode(mode))
    modesEl.appendChild(button)
    buttons.set(mode, button)
  }
  return {
    render(mode: MeterMode, reading: MeterView, probesPlaced: boolean) {
      el.hidden = mode === "off"
      if (mode === "off") return
      for (const [m, button] of buttons) button.setAttribute("aria-checked", String(m === mode))
      modeEl.textContent = MODE_LABELS[mode].name
      el.classList.toggle("overload", reading?.display === "OL")
      if (!probesPlaced || !reading) valueEl.textContent = "— —"
      else if (reading.display === "OL") valueEl.textContent = "OL"
      else if (reading.display === "----") valueEl.textContent = "----"
      else valueEl.textContent = formatValue(reading.value ?? 0, MODE_LABELS[mode].unit)
    },
  }
}

export function createValuePicker(el: HTMLElement) {
  el.className = "value-picker"
  el.hidden = true
  el.setAttribute("role", "dialog")
  el.setAttribute("aria-label", "Escolha a peça")
  let resolve: ((value: number | null) => void) | null = null
  const close = (value: number | null) => {
    el.hidden = true
    el.replaceChildren()
    resolve?.(value)
    resolve = null
  }
  el.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation()
      close(null)
    }
  })
  return {
    open(title: string, options: { value: number; html: string; label: string }[]): Promise<number | null> {
      el.hidden = false
      el.innerHTML = `<p class="picker-title">${title}</p>`
      const list = document.createElement("div")
      list.className = "picker-options"
      for (const option of options) {
        const button = document.createElement("button")
        button.type = "button"
        button.className = "picker-option"
        button.innerHTML = option.html
        button.setAttribute("aria-label", option.label)
        button.addEventListener("click", () => close(option.value))
        list.appendChild(button)
      }
      const cancel = document.createElement("button")
      cancel.type = "button"
      cancel.className = "picker-cancel"
      cancel.textContent = "Cancelar"
      cancel.addEventListener("click", () => close(null))
      el.append(list, cancel)
      list.querySelector<HTMLButtonElement>("button")?.focus()
      return new Promise((r) => {
        resolve = r
      })
    },
    close: () => close(null),
  }
}

export function warningText(w: Warning): string | null {
  const part = w.partId ?? "uma peça"
  switch (w.kind) {
    case "overcurrent":
      return `${part} está com mais corrente do que aguenta. Aqui nada estraga, mas numa bancada de verdade ela não ia durar. Falta resistência no caminho?`
    case "shortCircuit":
      return `${part} está em curto: o + chega no − quase sem nada no meio. Procura o fio ou a coluna que fecha esse atalho.`
    case "ammeterParallel":
      return "Amperímetro em paralelo vira um curto. Abre o circuito e põe o medidor no caminho da corrente."
    case "ohmmeterPowered":
      return "Desliga a fonte antes de medir resistência. Com a bateria ligada, a leitura não quer dizer nada."
    case "floatingInput":
      return `A entrada ${w.pin ?? ""} de ${part} está solta. Entrada sem ligação não é 0 nem 1: liga ela num nível definido.`
    case "undefinedInput":
      return `A entrada ${w.pin ?? ""} de ${part} está numa tensão no meio do caminho, nem 0 nem 1. Confere o que chega nela.`
    case "unpoweredChip":
      return `${part} está sem alimentação. Confere o VCC (pino 14) no + e o GND (pino 7) no −.`
    case "unstable":
      return "O circuito não se decide: a saída fica trocando de estado. Vê se alguma saída volta pra própria entrada."
    default:
      return null
  }
}

export type Datasheet = { title: string; does: string; values: [string, string][]; breadboard: string; mistake: string }

export function createDatasheetCard(el: HTMLElement, onClose: (key: string) => void) {
  el.className = "datasheet-card"
  el.hidden = true
  el.setAttribute("role", "dialog")
  el.setAttribute("aria-modal", "false")
  let current: string | null = null
  const close = () => {
    if (!current) return
    const key = current
    current = null
    el.hidden = true
    onClose(key)
  }
  el.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-action=close]")) close()
  })
  el.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation()
      close()
    }
  })
  return {
    isOpen: () => current !== null,
    close,
    open(key: string, sheet: Datasheet, symbolSvg: string, isNew: boolean) {
      current = key
      el.hidden = false
      el.setAttribute("aria-label", `Datasheet: ${sheet.title}`)
      el.innerHTML = `
        <header class="sheet-head">
          ${isNew ? '<span class="sheet-new">peça nova</span>' : ""}
          <h2>${sheet.title}</h2>
          <button type="button" class="sheet-close" data-action="close" aria-label="Fechar datasheet">${CROSS_ICON}</button>
        </header>
        <div class="sheet-body">
          <div class="sheet-symbol" aria-hidden="true">${symbolSvg}</div>
          <p class="sheet-does">${sheet.does}</p>
          <dl class="sheet-values">${sheet.values.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
          <h3>Na protoboard</h3>
          <p>${sheet.breadboard}</p>
          <h3>Erro comum</h3>
          <p>${sheet.mistake}</p>
        </div>
        <button type="button" class="sheet-ok" data-action="close">Entendi</button>`
      el.scrollTop = 0
      el.querySelector<HTMLButtonElement>(".sheet-ok")?.focus({ preventScroll: true })
    },
  }
}

export function createRewindBar(el: HTMLElement, handlers: { onPreview(index: number): void; onCommit(index: number): void; onCancel(): void }) {
  el.className = "rewind-bar"
  el.hidden = true
  el.setAttribute("role", "dialog")
  el.setAttribute("aria-label", "Linha do tempo")
  let total = 0
  let index = 0
  el.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement
    if (input.name !== "rewind") return
    index = Number(input.value)
    label()
    handlers.onPreview(index)
  })
  el.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action
    if (action === "commit") handlers.onCommit(index)
    if (action === "cancel") handlers.onCancel()
  })
  el.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation()
      handlers.onCancel()
    }
    if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
      event.stopPropagation()
      handlers.onCommit(index)
    }
  })
  function label() {
    const out = el.querySelector<HTMLElement>(".rewind-step")
    if (out) out.textContent = index === total - 1 ? "agora" : `${total - 1 - index} passo${total - 1 - index === 1 ? "" : "s"} atrás`
  }
  return {
    isOpen: () => !el.hidden,
    show(count: number, current: number) {
      total = count
      index = current
      el.hidden = false
      el.innerHTML = `
        <span class="rewind-title">Linha do tempo</span>
        <input type="range" name="rewind" min="0" max="${Math.max(0, count - 1)}" step="1" value="${current}" aria-label="Momento do circuito" />
        <span class="rewind-step mono"></span>
        <button type="button" class="btn-primary" data-action="commit">Voltar pra cá</button>
        <button type="button" class="btn-secondary" data-action="cancel">Cancelar</button>`
      label()
      el.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true })
    },
    hide() {
      el.hidden = true
    },
  }
}

export type Easing = "easeOutCubic" | "easeOutQuart" | "easeOutBack" | "easeInOutCubic" | "easeInOutQuint" | "easeOutSine"

export const EASING: Record<Easing, string> = {
  easeOutCubic: "cubic-bezier(.33,1,.68,1)",
  easeOutQuart: "cubic-bezier(.25,1,.5,1)",
  easeOutBack: "cubic-bezier(.34,1.56,.64,1)",
  easeInOutCubic: "cubic-bezier(.65,0,.35,1)",
  easeInOutQuint: "cubic-bezier(.83,0,.17,1)",
  easeOutSine: "cubic-bezier(.61,1,.88,1)",
}

let reducedMotionFlag = false

export function setReducedMotion(on: boolean): void {
  reducedMotionFlag = on
}

export function motionReduced(): boolean {
  return reducedMotionFlag
}

function resample(values: number[], points: number): number[] {
  const out: number[] = []
  for (let i = 0; i < points; i++) {
    const t = (i / (points - 1)) * (values.length - 1)
    const lo = Math.floor(t)
    const hi = Math.min(values.length - 1, lo + 1)
    out.push(values[lo] + (values[hi] - values[lo]) * (t - lo))
  }
  out[out.length - 1] = 1
  return out
}

export function sampleSpring(mass = 1, stiffness = 80, damping = 10, points = 40): number[] {
  // integra a mola com passo fixo até assentar e depois reamostra
  const dt = 1 / 60
  let x = 0
  let v = 0
  const values = [0]
  for (let i = 0; i < 6000; i++) {
    const a = (-stiffness * (x - 1) - damping * v) / mass
    v += a * dt
    x += v * dt
    values.push(x)
    if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.001) break
  }
  return resample(values, points)
}

function easeOutBounce(t: number): number {
  const n = 7.5625
  const d = 2.75
  if (t < 1 / d) return n * t * t
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
  return n * (t -= 2.625 / d) * t + 0.984375
}

export function sampleBounce(points = 40): number[] {
  return Array.from({ length: points }, (_, i) => Math.min(1, easeOutBounce(i / (points - 1))))
}

export function cssLinear(samples: number[]): string {
  return `linear(${samples.map((v) => String(Math.round(v * 1000) / 1000)).join(", ")})`
}

const running = new Set<Animation>()

function run(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (reducedMotionFlag || typeof (el as HTMLElement).animate !== "function") return Promise.resolve()
  const animation = (el as HTMLElement).animate(keyframes, { fill: "both", ...options })
  running.add(animation)
  return animation.finished.then(
    () => {
      running.delete(animation)
    },
    () => {
      running.delete(animation)
    },
  )
}

export function skipAnimations(): void {
  for (const animation of [...running]) animation.finish()
}

export function fadeSlide(el: Element, opts: { y?: number; duration?: number; delay?: number } = {}): Promise<void> {
  const y = opts.y ?? 16
  return run(el, [{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: "translateY(0)" }], {
    duration: opts.duration ?? 600,
    delay: opts.delay ?? 0,
    easing: EASING.easeOutCubic,
  })
}

export function stagger<T extends Element>(els: T[], fn: (el: T, delay: number) => Promise<void>, gapMs = 40): Promise<void> {
  return Promise.all(els.map((el, i) => fn(el, i * gapMs))).then(() => undefined)
}

export function pop(el: Element): Promise<void> {
  return run(el, [{ transform: "scale(0.6)", opacity: 0.4 }, { transform: "scale(1)", opacity: 1 }], { duration: 520, easing: EASING.easeOutBack })
}

export function bounceLand(el: Element, fromY = -40): Promise<void> {
  const keyframes = sampleBounce().map((v) => ({ transform: `translateY(${(1 - v) * fromY}px)`, opacity: Math.min(1, v * 3) }))
  return run(el, keyframes, { duration: 700, easing: "linear" })
}

export function springTo(el: Element, prop: "width" | "transform", from: string, to: string): Promise<void> {
  if (prop === "width") {
    const a = parseFloat(from)
    const b = parseFloat(to)
    const unit = to.replace(/[-\d.]/g, "") || "%"
    return run(el, sampleSpring().map((v) => ({ width: `${a + (b - a) * v}${unit}` })), { duration: 1800, easing: "linear" })
  }
  return run(el, [{ transform: from }, { transform: to }], { duration: 1800, easing: cssLinear(sampleSpring()) })
}

export function countUp(el: HTMLElement, from: number, to: number, duration = 1200, format: (n: number) => string = (n) => String(Math.round(n))): Promise<void> {
  if (reducedMotionFlag || typeof requestAnimationFrame !== "function") {
    el.textContent = format(to)
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      el.textContent = format(from + (to - from) * eased)
      if (t < 1 && !skipRequested) requestAnimationFrame(step)
      else {
        el.textContent = format(to)
        resolve()
      }
    }
    requestAnimationFrame(step)
  })
}

let skipRequested = false

export function requestSkip(on: boolean): void {
  skipRequested = on
  if (on) skipAnimations()
}

export function bloom(el: Element): Promise<void> {
  return run(
    el,
    [
      { transform: "scale(0.4)", opacity: 0, filter: "brightness(1.6)" },
      { transform: "scale(1.06)", opacity: 1, filter: "brightness(1.2)", offset: 0.6 },
      { transform: "scale(1)", opacity: 1, filter: "brightness(1)" },
    ],
    { duration: 860, easing: EASING.easeOutBack },
  )
}

export function burst(container: HTMLElement, x: number, y: number): Promise<void> {
  if (reducedMotionFlag) return Promise.resolve()
  const colors = ["var(--color-star)", "var(--color-xp)", "var(--color-accent)"]
  const jobs: Promise<void>[] = []
  for (let i = 0; i < 12; i++) {
    const dot = document.createElement("span")
    dot.className = "burst-dot"
    dot.style.left = `${x}px`
    dot.style.top = `${y}px`
    dot.style.background = colors[i % colors.length]
    container.appendChild(dot)
    const angle = (i / 12) * Math.PI * 2
    const dist = 60 + (i % 3) * 18
    jobs.push(
      run(dot, [{ transform: "translate(-50%,-50%) scale(1)", opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0.3)`, opacity: 0 }], {
        duration: 820,
        easing: EASING.easeOutQuart,
      }).then(() => dot.remove()),
    )
  }
  return Promise.all(jobs).then(() => undefined)
}

export function maskWipe(el: Element): Promise<void> {
  return run(el, [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 700, easing: EASING.easeInOutQuint })
}

export function iris(el: Element, x: number, y: number, r: number, fromR = 0): Promise<void> {
  return run(el, [{ clipPath: `circle(${fromR}px at ${x}px ${y}px)` }, { clipPath: `circle(${r}px at ${x}px ${y}px)` }], { duration: 760, easing: EASING.easeOutQuart })
}

export function softRise(el: Element, delay = 0): Promise<void> {
  return run(el, [{ opacity: 0, transform: "translateY(7px)", filter: "blur(2.3px)" }, { opacity: 1, transform: "translateY(0)", filter: "blur(0)" }], {
    duration: 900,
    delay,
    easing: EASING.easeOutSine,
  })
}

export function press(el: Element): Promise<void> {
  return run(el, [{ transform: "scale(1)" }, { transform: "scale(0.94)", offset: 0.35 }, { transform: "scale(1)" }], { duration: 420, easing: EASING.easeOutCubic })
}

export function nudge(el: Element): Promise<void> {
  return run(el, [{ transform: "translateX(0)" }, { transform: "translateX(-6px)", offset: 0.3 }, { transform: "translateX(4px)", offset: 0.6 }, { transform: "translateX(0)" }], {
    duration: 520,
    easing: EASING.easeOutBack,
  })
}
