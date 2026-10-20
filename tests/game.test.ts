import { describe, it, expect } from "vitest"
import rewardsJson from "../data/rewards.json"
import { applyPhaseReward, evaluateStars, goalState, itemsUpTo, levelFor, type Rewards, type StarContext } from "../src/game"
import type { Evaluation, Star } from "../src/phases"
import { defaultSave, emptyDoc, type CircuitDoc } from "../src/state"

const rewards = rewardsJson as unknown as Rewards

function evaluation(partial: Partial<Evaluation> = {}): Evaluation {
  return { scenarios: [], divergences: [], cost: 5, budgetOk: true, matchOk: true, won: true, ...partial }
}

function docWithWires(n: number): CircuitDoc {
  const d = emptyDoc()
  for (let i = 0; i < n; i++) d.bench.wires.push({ id: `W${i}`, a: `A${i + 1}`, b: `B${i + 1}`, color: "#000" })
  return d
}

function ctx(partial: Partial<StarContext> = {}): StarContext {
  return { won: true, evaluation: evaluation(), doc: docWithWires(2), side: "bench", meterModesUsed: [], ...partial }
}

describe("stars", () => {
  it("evaluates each star kind", () => {
    const stars: Star[] = [{ kind: "solved" }, { kind: "noDivergence" }, { kind: "usedMeter", mode: "A" }, { kind: "maxCost", value: 5 }, { kind: "maxWires", value: 2 }]
    expect(evaluateStars(stars, ctx({ meterModesUsed: ["A"] }))).toEqual([true, true, true, true, true])
    const div = { kind: "wiring", partId: "L1", pin: "a", power: false } as Evaluation["divergences"][number]
    expect(evaluateStars(stars, ctx({ evaluation: evaluation({ divergences: [div], cost: 6 }), doc: docWithWires(3), meterModesUsed: ["V"] }))).toEqual([true, false, false, false, false])
  })

  it("no star without a win", () => {
    expect(evaluateStars([{ kind: "solved" }, { kind: "maxWires", value: 9 }], ctx({ won: false }))).toEqual([false, false])
  })

  it("goal states", () => {
    const wires: Star = { kind: "maxWires", value: 2 }
    expect(goalState(wires, ctx({ won: false }), false)).toBe("neutral")
    expect(goalState(wires, ctx({ won: false }), true)).toBe("met")
    expect(goalState(wires, ctx({ won: false, doc: docWithWires(3) }), true)).toBe("unmet")
    expect(goalState({ kind: "usedMeter", mode: "V" }, ctx({ won: false, meterModesUsed: ["V"] }), false)).toBe("met")
    expect(goalState({ kind: "usedMeter", mode: "V" }, ctx({ won: false }), false)).toBe("unmet")
    expect(goalState({ kind: "solved" }, ctx({ won: false }), true)).toBe("unmet")
    expect(goalState({ kind: "solved" }, ctx(), true)).toBe("met")
  })
})

describe("rewards", () => {
  it("xp only for new stars", () => {
    const save = { ...defaultSave(), progress: { g1p1: { won: true, bestCost: 5, stars: [0] } }, xp: 100 }
    const first = applyPhaseReward(save, "g1p1", [true, true, false], 5, rewards)
    expect(first.newStars).toEqual([1])
    expect(first.xpGained).toBe(100)
    expect(first.save.progress.g1p1.stars).toEqual([0, 1])
    const again = applyPhaseReward(first.save, "g1p1", [true, true, false], 5, rewards)
    expect(again.xpGained).toBe(0)
    expect(again.newStars).toEqual([])
  })

  it("best cost keeps the minimum", () => {
    let save = defaultSave()
    for (const cost of [9, 7, 8]) save = applyPhaseReward(save, "g1p6", [true, false, false], cost, rewards).save
    expect(save.progress.g1p6).toMatchObject({ won: true, bestCost: 7 })
  })

  it("level boundaries", () => {
    expect(levelFor(0, rewards).level).toBe(1)
    expect(levelFor(299, rewards).level).toBe(1)
    expect(levelFor(300, rewards)).toMatchObject({ level: 2, floor: 300, next: 700 })
    expect(levelFor(500, rewards).progress).toBeCloseTo(0.5, 5)
    expect(levelFor(6300, rewards).level).toBe(10)
  })

  it("beyond max level", () => {
    expect(levelFor(9000, rewards)).toMatchObject({ level: 10, next: null, progress: 1 })
    expect(itemsUpTo(10, rewards)).toHaveLength(9)
    expect(itemsUpTo(1, rewards)).toHaveLength(0)
  })

  it("level up unlocks the items of the levels reached", () => {
    const first = applyPhaseReward({ ...defaultSave(), xp: 200 }, "g2p1", [true, true, true], 6, rewards)
    expect(first.xpGained).toBe(300)
    expect([first.levelBefore, first.levelAfter]).toEqual([1, 2])
    expect(first.unlocked.map((i) => i.id)).toEqual(["lamp-desk"])
    const second = applyPhaseReward({ ...defaultSave(), xp: 650 }, "g2p2", [true, true, false], 8, rewards)
    expect([second.levelBefore, second.levelAfter]).toEqual([2, 3])
    expect(second.unlocked.map((i) => i.id)).toEqual(["wires-neon"])
    const none = applyPhaseReward({ ...defaultSave(), xp: 0 }, "g2p3", [true, false, false], 10, rewards)
    expect(none.unlocked).toEqual([])
  })
})
