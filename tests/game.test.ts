import { describe, it, expect } from "vitest"
import rewardsJson from "../data/rewards.json"
import parts from "../data/parts.json"
import phasesJson from "../data/phases.json"
import { applyDailyReward, applyPhaseReward, buildRewards, groupSummaries, cosmeticColors, equipCosmetic, dailyRepair, dailyUnlocked, evaluateStars, goalState, itemsUpTo, levelFor, seededRandom, updateStreak, type Rewards, type RewardsData, type StarContext } from "../src/game"
import type { PartsCatalog } from "../src/netlist"
import { evaluate, type Evaluation, type PhaseData, type Star } from "../src/phases"
import { defaultSave, emptyDoc, type CircuitDoc } from "../src/state"

const rewardsData = rewardsJson as unknown as RewardsData
const rewards: Rewards = { ...buildRewards(rewardsData, loadPhases(phasesJson)), levels: [0, 300, 700, 1200, 1800, 2500, 3300, 4200, 5200, 6300] }

function evaluation(partial: Partial<Evaluation> = {}): Evaluation {
  return { scenarios: [], divergences: [], cost: 5, budgetOk: true, won: true, ...partial }
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

describe("buildRewards", () => {
  const demoData = loadPhases(phasesJson)
  const maxXp = demoData.groups.filter((g) => g.demo).flatMap((g) => g.phases).reduce((n, p) => n + p.stars.length, 0) * rewardsData.xpPerStar

  it("level 10 sits between 85 and 90 percent of phase xp", () => {
    const built = buildRewards(rewardsData, demoData)
    const ratio = built.levels[9] / maxXp
    expect(ratio).toBeGreaterThanOrEqual(0.85)
    expect(ratio).toBeLessThanOrEqual(0.9)
  })

  it("thresholds grow strictly", () => {
    const built = buildRewards(rewardsData, demoData)
    for (let i = 1; i < built.levels.length; i++) expect(built.levels[i]).toBeGreaterThan(built.levels[i - 1])
  })

  it("thresholds follow the demo size", () => {
    const base = demoData.groups[0].phases[0]
    const fake: PhaseData = {
      future: [],
      groups: [{ id: "g0", title: "t", demo: true, concept: "", unlocks: [], requires: null, block: "eletrica", burns: false, phases: Array.from({ length: 28 }, (_, i) => ({ ...base, id: `p${i}`, stars: [{ kind: "solved" as const }, { kind: "solved" as const }, { kind: "solved" as const }] })) }],
    }
    expect(buildRewards(rewardsData, fake).levels).toEqual([0, 300, 750, 1300, 2000, 2800, 3700, 4700, 5900, 7500])
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

import phasesRaw from "../data/phases.json"
import { loadPhases } from "../src/phases"
import { starsTotal } from "../src/game"

describe("starsTotal", () => {
  it("counts the union of stars over demo phases", () => {
    const data = loadPhases(phasesRaw)
    const progress = { g0p1: { won: true, bestCost: null, stars: [0, 2] }, g1p1: { won: true, bestCost: 5, stars: [0] }, sandbox: { won: true, bestCost: null, stars: [0, 1, 2] } }
    expect(starsTotal(progress, data)).toEqual({ earned: 3, max: 84 })
  })
})

const catalog = parts as unknown as PartsCatalog
const data = loadPhases(phasesJson)
const g3Done = new Set(data.groups.filter((g) => g.demo).flatMap((g) => g.phases.map((p) => p.id)))
const metered: PhaseData = { ...data, groups: data.groups.map((g) => (g.id === "g2" ? { ...g, phases: data.groups.find((x) => x.id === "g6")!.phases } : g)) }
const DATES = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"]

describe("daily repair", () => {
  it("seeded random is deterministic", () => {
    const a = seededRandom("2026-11-01")
    const b = seededRandom("2026-11-01")
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(seededRandom("2026-11-02")()).not.toBe(seededRandom("2026-11-01")())
  })

  it("same date gives the same challenge", () => {
    const one = dailyRepair("2026-11-03", data, g3Done, catalog)
    const two = dailyRepair("2026-11-03", data, g3Done, catalog)
    expect(one).not.toBeNull()
    expect(JSON.stringify(one!.initial)).toBe(JSON.stringify(two!.initial))
  })

  it("challenge starts broken and the reference wins", () => {
    for (const date of DATES) {
      const phase = dailyRepair(date, data, g3Done, catalog)!
      expect(phase.id).toBe(`daily-${date}`)
      expect(phase.type).toBe("repair")
      expect(phase.showDivergence).toBe(false)
      expect(phase.stars).toEqual([{ kind: "solved" }, { kind: "usedMeter", mode: "V" }, { kind: "usedMeter", mode: "A" }])
      expect(evaluate(phase, phase.initial!, catalog).won).toBe(false)
      expect(evaluate(phase, phase.referenceSolution!, catalog).won).toBe(true)
    }
  })

  it("different dates usually differ", () => {
    const distinct = new Set(DATES.map((d) => JSON.stringify(dailyRepair(d, data, g3Done, catalog)!.initial)))
    expect(distinct.size).toBeGreaterThanOrEqual(7)
  })

  it("returns null when nothing breaks", () => {
    const base = data.groups[1].phases.find((p) => p.type === "build" && p.referenceSolution)!
    const fake: PhaseData = { future: [], groups: [{ id: "g3", title: "t", demo: true, concept: "", unlocks: [], requires: null, block: "eletrica", burns: false, phases: [{ ...base, id: "x1", expect: [] }] }] }
    expect(dailyRepair("2026-11-01", fake, new Set(["x1"]), catalog)).toBeNull()
  })

  it("daily stays locked until the meter group is finished", () => {
    const meterIds = data.groups.find((g) => g.id === "g2")!.phases.map((p) => p.id)
    expect(dailyUnlocked(new Set(), data)).toBe(false)
    expect(dailyUnlocked(new Set(meterIds.slice(1)), data)).toBe(false)
  })

  it("daily unlocks after finishing g2", () => {
    const meterIds = data.groups.find((g) => g.id === "g2")!.phases.map((p) => p.id)
    expect(dailyUnlocked(new Set(meterIds), data)).toBe(true)
  })

  it("daily stays locked while the meter group is empty", () => {
    const empty: PhaseData = { ...data, groups: data.groups.map((g) => (g.id === "g2" ? { ...g, phases: [] } : g)) }
    expect(dailyUnlocked(g3Done, empty)).toBe(false)
  })

  it("daily repair breaks every new build phase at least once across 30 dates", () => {
    const seen = new Set<string>()
    for (let day = 1; day <= 30; day++) {
      const date = `2026-12-${String(day).padStart(2, "0")}`
      const phase = dailyRepair(date, data, g3Done, catalog)
      if (phase) seen.add(JSON.stringify(phase.referenceSolution))
    }
    const bases = data.groups.flatMap((g) => g.phases).filter((p) => (p.type === "build" || p.type === "order") && p.referenceSolution && ["g2", "g3"].includes(p.id.slice(0, 2)))
    const covered = bases.filter((p) => seen.has(JSON.stringify(p.referenceSolution)))
    expect(covered.length).toBeGreaterThanOrEqual(Math.floor(bases.length / 2))
  })

  it("streak counts consecutive days, resets on gaps, ignores repeats", () => {
    let daily = defaultSave().daily
    daily = updateStreak(daily, "2026-11-01")
    expect(daily.streak).toBe(1)
    daily = updateStreak(daily, "2026-11-02")
    expect(daily.streak).toBe(2)
    daily = updateStreak(daily, "2026-11-02")
    expect(daily.streak).toBe(2)
    expect(daily.wonDates).toEqual(["2026-11-01", "2026-11-02"])
    daily = updateStreak(daily, "2026-11-30")
    expect(daily.streak).toBe(2 - 1)
    expect(updateStreak({ lastWonDate: "2026-10-31", streak: 4, wonDates: ["2026-10-31"] }, "2026-11-01").streak).toBe(5)
    expect(daily.lastWonDate).toBe("2026-11-30")
  })

  it("daily xp only once per date", () => {
    const first = applyDailyReward(defaultSave(), "2026-11-01", rewards)
    expect(first.xpGained).toBe(150)
    expect(first.save.xp).toBe(150)
    expect(first.save.daily.streak).toBe(1)
    const again = applyDailyReward(first.save, "2026-11-01", rewards)
    expect(again.xpGained).toBe(0)
    expect(again.save.xp).toBe(150)
    const levelUp = applyDailyReward({ ...defaultSave(), xp: 250 }, "2026-11-02", rewards)
    expect([levelUp.levelBefore, levelUp.levelAfter]).toEqual([1, 2])
    expect(levelUp.unlocked.map((i) => i.id)).toEqual(["lamp-desk"])
  })
})

describe("cosmetics", () => {
  const item = (id: string) => rewards.items.find((i) => i.id === id)!

  it("equips only unlocked cosmetics", () => {
    const low = { ...defaultSave(), xp: 1800 }
    expect(equipCosmetic(low, item("board-blue"), rewards).cosmetics.board).toBe("board-blue")
    expect(equipCosmetic(low, item("board-black"), rewards).cosmetics.board).toBe("default")
    expect(equipCosmetic(low, item("wires-neon"), rewards).cosmetics.wires).toBe("wires-neon")
  })

  it("default resets the slot", () => {
    const save = equipCosmetic({ ...defaultSave(), xp: 3300 }, item("mat-orange"), rewards)
    expect(save.cosmetics.mat).toBe("mat-orange")
    expect(equipCosmetic(save, { level: 1, id: "default", kind: "mat", name: "Sem tapete" }, rewards).cosmetics.mat).toBe("default")
  })

  it("decor items cannot be equipped", () => {
    const save = { ...defaultSave(), xp: 9000 }
    expect(equipCosmetic(save, item("shelf"), rewards)).toEqual(save)
  })

  it("resolves equipped ids to colors", () => {
    expect(cosmeticColors(defaultSave().cosmetics, rewards)).toEqual({ boardColor: null, wireColors: null, matColor: null })
    expect(cosmeticColors({ board: "board-blue", wires: "wires-neon", mat: "mat-orange" }, rewards)).toEqual({
      boardColor: "#3B82F6",
      wireColors: ["#22D3EE", "#A3E635", "#F472B6", "#FACC15"],
      matColor: "#F97316",
    })
  })
})

import { shiftColumns, withoutWire } from "./assembly"

describe("daily repair uses the same win rule", () => {
  it("valid assemblies win, the broken start and near-misses do not", () => {
    for (const date of DATES) {
      const phase = dailyRepair(date, data, g3Done, catalog)!
      const ref = phase.referenceSolution!
      const shifted = shiftColumns(ref, 2) ?? shiftColumns(ref, -2)
      if (shifted) expect(evaluate(phase, shifted, catalog).won, `${date} shifted`).toBe(true)
      expect(evaluate(phase, phase.initial!, catalog).won, `${date} initial`).toBe(false)
      expect(evaluate(phase, emptyDoc(), catalog).won, `${date} empty`).toBe(false)
      const wire = ref.bench.wires[0]
      if (wire) expect(evaluate(phase, withoutWire(ref, wire.id), catalog).won, `${date} without ${wire.id}`).toBe(false)
    }
  })
})

describe("groupSummaries", () => {
  const real = loadPhases(phasesJson)
  const wonAll = (ids: string[], stars = [0]) => Object.fromEntries(ids.map((id) => [id, { won: true, bestCost: null, stars }]))
  const ids = (g: string) => real.groups.find((x) => x.id === g)!.phases.map((p) => p.id)

  it("empty save: first group available, others locked with the required title", () => {
    const list = groupSummaries(real, {})
    expect(list.map((g) => g.id)).toEqual(real.groups.map((g) => g.id))
    expect(list[0].state).toBe("available")
    expect(list[1]).toMatchObject({ state: "locked", requiresTitle: "Bancada" })
  })

  it("partial group shows done/total and stars", () => {
    const g0 = ids("g0")
    const list = groupSummaries(real, wonAll(g0.slice(0, 2), [0, 1]))
    expect(list[0]).toMatchObject({ done: 2, total: g0.length, stars: 4, maxStars: g0.length * 3, state: "available" })
  })

  it("complete means every phase won regardless of stars", () => {
    const list = groupSummaries(real, wonAll(ids("g0"), [0]))
    expect(list[0].state).toBe("complete")
    expect(list[1].state).toBe("available")
  })

  it("group with no phases is never complete", () => {
    const everything = wonAll(real.groups.flatMap((g) => g.phases.map((p) => p.id)))
    for (const id of ["g4", "g5", "g8"]) expect(groupSummaries(real, everything).find((g) => g.id === id)!.state).not.toBe("complete")
  })

  it("non-demo groups are soon", () => {
    const list = groupSummaries(real, {})
    expect(list.filter((g) => !g.demo).every((g) => g.state === "soon")).toBe(true)
    expect(list.filter((g) => !g.demo)).toHaveLength(4)
  })

  it("legacy progress keys are ignored", () => {
    const legacy = { "legacy:g3p1": { won: true, bestCost: 2, stars: [0, 1, 2] } }
    const base = wonAll(ids("g0"))
    const withLegacy = { ...base, ...legacy }
    expect(groupSummaries(real, withLegacy)).toEqual(groupSummaries(real, base))
    expect(starsTotal(withLegacy, real)).toEqual(starsTotal(base, real))
    const all = new Set(Object.keys(withLegacy))
    expect(dailyUnlocked(all, real)).toBe(dailyUnlocked(new Set(Object.keys(base)), real))
  })
})
