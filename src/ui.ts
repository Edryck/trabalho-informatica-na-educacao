import type { Divergence, PartsCatalog, PinRef } from "./netlist"
import type { BlueprintPlacement, BlueprintSegment, Instance } from "./state"
import { resistorBands } from "./parts3d"
import type { Warning } from "./solver"
import type { Lesson, Star, ThenValue, WorkOrder } from "./phases"
import type { GoalState, LevelInfo } from "./game"

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

const BAND_NAMES: Record<string, string> = {
  black: "preto",
  brown: "marrom",
  red: "vermelho",
  orange: "laranja",
  yellow: "amarelo",
  green: "verde",
  blue: "azul",
  violet: "violeta",
  gray: "cinza",
  white: "branco",
  gold: "dourado",
}

export function bandNames(ohms: number): string[] {
  return resistorBands(ohms).map((band) => BAND_NAMES[band] ?? band)
}

export function specRows(type: string, catalog: PartsCatalog): [string, string][] {
  const def = catalog[type]
  if (!def) return []
  const t = def.thresholds ?? {}
  const model = def.model
  switch (model.kind) {
    case "led":
      return [
        ["Queda de tensão", formatValue(model.vf, "V")],
        ["Corrente típica", formatValue(t.nominal, "A")],
        ["Corrente máxima", formatValue(t.maxCurrent, "A")],
      ]
    case "diode":
      return [["Queda de tensão", formatValue(model.vf, "V")]]
    case "lamp":
      return [
        ["Resistência", formatValue(model.resistance, "Ω")],
        ["Corrente máxima", formatValue(t.maxCurrent, "A")],
        ["Acende a partir de", formatValue(t.lit, "A")],
      ]
    case "motor":
      return [
        ["Resistência", formatValue(model.resistance, "Ω")],
        ["Gira a partir de", formatValue(t.spin, "A")],
        ["Corrente máxima", formatValue(t.maxCurrent, "A")],
      ]
    case "buzzer":
      return [
        ["Resistência", formatValue(model.resistance, "Ω")],
        ["Toca a partir de", formatValue(t.sound, "A")],
      ]
    case "battery":
      return [
        ["Tensões", (def.values ?? []).map((v) => formatValue(v, "V")).join(" · ")],
        ["Curto acima de", formatValue(t.shortCurrent, "A")],
      ]
    case "resistor": {
      const values = def.values ?? []
      return [
        ["Valores", `${formatValue(values[0], "Ω")} … ${formatValue(values[values.length - 1], "Ω")}`],
        ...values.map((v): [string, string] => [formatValue(v, "Ω"), bandNames(v).join(" · ")]),
      ]
    }
    case "multimeter":
      return [
        ["Escala V", `${formatValue(t.voltmeterResistance, "Ω")} de entrada`],
        ["Escala A", `${formatValue(t.ammeterResistance, "Ω")} em série`],
        ["OL", "fora da escala"],
      ]
    case "logic":
      return [
        ["Alimentação mínima", formatValue(t.minSupply, "V")],
        ["Entrada 0 até", formatValue(t.vil, "V")],
        ["Entrada 1 a partir de", formatValue(t.vih, "V")],
      ]
    case "logicSwitch":
      return [["Comportamento", "Entrega 1 ou 0 lógico no pino OUT"]]
    case "logicProbe":
      return [["Comportamento", "Mostra 1, 0 ou ? no ponto lido"]]
    case "switch":
      return [["Comportamento", "Ligada fecha o caminho, desligada abre"]]
    case "pushButton":
      return [["Comportamento", "Fecha o caminho só enquanto apertado"]]
    default:
      return []
  }
}


type Pt = [number, number]
type SketchDef = { view: string; side?: string; pins: Pt[]; anchors?: ("start" | "middle" | "end")[] }

function dipSketch(count: number): SketchDef {
  const half = count / 2
  const gap = 150 / half
  const pins: Pt[] = []
  const legs: string[] = []
  for (let i = 0; i < count; i++) {
    const left = i < half
    const row = left ? i : count - 1 - i
    const y = 30 + gap * row + gap / 2
    pins.push([left ? 78 : 182, y])
    legs.push(`<path d="M${left ? 90 : 170} ${y}H${left ? 78 : 182}"/>`)
  }
  return {
    view: `<rect x="90" y="24" width="80" height="162" rx="3"/><path d="M120 24a10 10 0 0020 0"/><circle cx="102" cy="40" r="2.4"/>${legs.join("")}`,
    side: `<rect x="94" y="204" width="72" height="12" rx="2"/><path d="M106 216v8M154 216v8M106 204v-8M154 204v-8"/>`,
    pins,
    anchors: pins.map(([x]) => (x < 130 ? "end" : "start")),
  }
}

const SKETCHES: Record<string, SketchDef> = {
  resistor: {
    view: '<path d="M30 105H78M182 105H230"/><rect x="78" y="86" width="104" height="38" rx="14"/><path d="M104 86v38M120 86v38M136 86v38M164 86v38" class="sketch-ink-soft"/>',
    side: '<circle cx="46" cy="40" r="15"/><circle cx="46" cy="40" r="5"/>',
    pins: [[30, 105], [230, 105]],
  },
  led: {
    view: '<path d="M96 160v-32M164 160v-32"/><rect x="82" y="118" width="100" height="10" rx="2"/><path d="M90 118V70a42 42 0 0184 0v48z"/><path d="M104 70a28 28 0 0128-26" class="sketch-ink-soft"/>',
    side: '<path d="M200 96V70a18 18 0 0136 0v26z"/><path d="M200 96h36M208 96v14M228 96v14"/>',
    pins: [[96, 160], [164, 160]],
  },
  diode: {
    view: '<path d="M30 105H78M182 105H230"/><rect x="78" y="88" width="104" height="34" rx="6"/><rect x="158" y="88" width="14" height="34" class="sketch-fill"/>',
    side: '<circle cx="46" cy="40" r="14"/><path d="M34 46h24" class="sketch-ink-soft"/>',
    pins: [[30, 105], [230, 105]],
  },
  lamp: {
    view: '<circle cx="130" cy="72" r="34"/><path d="M114 100h32v16h-32z"/><path d="M118 116v14M142 116v14M120 96l5-18 5 14 5-14 5 18" class="sketch-ink-soft"/>',
    pins: [[118, 130], [142, 130]],
  },
  battery: {
    view: '<rect x="82" y="52" width="96" height="112" rx="8"/><path d="M82 92h96"/><rect x="104" y="36" width="14" height="16"/><circle cx="154" cy="44" r="8"/>',
    pins: [[111, 36], [154, 36]],
  },
  switch: {
    view: '<rect x="70" y="100" width="120" height="30" rx="6"/><path d="M130 100l16-44"/><circle cx="148" cy="52" r="6"/><path d="M92 130v14M168 130v14"/>',
    pins: [[92, 144], [168, 144]],
  },
  push_button: {
    view: '<rect x="86" y="70" width="88" height="70" rx="8"/><circle cx="130" cy="105" r="22"/><path d="M86 82H70M86 128H70M174 82h16M174 128h16"/>',
    pins: [[70, 82], [70, 128], [190, 82], [190, 128]],
    anchors: ["end", "end", "start", "start"],
  },
  dc_motor: {
    view: '<rect x="64" y="70" width="110" height="64" rx="28"/><path d="M174 102h34"/><rect x="64" y="84" width="22" height="36"/><path d="M80 134v14M104 134v14"/>',
    pins: [[80, 148], [104, 148]],
  },
  buzzer: {
    view: '<circle cx="130" cy="95" r="46"/><circle cx="130" cy="95" r="9"/><path d="M110 141v14M150 141v14"/>',
    pins: [[110, 155], [150, 155]],
  },
  logic_switch: {
    view: '<rect x="80" y="64" width="100" height="70" rx="6"/><path d="M130 64l12-30"/><path d="M104 134v14M130 134v14M156 134v14"/>',
    pins: [[104, 148], [156, 148], [130, 148]],
  },
  logic_probe: {
    view: '<path d="M70 100h60l30-12v24l-30-12"/><rect x="130" y="82" width="64" height="36" rx="6"/><path d="M162 118v28"/>',
    pins: [[70, 100], [162, 146]],
    anchors: ["end", "middle"],
  },
  multimeter: {
    view: '<rect x="76" y="30" width="108" height="130" rx="10"/><rect x="90" y="44" width="80" height="34" rx="3"/><circle cx="130" cy="112" r="18"/><path d="M96 160v14M164 160v14"/>',
    pins: [[96, 174], [164, 174]],
  },
}

export function partSketch(type: string, catalog: PartsCatalog): string {
  const def = catalog[type]
  const pins = def?.pins ?? []
  const shape = type.startsWith("chip_") ? dipSketch(pins.length) : SKETCHES[type] ?? { view: '<rect x="80" y="60" width="100" height="60" rx="6"/>', pins: pins.map((_, i): Pt => [60 + i * 30, 140]) }
  const labels = pins
    .map((name, i) => {
      const [x, y] = shape.pins[i] ?? [130, 150]
      const anchor = shape.anchors?.[i] ?? "middle"
      const dy = anchor === "middle" ? 14 : 4
      const dx = anchor === "end" ? -6 : anchor === "start" ? 6 : 0
      const text = type.startsWith("chip_") ? `${i + 1} ${name}` : name
      return `<text class="sketch-pin" x="${x + dx}" y="${y + dy}" text-anchor="${anchor}">${text}</text>`
    })
    .join("")
  return `<svg class="part-sketch" viewBox="0 0 260 ${type.startsWith("chip_") ? 236 : 190}" role="img" aria-label="Desenho de ${def?.datasheet ?? type}"><g class="sketch-view">${shape.view}</g>${shape.side ? `<g class="sketch-side">${shape.side}</g>` : ""}<g class="sketch-pins">${labels}</g></svg>`
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
    button.dataset.tool = id
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

const PART_ART: Record<string, string> = {
  battery:
    '<rect x="9" y="7" width="28" height="18" rx="3.5" fill="#2B2118"/><path d="M9 10.5a3.5 3.5 0 013.5-3.5H19v18h-6.5A3.5 3.5 0 019 21.5z" fill="#F97316"/><rect x="37" y="12.5" width="3" height="7" rx="1" fill="#A8A29E"/><path d="M26 13v6M23 16h6" stroke="#FBF7F0" stroke-width="1.6" stroke-linecap="round"/>',
  lamp: '<rect x="19.5" y="21" width="9" height="8" rx="1.5" fill="#A8A29E"/><path d="M19.5 24h9M19.5 26.5h9" stroke="#78716C" stroke-width="0.8"/><circle cx="24" cy="12.5" r="9" fill="#FFE7A0" stroke="#E0A800" stroke-width="1.4"/><path d="M20.5 13.5l1.8-3 1.7 3 1.7-3 1.8 3" fill="none" stroke="#C2410C" stroke-width="1.2" stroke-linejoin="round"/>',
  switch:
    '<rect x="9" y="15" width="30" height="11" rx="3" fill="#374151"/><rect x="21.5" y="4" width="5" height="14" rx="2.5" fill="#E7E5E4" stroke="#78716C" transform="rotate(22 24 17)"/><circle cx="14" cy="20.5" r="1.6" fill="#A8A29E"/><circle cx="34" cy="20.5" r="1.6" fill="#A8A29E"/>',
  push_button: '<rect x="11" y="15" width="26" height="11" rx="2.5" fill="#1F2937"/><circle cx="24" cy="13.5" r="7.5" fill="#22C55E" stroke="#15803D" stroke-width="1.4"/><circle cx="21.5" cy="11" r="2" fill="#86EFAC"/>',
  dc_motor:
    '<rect x="8" y="9" width="23" height="15" rx="7" fill="#A8A29E" stroke="#78716C" stroke-width="1.2"/><rect x="12" y="9" width="3" height="15" fill="#78716C" opacity=".5"/><rect x="31" y="14.5" width="5" height="4" fill="#78716C"/><ellipse cx="39" cy="16.5" rx="2.4" ry="10" fill="#3B82F6"/>',
  diode:
    '<path d="M21 26v5M27 26v5" stroke="#A8A29E" stroke-width="1.6" stroke-linecap="round"/><rect x="14" y="14" width="20" height="11" rx="3" fill="#1F2937"/><rect x="28" y="14" width="3.5" height="11" fill="#D6D3D1"/>',
  buzzer:
    '<circle cx="21" cy="16" r="10" fill="#1F2937"/><circle cx="21" cy="16" r="2.6" fill="#4B5563"/><path d="M34 10.5a8 8 0 010 11M38 7.5a12.5 12.5 0 010 17" fill="none" stroke="#EC4899" stroke-width="1.8" stroke-linecap="round"/>',
  resistor:
    '<path d="M3 16h42" stroke="#A8A29E" stroke-width="2" stroke-linecap="round"/><rect x="12" y="10" width="24" height="12" rx="5" fill="#E8D3A9" stroke="#C4A574"/><rect x="16" y="10" width="2.6" height="12" fill="#7C4A1E"/><rect x="21" y="10" width="2.6" height="12" fill="#1F2937"/><rect x="26" y="10" width="2.6" height="12" fill="#DC2626"/><rect x="31" y="10" width="2" height="12" fill="#C9A227"/>',
  led: '<path d="M21 26v5M27 26v5" stroke="#A8A29E" stroke-width="1.6" stroke-linecap="round"/><rect x="16" y="23" width="16" height="3.5" rx="1" fill="#DC2626"/><path d="M18 23V12a6 6 0 0112 0v11z" fill="#EF4444" stroke="#B91C1C" stroke-width="1.2"/><path d="M21 12a3 3 0 013-3" stroke="#FECACA" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  chip: '<path d="M15 7V3M20 7V3M25 7V3M30 7V3M15 25v4M20 25v4M25 25v4M30 25v4" stroke="#D6D3D1" stroke-width="2" stroke-linecap="round"/><rect x="10" y="7" width="26" height="18" rx="2" fill="#1F2937"/><circle cx="14" cy="16" r="1.6" fill="#4B5563"/>',
  logic_switch:
    '<rect x="8" y="10" width="32" height="14" rx="7" fill="#E7E5E4" stroke="#78716C" stroke-width="1.2"/><circle cx="31" cy="17" r="5" fill="#22C55E" stroke="#15803D" stroke-width="1.2"/><path d="M14 14.5v5" stroke="#78716C" stroke-width="1.6" stroke-linecap="round"/>',
  logic_probe: '<path d="M7 26l4-1 21-15-3-4-21 15z" fill="#8B5CF6" stroke="#6D28D9" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 26l-3 3" stroke="#A8A29E" stroke-width="1.6" stroke-linecap="round"/><circle cx="35" cy="8" r="3.6" fill="#FFC21A" stroke="#B45309" stroke-width="1"/>',
  multimeter:
    '<rect x="14" y="2.5" width="20" height="27" rx="3.5" fill="#FFC21A" stroke="#B45309" stroke-width="1.2"/><rect x="17.5" y="6" width="13" height="7" rx="1" fill="#DCFCE7"/><circle cx="24" cy="21" r="4.5" fill="#1F2937"/><path d="M24 21l2-2.4" stroke="#FFC21A" stroke-width="1.4" stroke-linecap="round"/>',
}

function partArt(type: string, width = 48): string {
  const body = PART_ART[type.startsWith("chip_") ? "chip" : type] ?? '<rect x="12" y="6" width="24" height="20" rx="4" fill="#E9DFCE" stroke="#B87333"/>'
  return `<svg viewBox="0 0 48 32" width="${width}" height="${(width * 2) / 3}" aria-hidden="true">${body}</svg>`
}

export function createTray(el: HTMLElement, onPick: (type: string) => void, onInfo?: (type: string) => void) {
  el.classList.add("tray")
  el.setAttribute("aria-label", "Bandeja de peças")
  let lastKey = ""
  return {
    update(items: TrayItem[], active: string | null, emptyText = "Nenhuma peça extra nesta fase.") {
      el.replaceChildren()
      if (items.length === 0) {
        lastKey = ""
        const empty = document.createElement("p")
        empty.className = "tray-empty"
        empty.textContent = emptyText
        el.appendChild(empty)
        return
      }
      const slots: HTMLElement[] = []
      for (const item of items) {
        const wrap = document.createElement("div")
        wrap.className = "tray-slot"
        const button = document.createElement("button")
        button.type = "button"
        button.className = "tray-item"
        button.disabled = item.count <= 0
        button.classList.toggle("active", item.type === active)
        button.setAttribute("aria-label", `${item.label}, ${item.count === Infinity ? "sem limite" : item.count + " disponível"}`)
        button.title = item.label
        button.classList.toggle("pending", item.type.startsWith("pending:"))
        button.innerHTML = `<span class="tray-art">${partArt(item.icon ?? item.type)}</span><span class="tray-name">${item.label}</span><span class="tray-count" aria-hidden="true">${trayCount(item.count)}</span>`
        button.addEventListener("click", () => onPick(item.type))
        wrap.appendChild(button)
        const infoType = item.icon ?? item.type
        if (onInfo && !infoType.startsWith("pending:")) {
          const info = document.createElement("button")
          info.type = "button"
          info.className = "tray-info"
          info.setAttribute("aria-label", `Como usar: ${item.label}`)
          info.title = "Como usar"
          info.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8M12 16.8v.01"/></svg>'
          info.addEventListener("click", () => onInfo(infoType))
          wrap.appendChild(info)
        }
        el.appendChild(wrap)
        slots.push(wrap)
      }
      // a bandeja redesenha a cada mudança; só anima quando o conjunto de peças muda
      const key = items.filter((i) => !i.type.startsWith("pending:")).map((i) => i.type).join("|")
      if (key !== lastKey) void stagger(slots, (slot, delay) => fadeSlide(slot, { y: 10, duration: 760, delay }))
      lastKey = key
    },
  }
}

export function createWirePalette(el: HTMLElement, colors: { value: string; name: string }[], onPick: (color: string) => void, onStyle?: () => void) {
  el.classList.add("wire-palette")
  el.setAttribute("role", "group")
  el.setAttribute("aria-label", "Cor do fio")
  const title = document.createElement("span")
  title.className = "palette-title"
  title.textContent = "Cor do fio"
  el.appendChild(title)
  if (onStyle) {
    const style = document.createElement("button")
    style.type = "button"
    style.className = "btn-secondary palette-style"
    style.textContent = "Arco / reto"
    style.title = "Troca o fio entre arco e ângulo reto. Arrasta a bolinha do meio pra mudar o caminho."
    style.addEventListener("click", onStyle)
    el.appendChild(style)
  }
  function fill(list: { value: string; name: string }[]) {
    for (const old of el.querySelectorAll(".swatch")) old.remove()
    for (const { value: color, name } of list) {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "swatch"
      button.style.background = color
      button.title = name
      button.setAttribute("aria-label", name)
      button.addEventListener("click", () => onPick(color))
      el.appendChild(button)
    }
  }
  fill(colors)
  return {
    show(visible: boolean) {
      el.hidden = !visible
    },
    setColors: fill,
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

const OBSERVATION_MS = 9000

export function createObservationNote(el: HTMLElement) {
  el.className = "observation-note"
  el.setAttribute("role", "status")
  el.setAttribute("aria-live", "polite")
  el.hidden = true
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    el.hidden = true
    el.textContent = ""
  }
  return {
    show(text: string) {
      if (timer !== null) clearTimeout(timer)
      el.hidden = false
      el.textContent = text
      void softRise(el)
      timer = setTimeout(clear, OBSERVATION_MS)
    },
    clear,
  }
}

export function trayCount(count: number): string {
  return count === Infinity ? "∞" : String(count)
}

export function divergencesApply(phase: { id: string; showDivergence: boolean; stars: Star[] }, blueprintParts: number): boolean {
  if (phase.stars.some((s) => s.kind === "noDivergence")) return true
  if (!phase.showDivergence) return false
  return !(phase.id === "sandbox" && blueprintParts === 0)
}

export function shownDivergences(phase: { id: string; showDivergence: boolean; stars: Star[] }, blueprintParts: number, list: Divergence[]): Divergence[] {
  return divergencesApply(phase, blueprintParts) ? list : []
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
        button.innerHTML = `<span class="tray-icon">${partArt(item.type, 30)}</span><span>${item.id}</span><span class="pending-type">${item.label}</span>`
        button.setAttribute("aria-label", `Posicionar ${item.id}, ${item.label}`)
        button.addEventListener("click", () => onPick(item))
        el.appendChild(button)
      }
    },
  }
}

export const PHASE_TAGS: Record<string, string> = { tutorial: "tutorial", build: "montagem", repair: "conserto", order: "encomenda" }

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
  conducting: "conduzindo",
  blocking: "bloqueando",
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

export function conditionLabel(partId: string, value: ThenValue): string {
  if (value === "off") return `${partId} ${offWord(partId)}`
  if (typeof value === "string") return `${partId} ${STATE_WORDS[value] ?? value}`
  const parts: string[] = []
  if (value.current) parts.push(`corrente entre ${formatValue(value.current[0], "A")} e ${formatValue(value.current[1], "A")}`)
  if (value.voltage) parts.push(`tensão entre ${formatValue(value.voltage[0], "V")} e ${formatValue(value.voltage[1], "V")}`)
  return `${partId} com ${parts.join(" e ")}`
}

export function scenarioLabel(scenario: ScenarioLike): { when: string; then: string } {
  const when = Object.entries(scenario.when).map(([id, v]) => (v === "removed" ? `sem ${id}` : `${id} ${INPUT_WORDS[v] ?? v}`))
  const then = Object.entries(scenario.then).map(([id, v]) => conditionLabel(id, v))
  return { when: when.join(", "), then: then.join(", ") }
}

export const CHECK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>'
export const CROSS_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'

let phaseLabelMap: Record<string, string> = {}

export function setPhaseLabels(map: Record<string, string>): void {
  phaseLabelMap = map
}

export function phaseLabel(id: string): string {
  // conserto do dia aparece pela data, "daily-2026-11-03" vira "03/11"
  if (id.startsWith("daily-")) return id.slice(6).split("-").reverse().slice(0, 2).join("/")
  return phaseLabelMap[id] ?? id
}

export const MENTOR = "Dona Neide, dona da oficina"

export function orderFrom(type: string, order: { client?: string } | null): string {
  if (type === "tutorial") return MENTOR
  return order?.client ?? "Cliente de balcão"
}

export type WorkOrderView = { label: string; from: string; object: string; concept: string | null }

export function createWorkOrderCard(el: HTMLElement, onClose: () => void) {
  el.className = "work-order"
  el.hidden = true
  el.setAttribute("role", "dialog")
  el.setAttribute("aria-labelledby", "work-order-title")
  el.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-action=close]")) onClose()
  })
  return {
    isOpen: () => !el.hidden,
    show(view: WorkOrderView) {
      el.hidden = false
      el.innerHTML = `
        <p class="work-order-tag">Ordem de serviço <span class="mono">${view.label}</span></p>
        <h2 id="work-order-title" class="work-order-object">${view.object}</h2>
        <p class="work-order-from">${view.from}</p>
        ${view.concept ? `<p class="work-order-concept">${view.concept}</p>` : ""}
        <button type="button" class="btn-primary" data-action="close">Bora pra bancada</button>`
      void fadeSlide(el, { y: 16, duration: 300 })
      el.querySelector<HTMLButtonElement>("[data-action=close]")?.focus()
    },
    hide() {
      el.hidden = true
    },
  }
}

export type BriefPhase = { id: string; type: string; goal: string; brief: string; budget: number | null; expect: ScenarioLike[]; steps: { text: string }[] | null; hints: string[]; order?: WorkOrder | null; lesson?: Lesson | null }
const METER_UNITS: Record<"V" | "A" | "ohm", string> = { V: "V", A: "A", ohm: "Ω" }

export function starLabel(star: Star): string {
  switch (star.kind) {
    case "solved":
      return "Resolver"
    case "noDivergence":
      return "Esquema igual à montagem"
    case "usedMeter":
      return `Medir com o multímetro (${METER_UNITS[star.mode]})`
    case "maxCost":
      return `Custo até ${star.value} créditos`
    case "maxWires":
      return `Até ${star.value} fios`
  }
}

export type Goal = { label: string; state: GoalState }

const GOAL_WORDS: Record<GoalState, string> = { met: "conquistada", unmet: "ainda não", neutral: "conta quando o circuito funcionar" }

function goalPops(prev: GoalState[], next: Goal[]): number[] {
  return next.flatMap((g, i) => (g.state === "met" && prev[i] !== undefined && prev[i] !== "met" ? [i] : []))
}

export type BriefState = {
  goals: Goal[]
  rows: { ok: boolean; isCurrent: boolean }[]
  cost: number
  budgetOk: boolean
  previewIndex: number | null
  stepIndex: number | null
  hintsOpened: number
  won: boolean
}

export function createPhaseBrief(el: HTMLElement, handlers: { onPreview(index: number | null): void; onHint(): void; onPhases(): void; onRestart(): void; onDatasheets?(): void; onOrder?(): void }) {
  el.className = "phase-brief"
  el.setAttribute("aria-label", "Objetivo da fase")
  el.hidden = true
  let confirmingRestart = false
  let lastPhase: string | null = null
  let lastGoals: GoalState[] = []
  el.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    const row = target.closest<HTMLElement>("[data-row]")
    if (row) handlers.onPreview(Number(row.dataset.row))
    if (target.closest("[data-action=hint]")) handlers.onHint()
    if (target.closest("[data-action=phases]")) handlers.onPhases()
    if (target.closest("[data-action=order]")) handlers.onOrder?.()
    if (target.closest("[data-action=datasheets]")) handlers.onDatasheets?.()
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
    reset() {
      lastPhase = null
      lastGoals = []
    },
    nudgeHint() {
      const button = el.querySelector(".brief-hint")
      if (button) void nudge(button)
    },
    render(phase: BriefPhase, state: BriefState) {
      el.hidden = false
      const fresh = lastPhase !== phase.id
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
      const goals = state.goals
        .map(
          (g, i) =>
            `<li class="goal goal-${g.state}" data-goal="${i}" aria-label="${g.label}: ${GOAL_WORDS[g.state]}"${g.state === "neutral" ? ' title="Essa estrela conta depois que todos os cenários passarem uma vez."' : ""}>${starIcon(g.state, 20)}<span>${g.label}</span></li>`,
        )
        .join("")
      el.innerHTML = `
        <header class="brief-head">
          <span class="brief-tag">${PHASE_TAGS[phase.type] ?? phase.type}</span>
          <span class="brief-id mono">${phaseLabel(phase.id)}</span>
          <button type="button" class="brief-link" data-action="restart" title="Volta a fase pro começo">${confirmingRestart ? "Confirmar recomeço" : "Recomeçar"}</button>
          ${phase.id === "sandbox" && handlers.onDatasheets ? '<button type="button" class="brief-link" data-action="datasheets">Datasheets</button>' : ""}
          ${handlers.onOrder && (phase.order || phase.lesson) ? '<button type="button" class="brief-link" data-action="order">Ordem</button>' : ""}
          <button type="button" class="brief-link" data-action="phases">Fases</button>
        </header>
        ${phase.order ? `<p class="brief-order">${orderFrom(phase.type, phase.order)} · ${phase.order.object}</p>` : ""}
        <h2 class="brief-title">${phase.goal.charAt(0).toUpperCase()}${phase.goal.slice(1)}</h2>
        <p class="brief-text">${phase.brief}</p>
        ${step ? `<p class="brief-step"><span class="mono">${(state.stepIndex ?? 0) + 1}/${phase.steps!.length}</span>${step.text}</p>` : ""}
        ${rows ? `<ul class="checklist">${rows}</ul>` : ""}
        ${budget}
        ${goals ? `<section class="brief-goals" aria-label="Estrelas da fase"><h3>Estrelas</h3><ul>${goals}</ul></section>` : ""}
        ${hints ? `<ol class="hint-list">${hints}</ol>` : ""}
        ${phase.hints.length > 0 ? `<button type="button" class="brief-hint" data-action="hint" ${moreHints ? "" : "disabled"}>${moreHints ? (state.hintsOpened === 0 ? "Ver uma dica" : "Ver mais uma dica") : "Sem mais dicas"}</button>` : ""}`
      if (fresh) for (const part of el.querySelectorAll(".brief-title, .brief-text")) void softRise(part)
      else for (const i of goalPops(lastGoals, state.goals)) {
        const star = el.querySelector(`[data-goal="${i}"] .star-icon`)
        if (star) void pop(star)
      }
      lastPhase = phase.id
      lastGoals = state.goals.map((g) => g.state)
    },
  }
}

export const LOCK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="6" y="11" width="12" height="9" rx="1.5"/><path d="M9 11V8a3 3 0 016 0v3"/></svg>'

export type BadgeData = { level: number; xp: number; floor: number; next: number | null; progress: number; stars: { earned: number; max: number } }

const STAR_PATH = "M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1L3.2 9.3l6.1-.9z"

export function starIcon(state: "met" | "unmet" | "neutral", size = 18): string {
  const fill = state === "met" ? "var(--color-star)" : "none"
  const stroke = state === "neutral" ? "var(--color-text-muted)" : "var(--color-text)"
  const dash = state === "neutral" ? ' stroke-dasharray="2.5 2"' : ""
  return `<svg class="star-icon star-${state}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${STAR_PATH}" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"${dash}/></svg>`
}

export function createPlayerBadge(el: HTMLElement) {
  el.classList.add("player-badge")
  el.innerHTML = `
    <div class="badge-level" aria-hidden="true"><span class="badge-level-number"></span></div>
    <div class="badge-body">
      <div class="badge-row"><span class="badge-title"></span><span class="badge-stars"></span></div>
      <div class="xp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="xp-fill"></div></div>
      <span class="badge-xp"></span>
    </div>`
  const number = el.querySelector<HTMLElement>(".badge-level-number")!
  const title = el.querySelector<HTMLElement>(".badge-title")!
  const stars = el.querySelector<HTMLElement>(".badge-stars")!
  const track = el.querySelector<HTMLElement>(".xp-track")!
  const fill = el.querySelector<HTMLElement>(".xp-fill")!
  const xp = el.querySelector<HTMLElement>(".badge-xp")!
  return {
    async render(data: BadgeData, from?: BadgeData) {
      number.textContent = String(data.level)
      title.textContent = `Nível ${data.level}`
      stars.innerHTML = `${starIcon("met", 16)}<span>${data.stars.earned}/${data.stars.max}</span>`
      const pct = Math.round(data.progress * 100)
      track.setAttribute("aria-valuenow", String(pct))
      track.setAttribute("aria-label", data.next === null ? "Nível máximo" : `${data.xp - data.floor} de ${data.next - data.floor} XP até o próximo nível`)
      const xpText = (value: number) => (data.next === null ? `${Math.round(value)} XP · nível máximo` : `${Math.round(value)} / ${data.next} XP`)
      fill.style.width = `${pct}%`
      xp.textContent = xpText(data.xp)
      if (from) {
        const fromPct = from.level === data.level ? Math.round(from.progress * 100) : 0
        await Promise.all([springTo(fill, "width", `${fromPct}%`, `${pct}%`), countUp(xp, from.xp, data.xp, 1200, xpText)])
      }
    },
  }
}

export function createTopBar(el: HTMLElement, onMap: () => void) {
  el.classList.add("topbar")
  el.hidden = true
  el.innerHTML = `
    <div class="topbar-level">
      <span class="topbar-badge" aria-hidden="true"></span>
      <div class="topbar-xp">
        <div class="topbar-row"><span class="topbar-title"></span><span class="topbar-xp-text"></span></div>
        <div class="xp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="xp-fill"></div></div>
      </div>
    </div>
    <ul class="topbar-stars" aria-label="Estrelas da fase"></ul>
    <button type="button" class="btn-secondary topbar-map">Mapa</button>`
  const badge = el.querySelector<HTMLElement>(".topbar-badge")!
  const title = el.querySelector<HTMLElement>(".topbar-title")!
  const xpText = el.querySelector<HTMLElement>(".topbar-xp-text")!
  const track = el.querySelector<HTMLElement>(".xp-track")!
  const fill = el.querySelector<HTMLElement>(".xp-fill")!
  const stars = el.querySelector<HTMLElement>(".topbar-stars")!
  el.querySelector(".topbar-map")!.addEventListener("click", onMap)
  let lastGoals: GoalState[] = []
  let lastKey = ""
  return {
    hide() {
      el.hidden = true
      lastGoals = []
      lastKey = ""
    },
    render(info: LevelInfo, goals: Goal[]) {
      el.hidden = false
      badge.textContent = String(info.level)
      title.textContent = `Nível ${info.level}`
      xpText.textContent = info.next === null ? `${info.xp} XP` : `${info.xp} / ${info.next} XP`
      const pct = Math.round(info.progress * 100)
      fill.style.width = `${pct}%`
      track.setAttribute("aria-valuenow", String(pct))
      track.setAttribute("aria-label", info.next === null ? "Nível máximo" : `${info.xp - info.floor} de ${info.next - info.floor} XP até o próximo nível`)
      const key = goals.map((g) => `${g.label}:${g.state}`).join("|")
      if (key === lastKey) return
      lastKey = key
      stars.hidden = goals.length === 0
      stars.innerHTML = goals.map((g) => `<li title="${g.label}" aria-label="${g.label}: ${GOAL_WORDS[g.state]}">${starIcon(g.state, 26)}</li>`).join("")
      for (const i of goalPops(lastGoals, goals)) {
        const star = stars.children[i]?.querySelector(".star-icon")
        if (star) void pop(star)
      }
      lastGoals = goals.map((g) => g.state)
    },
  }
}

export type DailyCard = { unlocked: boolean; done: boolean; available: boolean; streak: number }

export type TitleActions = {
  canContinue: boolean
  sandboxAvailable: boolean
  workshopAvailable: boolean
  badge: BadgeData
  daily: DailyCard
  onContinue(): void
  onNew(): void
  onSandbox(): void
  onSettings(): void
  onWorkshop(): void
  onDaily(): void
}

const FLAME_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c1 3.2 4.5 4.8 4.5 9.3A4.5 4.5 0 0112 17a4.5 4.5 0 01-4.5-4.7c0-2 1-3.3 2-4.3.2 1.6 1 2.5 2 2.5 0-2.6-.4-5 .5-7.5z"/><path d="M12 21a6.5 6.5 0 006.5-6.5"/></svg>'
export const LOCK_SMALL =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="6" y="11" width="12" height="9" rx="1.5"/><path d="M9 11V8a3 3 0 016 0v3"/></svg>'
const WRENCH_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 00-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 005.2-5.4l-2.4 2.4-2.6-.6-.6-2.6z"/></svg>'

function dailyCardHtml(daily: DailyCard): string {
  if (!daily.unlocked)
    return `<div class="daily-card locked">${WRENCH_ICON}<div><strong>Conserto do dia</strong><span>${LOCK_SMALL} Libera ao concluir Resistência</span></div></div>`
  const streak = daily.streak > 0 ? `<span class="daily-streak" aria-label="Sequência de ${daily.streak} ${daily.streak === 1 ? "dia" : "dias"}">${FLAME_ICON}${daily.streak}</span>` : ""
  if (!daily.done && !daily.available)
    return `<div class="daily-card done">${WRENCH_ICON}<div><strong>Conserto do dia</strong><span>Sem conserto hoje · volta amanhã</span></div>${streak}</div>`
  if (daily.done)
    return `<div class="daily-card done">${WRENCH_ICON}<div><strong>Conserto do dia</strong><span>${CHECK_ICON} Feito hoje · volta amanhã</span></div>${streak}</div>`
  return `<button type="button" class="daily-card available" data-action="daily">${WRENCH_ICON}<div><strong>Conserto do dia</strong><span>Um circuito quebrado te esperando</span></div><span class="daily-side">${streak}<span class="daily-play">Jogar</span></span></button>`
}

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
    if (action === "workshop") actions.onWorkshop()
    if (action === "daily") actions.onDaily()
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
    const a = actions
    el.innerHTML = `
      <div class="title-panel">
        <h1 class="title-name">Fio Contínuo</h1>
        <p class="title-tagline">Desenha, monta, mede e conserta. A corrente dá a volta inteira.</p>
        <div class="title-badge"></div>
        ${dailyCardHtml(a.daily)}
        <div class="title-actions">
          ${a.canContinue ? '<button type="button" class="btn-primary" data-action="continue">Continuar</button>' : ""}
          ${
            confirming
              ? '<p class="title-confirm">Começar de novo apaga o progresso salvo neste navegador.</p><button type="button" class="btn-danger" data-action="new">Apagar e começar</button><button type="button" class="btn-secondary" data-action="cancel">Manter progresso</button>'
              : `<button type="button" class="${a.canContinue ? "btn-secondary" : "btn-primary"}" data-action="new">Nova partida</button>`
          }
          <div class="title-row">
            <button type="button" class="btn-secondary" data-action="workshop" ${a.workshopAvailable ? "" : 'disabled title="Em breve"'}>Oficina</button>
            ${a.sandboxAvailable ? '<button type="button" class="btn-secondary" data-action="sandbox">Sandbox</button>' : ""}
            <button type="button" class="btn-secondary" data-action="settings">Configurações</button>
          </div>
        </div>
      </div>`
    const badge = createPlayerBadge(el.querySelector<HTMLElement>(".title-badge")!)
    void badge.render(a.badge)
    const daily = el.querySelector<HTMLElement>(".daily-card.available")
    if (daily) glowPulse(daily)
    const blocks = [...el.querySelectorAll<HTMLElement>(".title-panel > *")]
    void stagger(blocks, (block, delay) => fadeSlide(block, { delay, duration: 600 }), 60)
    el.querySelector<HTMLButtonElement>(".title-actions button")?.focus({ preventScroll: true })
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

export type SettingsView = { standard: "IEC" | "ANSI"; reducedMotion: boolean; sfxVolume: number; systemReducedMotion: boolean; storageAvailable: boolean }
export type SettingsHandlers = { onStandard(s: "IEC" | "ANSI"): void; onReducedMotion(on: boolean): void; onVolume(v: number, done: boolean): void; onReset(): void; onExport(): void; onBack(): void; onTour(): void }

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
    if (action === "tour") handlers.onTour()
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
    if (input.name === "volume") handlers.onVolume(Number(input.value), true)
  })
  el.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement
    if (input.name === "volume") handlers.onVolume(Number(input.value), false)
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
          <div><h3>Volume</h3><p>Efeitos de clique, encaixe, estrelas e nível. No zero, fica tudo em silêncio.</p></div>
          <input type="range" name="volume" min="0" max="1" step="0.1" value="${state.sfxVolume}" aria-label="Volume dos efeitos"/>
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
          <div><h3>Tour da interface</h3><p>Mostra de novo onde fica cada parte da tela, área por área.</p></div>
          <button type="button" class="btn-secondary" data-action="tour">Rever tour</button>
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
      void run(toast, sampleSpring(1, 260, 24).map((v) => ({ transform: `translateY(${(1 - v) * 18}px)`, opacity: Math.min(1, v * 1.6) })), { duration: 600, easing: "linear" })
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
    show(text: string | null, prefix = "Pré-visualizando: ") {
      el.hidden = text === null
      el.innerHTML = text === null ? "" : `<span>${prefix}${text}</span><span class="preview-exit">Esc ou clique pra voltar</span>`
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

export function meterDisplayText(mode: MeterMode, reading: MeterView | null, probesPlaced: boolean): string {
  if (mode === "off") return ""
  if (!probesPlaced || !reading) return "— —"
  if (reading.display === "OL") return "OL"
  if (reading.display === "----") return "----"
  return formatValue(reading.value ?? 0, MODE_LABELS[mode].unit)
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
      valueEl.textContent = meterDisplayText(mode, reading, probesPlaced)
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

export type Datasheet = {
  title: string
  category: string
  description: string
  features: string[]
  application: { blueprint: { placements: BlueprintPlacement[]; segments: BlueprintSegment[] }; instances: Instance[]; text: string }
  breadboard: string
  mistake: string
}

export function createDatasheetCard(el: HTMLElement, onClose: (key: string, viaFull: boolean) => void, onFull?: (key: string) => void) {
  el.className = "datasheet-card"
  el.hidden = true
  el.setAttribute("role", "dialog")
  el.setAttribute("aria-modal", "false")
  let current: string | null = null
  const close = (viaFull = false) => {
    if (!current) return
    const key = current
    current = null
    el.hidden = true
    onClose(key, viaFull)
  }
  el.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    if (target.closest("[data-action=full]") && current) {
      const key = current
      close(true)
      onFull?.(key)
      return
    }
    if (target.closest("[data-action=close]")) close()
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
    open(key: string, sheet: Datasheet, symbolSvg: string, isNew: boolean, rows: [string, string][]) {
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
          <p class="sheet-does">${sheet.description}</p>
          <dl class="sheet-values">${rows.slice(0, 4).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
          <h3>Na protoboard</h3>
          <p>${sheet.breadboard}</p>
          <h3>Erro comum</h3>
          <p>${sheet.mistake}</p>
        </div>
        <div class="sheet-actions">
          ${onFull ? '<button type="button" class="btn-secondary" data-action="full">Ver datasheet completo</button>' : ""}
          <button type="button" class="sheet-ok" data-action="close">Entendi</button>
        </div>`
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
  if (reducedMotionFlag || skipRequested || typeof (el as HTMLElement).animate !== "function") return Promise.resolve()
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
  if (reducedMotionFlag || skipRequested || typeof requestAnimationFrame !== "function") {
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

export function skipRequestedNow(): boolean {
  return skipRequested
}

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
  if (reducedMotionFlag || skipRequested) return Promise.resolve()
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

export type Box = { x: number; y: number; w: number; h: number; r: number }

export function spotlight(el: Element, from: Box, to: Box): Promise<void> {
  const frame = (b: Box): Keyframe => ({ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, borderRadius: `${b.r}px` })
  return run(el, [frame(from), frame(to)], { duration: 760, easing: EASING.easeOutQuart })
}

export function softRise(el: Element, delay = 0): Promise<void> {
  return run(el, [{ opacity: 0, transform: "translateY(7px)", filter: "blur(2.3px)" }, { opacity: 1, transform: "translateY(0)", filter: "blur(0)" }], {
    duration: 900,
    delay,
    easing: EASING.easeOutSine,
  })
}

export function glowPulse(el: HTMLElement): Animation | null {
  // loop infinito fica fora do registro de animações: finish() num loop infinito lança erro
  if (reducedMotionFlag || typeof el.animate !== "function") return null
  return el.animate(
    [{ boxShadow: "0 3px 0 var(--color-border), 0 0 0 0 rgba(184,115,51,0)" }, { boxShadow: "0 3px 0 var(--color-border), 0 0 0 6px rgba(184,115,51,0.28)" }, { boxShadow: "0 3px 0 var(--color-border), 0 0 0 0 rgba(184,115,51,0)" }],
    { duration: 1100, iterations: Infinity, easing: "cubic-bezier(.37,0,.63,1)" },
  )
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
