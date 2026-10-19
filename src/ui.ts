import type { Divergence, PinRef } from "./netlist"

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
  if (abs === 0 || !Number.isFinite(abs)) return `0,00${THIN_SPACE}${unit}`
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

export type ToolId = "select" | "wire" | "currentView" | "undo" | "redo"

const ICONS: Record<ToolId, string> = {
  select: '<path d="M5 3l12 6-5 2-2 5z"/>',
  wire: '<path d="M4 16c4 0 4-12 8-12s4 12 8 12"/><circle cx="4" cy="16" r="1.6"/><circle cx="20" cy="16" r="1.6"/>',
  currentView: '<path d="M3 12h14"/><path d="M13 7l5 5-5 5"/><circle cx="6" cy="12" r="1.2"/><circle cx="10" cy="12" r="1.2"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 010 12"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 000 12"/>',
}

const TOOL_LABELS: Record<ToolId, string> = {
  select: "Selecionar (S)",
  wire: "Fio (W)",
  currentView: "Visão de corrente (C)",
  undo: "Desfazer (Ctrl+Z)",
  redo: "Refazer (Ctrl+Y)",
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
    setActive(active: "select" | "wire" | null) {
      for (const id of ["select", "wire"] as const) {
        const on = id === active
        buttons.get(id)!.classList.toggle("active", on)
        buttons.get(id)!.setAttribute("aria-pressed", String(on))
      }
    },
    setCurrentView(on: boolean) {
      buttons.get("currentView")!.classList.toggle("active", on)
      buttons.get("currentView")!.setAttribute("aria-pressed", String(on))
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

export function createTray(el: HTMLElement, onPick: (type: string) => void) {
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
        const button = document.createElement("button")
        button.type = "button"
        button.className = "tray-item"
        button.disabled = item.count <= 0
        button.classList.toggle("active", item.type === active)
        button.setAttribute("aria-label", `${item.label}, ${item.count} disponível`)
        button.classList.toggle("pending", item.type.startsWith("pending:"))
        button.innerHTML = `<span class="tray-icon">${partIcon(item.icon ?? item.type)}</span><span class="tray-name">${item.label}</span><span class="tray-count" aria-hidden="true">${item.count}</span>`
        button.addEventListener("click", () => onPick(item.type))
        el.appendChild(button)
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

export function divergenceLabel(d: Divergence): string {
  if (d.kind === "value") {
    const unit = "Ω"
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
    show(list: Divergence[]) {
      const { shown, more } = visibleDivergences(list)
      el.hidden = shown.length === 0
      if (shown.length === 0) return
      el.innerHTML = `${WARNING_ICON}<ul>${shown.map((d) => `<li>${divergenceLabel(d)}</li>`).join("")}</ul>${more > 0 ? `<span class="divergence-more">+${more}</span>` : ""}`
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

type ScenarioLike = { when: Record<string, string>; then: Record<string, string | { current?: [number, number]; voltage?: [number, number] }> }

export function scenarioLabel(scenario: ScenarioLike): { when: string; then: string } {
  const when = Object.entries(scenario.when).map(([id, v]) => `${id} ${INPUT_WORDS[v] ?? v}`)
  const then = Object.entries(scenario.then).map(([id, v]) => {
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

export function createPhaseBrief(el: HTMLElement, handlers: { onPreview(index: number | null): void; onHint(): void; onPhases(): void }) {
  el.className = "phase-brief"
  el.setAttribute("aria-label", "Objetivo da fase")
  el.hidden = true
  el.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    const row = target.closest<HTMLElement>("[data-row]")
    if (row) handlers.onPreview(Number(row.dataset.row))
    if (target.closest("[data-action=hint]")) handlers.onHint()
    if (target.closest("[data-action=phases]")) handlers.onPhases()
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

export type PhaseListGroup = { id: string; title: string; phases: { id: string; goal: string; type: string; available: boolean; won: boolean }[] }

export function createPhaseList(el: HTMLElement, onPick: (phaseId: string) => void) {
  el.className = "phase-list"
  el.hidden = true
  let backAction: { label: string; run(): void } | null = null
  el.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    if (target.closest("[data-action=back]")) return backAction?.run()
    const button = target.closest<HTMLButtonElement>("[data-phase]")
    if (button && !button.disabled) onPick(button.dataset.phase!)
  })
  return {
    show(groups: PhaseListGroup[], back: { label: string; run(): void } | null = null) {
      el.hidden = false
      backAction = back
      el.innerHTML = `<header class="phase-list-head"><h2 class="phase-list-title">Fases</h2>${back ? `<button type="button" class="phase-back" data-action="back">${back.label}</button>` : ""}</header>${groups
        .map(
          (g) => `<section class="phase-group"><h3>${g.title}</h3><ol>${g.phases
            .map((p) => {
              const status = p.won ? "concluída" : p.available ? "disponível" : "bloqueada"
              const icon = p.won ? CHECK_ICON : p.available ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="6"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="6" y="11" width="12" height="9" rx="1.5"/><path d="M9 11V8a3 3 0 016 0v3"/></svg>'
              return `<li><button type="button" class="phase-item ${p.won ? "won" : p.available ? "available" : "locked"}" data-phase="${p.id}" ${p.available || p.won ? "" : "disabled"} aria-label="${p.id}, ${p.goal}, ${status}"><span class="phase-icon">${icon}</span><span class="mono">${p.id}</span><span class="phase-goal">${p.goal}</span><span class="phase-type">${PHASE_TAGS[p.type] ?? p.type}</span></button></li>`
            })
            .join("")}</ol></section>`,
        )
        .join("")}`
    },
    hide() {
      el.hidden = true
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
