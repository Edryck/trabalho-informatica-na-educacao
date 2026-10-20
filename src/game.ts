import type { Evaluation, PhaseData, Star } from "./phases"
import type { CircuitDoc, SaveData } from "./state"

export type RewardItem = { level: number; id: string; kind: "decor" | "board" | "wires" | "mat"; name: string; model?: string; value?: string }
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
