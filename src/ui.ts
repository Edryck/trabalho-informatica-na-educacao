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
}

function partIcon(type: string): string {
  const body = PART_ICONS[type] ?? '<rect x="5" y="5" width="14" height="14" rx="2"/>'
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

export function createTray(el: HTMLElement, onPick: (type: string) => void) {
  el.classList.add("tray")
  el.setAttribute("aria-label", "Bandeja de peças")
  return {
    update(items: TrayItem[], active: string | null) {
      el.replaceChildren()
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
