import type { PartsCatalog } from "./netlist"
import { evaluate, isPhaseAvailable, type Evaluation, type Phase, type PhaseData, type Star } from "./phases"
import type { CircuitDoc, Cosmetics, Daily, SaveData } from "./state"

export type RewardItem = { level: number; id: string; kind: "decor" | "board" | "wires" | "mat"; name: string; value?: string }
export type Rewards = { xpPerStar: number; dailyXp: number; levels: number[]; items: RewardItem[] }
export type MeterMode = "V" | "A" | "ohm"
export type StarContext = { won: boolean; evaluation: Evaluation; doc: CircuitDoc; side: "bench" | "blueprint"; meterModesUsed: MeterMode[] }
export type GoalState = "neutral" | "met" | "unmet"
export type LevelInfo = { level: number; xp: number; floor: number; next: number | null; progress: number }
export type RewardResult = { save: SaveData; xpGained: number; newStars: number[]; levelBefore: number; levelAfter: number; unlocked: RewardItem[] }

function circuitMet(star: Star, ctx: StarContext): boolean {
  switch (star.kind) {
    case "solved":
      return ctx.won
    case "noDivergence":
      return ctx.evaluation.divergences.length === 0
    case "maxCost":
      return ctx.evaluation.cost <= star.value
    case "maxWires":
      return ctx.doc.bench.wires.length <= star.value
    case "usedMeter":
      return ctx.meterModesUsed.includes(star.mode)
  }
}

export function evaluateStars(stars: Star[], ctx: StarContext): boolean[] {
  return stars.map((star) => ctx.won && circuitMet(star, ctx))
}

export function goalState(star: Star, ctx: StarContext, everAllPassed: boolean): GoalState {
  if (star.kind === "usedMeter" || star.kind === "solved") return circuitMet(star, ctx) ? "met" : "unmet"
  // meta de circuito só faz sentido depois que o circuito funcionou pelo menos uma vez
  if (!everAllPassed) return "neutral"
  return circuitMet(star, ctx) ? "met" : "unmet"
}

export function levelFor(xp: number, rewards: Rewards): LevelInfo {
  const levels = rewards.levels
  let index = 0
  for (let i = 0; i < levels.length; i++) if (xp >= levels[i]) index = i
  const floor = levels[index]
  const next = index + 1 < levels.length ? levels[index + 1] : null
  const progress = next === null ? 1 : (xp - floor) / (next - floor)
  return { level: index + 1, xp, floor, next, progress }
}

export function itemsUpTo(level: number, rewards: Rewards): RewardItem[] {
  return rewards.items.filter((item) => item.level <= level)
}

export function applyPhaseReward(save: SaveData, phaseId: string, earned: boolean[], cost: number, rewards: Rewards): RewardResult {
  const previous = save.progress[phaseId]
  const had = new Set(previous?.stars ?? [])
  const newStars = earned.flatMap((ok, i) => (ok && !had.has(i) ? [i] : []))
  const stars = [...new Set([...had, ...newStars])].sort((a, b) => a - b)
  const bestCost = previous?.bestCost === null || previous?.bestCost === undefined ? cost : Math.min(previous.bestCost, cost)
  const xpGained = newStars.length * rewards.xpPerStar
  const levelBefore = levelFor(save.xp, rewards).level
  const levelAfter = levelFor(save.xp + xpGained, rewards).level
  const unlocked = rewards.items.filter((item) => item.level > levelBefore && item.level <= levelAfter)
  return {
    save: { ...save, xp: save.xp + xpGained, progress: { ...save.progress, [phaseId]: { won: true, bestCost, stars } } },
    xpGained,
    newStars,
    levelBefore,
    levelAfter,
    unlocked,
  }
}

export function starsTotal(progress: SaveData["progress"], data: PhaseData): { earned: number; max: number } {
  const phases = data.groups.filter((g) => g.demo).flatMap((g) => g.phases)
  const earned = phases.reduce((sum, p) => sum + (progress[p.id]?.stars.length ?? 0), 0)
  return { earned, max: phases.reduce((sum, p) => sum + p.stars.length, 0) }
}

export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function dailyUnlocked(won: Set<string>, data: PhaseData): boolean {
  const g3 = data.groups.find((g) => g.id === "g3")
  return !!g3 && g3.phases.length > 0 && g3.phases.every((p) => won.has(p.id))
}

type Defect = (doc: CircuitDoc) => boolean

function usedHoles(doc: CircuitDoc): Set<string> {
  const used = new Set<string>()
  for (const p of doc.bench.placements) for (const h of Object.values(p.holes)) if (h) used.add(h)
  for (const w of doc.bench.wires) used.add(w.a).add(w.b)
  return used
}

function neighborHoles(hole: string): string[] {
  // trilho é um condutor só na linha toda, mover nele não quebra nada
  const m = /^([A-J])(\d+)$/.exec(hole)
  if (!m) return []
  const col = Number(m[2])
  return [col - 1, col + 1].filter((c) => c >= 1 && c <= 30).map((c) => `${m[1]}${c}`)
}

function defectsFor(doc: CircuitDoc, catalog: PartsCatalog): Defect[] {
  const defects: Defect[] = []
  const types = new Map(doc.instances.map((i) => [i.id, i.type]))
  for (const placement of doc.bench.placements) {
    const def = catalog[types.get(placement.id) ?? ""]
    if (!def || def.placement === "rigid") continue
    for (const [pin, hole] of Object.entries(placement.holes)) {
      if (!hole) continue
      for (const target of neighborHoles(hole)) {
        defects.push((d) => {
          const p = d.bench.placements.find((x) => x.id === placement.id)
          if (!p || usedHoles(d).has(target)) return false
          p.holes[pin] = target
          return true
        })
      }
    }
  }
  for (const wire of doc.bench.wires) {
    defects.push((d) => {
      d.bench.wires = d.bench.wires.filter((w) => w.id !== wire.id)
      return true
    })
  }
  const placed = new Set(doc.bench.placements.map((p) => p.id))
  for (const instance of doc.instances) {
    if (!placed.has(instance.id) || instance.type === "battery" || catalog[instance.type]?.isTool) continue
    defects.push((d) => {
      const target = d.instances.find((i) => i.id === instance.id)
      if (!target) return false
      target.fault = "open"
      return true
    })
    if (instance.type === "resistor") {
      for (const value of catalog.resistor?.values ?? []) {
        if (value === instance.actualValue) continue
        defects.push((d) => {
          const target = d.instances.find((i) => i.id === instance.id)
          if (!target) return false
          target.actualValue = value
          return true
        })
      }
    }
  }
  return defects
}

const DAILY_HINTS = [
  "Começa medindo a tensão da bateria e vai seguindo o caminho da corrente. Onde a tensão some de repente, o problema está perto.",
  "Confere perna por perna: uma coluna de diferença já tira a peça do circuito. E peça aberta não deixa passar corrente nenhuma, mesmo bem ligada.",
]

export function dailyRepair(date: string, data: PhaseData, won: Set<string>, catalog: PartsCatalog): Phase | null {
  const random = seededRandom(date)
  const bases = data.groups
    .flatMap((g) => g.phases)
    .filter((p) => (p.type === "build" || p.type === "order") && p.referenceSolution && (won.has(p.id) || isPhaseAvailable(data, won, p.id)))
  for (const base of shuffle(bases, random)) {
    const reference = base.referenceSolution!
    // se a referência nem vence, defeito nenhum prova nada
    if (!evaluate(base, reference, catalog).won) continue
    for (const defect of shuffle(defectsFor(reference, catalog), random)) {
      const broken = structuredClone(reference)
      if (!defect(broken) || evaluate(base, broken, catalog).won) continue
      const tray: Record<string, number> = {}
      for (const i of reference.instances) if (!catalog[i.type]?.isTool) tray[i.type] = 1
      const values = catalog.resistor?.values
      return {
        ...base,
        id: `daily-${date}`,
        type: "repair",
        goal: "Conserto do dia",
        brief: `A montagem "${base.goal}" parou de funcionar. Mede com o multímetro e acha o defeito.`,
        showDivergence: false,
        budget: null,
        initial: broken,
        steps: null,
        tray,
        trayValues: tray.resistor && values ? { resistor: values } : undefined,
        hints: DAILY_HINTS,
        stars: [{ kind: "solved" }, { kind: "usedMeter", mode: "V" }, { kind: "usedMeter", mode: "A" }],
        referenceSolution: reference,
      }
    }
  }
  return null
}

function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function updateStreak(daily: Daily, date: string): Daily {
  const streak = daily.lastWonDate === date ? daily.streak : daily.lastWonDate === previousDay(date) ? daily.streak + 1 : 1
  return { lastWonDate: date, streak, wonDates: daily.wonDates.includes(date) ? daily.wonDates : [...daily.wonDates, date] }
}

export function applyDailyReward(save: SaveData, date: string, rewards: Rewards): RewardResult {
  const xpGained = save.daily.wonDates.includes(date) ? 0 : rewards.dailyXp
  const levelBefore = levelFor(save.xp, rewards).level
  const levelAfter = levelFor(save.xp + xpGained, rewards).level
  return {
    save: { ...save, xp: save.xp + xpGained, daily: updateStreak(save.daily, date) },
    xpGained,
    newStars: [],
    levelBefore,
    levelAfter,
    unlocked: rewards.items.filter((item) => item.level > levelBefore && item.level <= levelAfter),
  }
}

export type CosmeticColors = { boardColor: string | null; wireColors: string[] | null; matColor: string | null }

export function equipCosmetic(save: SaveData, item: RewardItem, rewards: Rewards): SaveData {
  if (item.kind === "decor") return save
  if (item.id !== "default" && item.level > levelFor(save.xp, rewards).level) return save
  return { ...save, cosmetics: { ...save.cosmetics, [item.kind]: item.id } }
}

export function cosmeticColors(cosmetics: Cosmetics, rewards: Rewards): CosmeticColors {
  const value = (id: string) => rewards.items.find((i) => i.id === id && i.kind !== "decor")?.value ?? null
  const wires = value(cosmetics.wires)
  return { boardColor: value(cosmetics.board), wireColors: wires ? wires.split(",") : null, matColor: value(cosmetics.mat) }
}
