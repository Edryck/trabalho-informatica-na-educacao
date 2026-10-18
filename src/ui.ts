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

export type TrayItem = { type: string; label: string; count: number }

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
        button.innerHTML = `<span class="tray-name">${item.label}</span><span class="tray-count">${item.count}</span>`
        button.addEventListener("click", () => onPick(item.type))
        el.appendChild(button)
      }
    },
  }
}

export function createWirePalette(el: HTMLElement, colors: string[], onPick: (color: string) => void) {
  el.classList.add("wire-palette")
  el.setAttribute("aria-label", "Cor do fio")
  for (const color of colors) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "swatch"
    button.style.background = color
    button.setAttribute("aria-label", `Cor ${color}`)
    button.addEventListener("click", () => onPick(color))
    el.appendChild(button)
  }
  return {
    show(visible: boolean) {
      el.hidden = !visible
    },
  }
}
