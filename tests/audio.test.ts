import { describe, it, expect, vi } from "vitest"
import { createAudio, soundCues, throttleCues, type SoundCue } from "../src/audio"
import type { PartState, SolveResult } from "../src/solver"

type FakeAudio = { volume: number; playbackRate: number; play: () => Promise<void>; cloneNode: () => FakeAudio; preload: string }

function fake(play: () => Promise<void> = () => Promise.resolve()): { make: (src: string) => HTMLAudioElement; played: FakeAudio[] } {
  const played: FakeAudio[] = []
  const build = (): FakeAudio => {
    const node: FakeAudio = {
      volume: 1,
      playbackRate: 1,
      preload: "",
      play: () => {
        played.push(node)
        return play()
      },
      cloneNode: () => build(),
    }
    return node
  }
  return { make: () => build() as unknown as HTMLAudioElement, played }
}

type Fake = {
  src: string
  volume: number
  loop: boolean
  paused: boolean
  playbackRate: number
  currentTime: number
  preservesPitch: boolean
  plays: number
  play: () => Promise<void>
  pause: () => void
  addEventListener: (type: string, handler: () => void) => void
  fire: (type: string) => void
}

function fakeMake(made: Fake[], playResult: () => Promise<void> = () => Promise.resolve()): (src: string) => HTMLAudioElement {
  return (src: string) => {
    const handlers: Record<string, (() => void)[]> = {}
    const node: Fake = {
      src,
      volume: 1,
      loop: false,
      paused: true,
      playbackRate: 1,
      currentTime: 0,
      preservesPitch: true,
      plays: 0,
      play() {
        node.plays++
        node.paused = false
        return playResult()
      },
      pause() {
        node.paused = true
      },
      addEventListener(type, handler) {
        ;(handlers[type] ??= []).push(handler)
      },
      fire(type) {
        for (const handler of handlers[type] ?? []) handler()
      },
    }
    made.push(node)
    return node as unknown as HTMLAudioElement
  }
}

const music = (made: Fake[], name = "t.mp3") => made.find((m) => m.src.endsWith(name))!

describe("audio", () => {
  it("play never throws when audio is unavailable", () => {
    const audio = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: () => null })
    expect(() => {
      audio.preload()
      audio.play("win")
    }).not.toThrow()
  })

  it("play swallows a rejected play()", async () => {
    const onUnhandled = vi.fn()
    process.on("unhandledRejection", onUnhandled)
    const audio = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fake(() => Promise.reject(new Error("blocked"))).make })
    audio.play("click")
    await new Promise((r) => setTimeout(r, 10))
    process.off("unhandledRejection", onUnhandled)
    expect(onUnhandled).not.toHaveBeenCalled()
  })

  it("applies sfx volume and pitch", () => {
    const f = fake()
    const audio = createAudio({ sfxVolume: 0.5, musicVolume: 0.5, make: f.make })
    audio.play("star", 1.26)
    expect(f.played[0]).toMatchObject({ volume: 0.5, playbackRate: 1.26 })
    audio.setSfxVolume(0)
    audio.play("star")
    expect(f.played).toHaveLength(1)
  })

  it("muted silences effects", () => {
    const f = fake()
    const audio = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, muted: true, make: f.make })
    audio.play("click")
    expect(f.played).toHaveLength(0)
  })
})

describe("music unlock", () => {
  it("[RF 1] plays once after unlock, with fade-in", async () => {
    vi.useFakeTimers()
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(made), tracks: ["t.mp3"] })
    a.unlock()
    a.unlock()
    await Promise.resolve()
    a.unlock()
    expect(music(made).plays).toBe(1)
    expect(a.isUnlocked()).toBe(true)
    expect(music(made).volume).toBeLessThan(0.1)
    vi.advanceTimersByTime(2000)
    expect(music(made).volume).toBeCloseTo(0.5)
    vi.useRealTimers()
  })

  it("[RF 1] blocked play stays locked and retries on the next gesture", async () => {
    let block = true
    const made: Fake[] = []
    const playResult = () => (block ? Promise.reject(new DOMException("x", "NotAllowedError")) : Promise.resolve())
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(made, playResult), tracks: ["t.mp3"] })
    a.unlock()
    await Promise.resolve()
    await Promise.resolve()
    expect(a.isUnlocked()).toBe(false)
    block = false
    a.unlock()
    await Promise.resolve()
    expect(a.isUnlocked()).toBe(true)
    expect(music(made).plays).toBe(2)
  })

  it("skips a track that errors", async () => {
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(made), tracks: ["a.mp3", "b.mp3"] })
    a.unlock()
    await Promise.resolve()
    music(made, "a.mp3").fire("error")
    expect(music(made, "b.mp3").plays).toBe(1)
  })

  it("two tracks alternate on ended", async () => {
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(made), tracks: ["a.mp3", "b.mp3"] })
    a.unlock()
    await Promise.resolve()
    music(made, "a.mp3").fire("ended")
    expect(music(made, "b.mp3").plays).toBe(1)
  })
})

describe("music volume and mute", () => {
  it("[RF 3] zero volume never plays; raising it after the gesture starts", async () => {
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0, make: fakeMake(made), tracks: ["t.mp3"] })
    a.unlock()
    await Promise.resolve()
    expect(made.some((m) => m.src.endsWith("t.mp3") && m.plays > 0)).toBe(false)
    a.setMusicVolume(0.4)
    expect(music(made).plays).toBe(1)
  })

  it("unmuting after unlock starts the music", async () => {
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, muted: true, make: fakeMake(made), tracks: ["t.mp3"] })
    a.unlock()
    await Promise.resolve()
    expect(made.some((m) => m.src.endsWith("t.mp3") && m.plays > 0)).toBe(false)
    a.setMuted(false)
    expect(music(made).plays).toBe(1)
  })

  it("muting during fade-in stops the fade at 0", async () => {
    vi.useFakeTimers()
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(made), tracks: ["t.mp3"] })
    a.unlock()
    await Promise.resolve()
    vi.advanceTimersByTime(500)
    a.setMuted(true)
    vi.advanceTimersByTime(3000)
    expect(music(made).volume).toBe(0)
    vi.useRealTimers()
  })

  it("slider during fade-in jumps to the new target and stops the fade", async () => {
    vi.useFakeTimers()
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(made), tracks: ["t.mp3"] })
    a.unlock()
    await Promise.resolve()
    vi.advanceTimersByTime(500)
    a.setMusicVolume(0.2)
    expect(music(made).volume).toBeCloseTo(0.2)
    vi.advanceTimersByTime(3000)
    expect(music(made).volume).toBeCloseTo(0.2)
    vi.useRealTimers()
  })
})

describe("ducking", () => {
  const playing = async (musicVolume = 0.6) => {
    vi.useFakeTimers()
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume, make: fakeMake(made), tracks: ["t.mp3"] })
    a.unlock()
    await Promise.resolve()
    vi.advanceTimersByTime(2000)
    return { a, made }
  }

  it("ducks to half and comes back", async () => {
    const { a, made } = await playing()
    a.duck(1500)
    expect(music(made).volume).toBeCloseTo(0.3)
    vi.advanceTimersByTime(2600)
    expect(music(made).volume).toBeCloseTo(0.6)
    vi.useRealTimers()
  })

  it("duck ending while muted stays at 0", async () => {
    const { a, made } = await playing()
    a.duck(1500)
    a.setMuted(true)
    vi.advanceTimersByTime(3000)
    expect(music(made).volume).toBe(0)
    vi.useRealTimers()
  })

  it("a new duck cancels the previous timer", async () => {
    const { a, made } = await playing()
    a.duck(1000)
    vi.advanceTimersByTime(900)
    a.duck(1000)
    vi.advanceTimersByTime(900)
    expect(music(made).volume).toBeCloseTo(0.3)
    vi.advanceTimersByTime(2000)
    expect(music(made).volume).toBeCloseTo(0.6)
    vi.useRealTimers()
  })

  it("slider during a duck jumps to the new target and stops it", async () => {
    const { a, made } = await playing()
    a.duck(1500)
    a.setMusicVolume(0.4)
    expect(music(made).volume).toBeCloseTo(0.4)
    vi.advanceTimersByTime(4000)
    expect(music(made).volume).toBeCloseTo(0.4)
    vi.useRealTimers()
  })
})

describe("visibility", () => {
  it("hidden before unlock never plays; showing the tab starts it", async () => {
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(made), tracks: ["t.mp3"] })
    a.setHidden(true)
    a.unlock()
    await Promise.resolve()
    expect(made.some((m) => m.src.endsWith("t.mp3") && m.plays > 0)).toBe(false)
    a.setHidden(false)
    expect(music(made).plays).toBe(1)
  })

  it("showing the tab does not start locked, muted or zero-volume music", async () => {
    const made: Fake[] = []
    const locked = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(made), tracks: ["t.mp3"] })
    locked.setHidden(true)
    locked.setHidden(false)
    expect(made.some((m) => m.src.endsWith("t.mp3") && m.plays > 0)).toBe(false)
    const madeB: Fake[] = []
    const muted = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(madeB), tracks: ["t.mp3"] })
    muted.unlock()
    await Promise.resolve()
    muted.setMuted(true)
    muted.setHidden(true)
    muted.setHidden(false)
    expect(music(madeB).paused).toBe(true)
    const madeC: Fake[] = []
    const silent = createAudio({ sfxVolume: 0.8, musicVolume: 0, make: fakeMake(madeC), tracks: ["t.mp3"] })
    silent.unlock()
    silent.setHidden(true)
    silent.setHidden(false)
    expect(madeC.some((m) => m.src.endsWith("t.mp3") && m.plays > 0)).toBe(false)
  })

  it("hiding pauses music and loops; loops do not come back on their own", async () => {
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(made), tracks: ["t.mp3"] })
    a.unlock()
    await Promise.resolve()
    a.setLoop("motor", true)
    a.setHidden(true)
    const motor = made.find((m) => m.src.endsWith("motor.ogg"))!
    expect(music(made).paused).toBe(true)
    expect(motor.paused).toBe(true)
    a.setHidden(false)
    expect(music(made).paused).toBe(false)
    expect(motor.paused).toBe(true)
  })
})

describe("loops", () => {
  it("[RF 2] starts, retunes and stops", () => {
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(made) })
    a.setLoop("motor", true, 1.3)
    a.setLoop("motor", true, 1.1)
    const motor = made.find((m) => m.src.endsWith("motor.ogg"))!
    expect(motor.plays).toBe(1)
    expect(motor.loop).toBe(true)
    expect(motor.playbackRate).toBeCloseTo(1.1)
    expect(motor.preservesPitch).toBe(false)
    a.stopLoops()
    expect(motor.paused).toBe(true)
    expect(motor.currentTime).toBe(0)
  })

  it("mute silences loops and restores volumes", () => {
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(made) })
    a.setLoop("motor", true)
    a.setMuted(true)
    const motor = made.find((m) => m.src.endsWith("motor.ogg"))!
    expect(motor.volume).toBe(0)
    a.setMuted(false)
    expect(motor.volume).toBeCloseTo(0.8)
  })

  it("sfx slider retunes a running loop", () => {
    const made: Fake[] = []
    const a = createAudio({ sfxVolume: 0.8, musicVolume: 0.5, make: fakeMake(made) })
    a.setLoop("buzzer", true)
    a.setSfxVolume(0.3)
    expect(made.find((m) => m.src.endsWith("buzzer.ogg"))!.volume).toBeCloseTo(0.3)
  })
})

describe("sound cues", () => {
  const base = { status: "ok", voltages: {}, linkCurrent: {}, partCurrent: {}, partState: {}, warnings: [], discrete: {}, passes: 1 } as unknown as SolveResult
  const withState = (partState: Record<string, PartState>, extra: Partial<SolveResult> = {}) => ({ ...base, partState, ...extra }) as SolveResult

  it("lamp-on fires only on the off-to-lit transition", () => {
    const off = withState({ L1: { kind: "lamp", lit: false, brightness: 0 } })
    const lit = withState({ L1: { kind: "lamp", lit: true, brightness: 1 }, L2: { kind: "lamp", lit: true, brightness: 1 } })
    expect(soundCues(off, lit).filter((c) => c.kind === "play")).toEqual([{ kind: "play", name: "lamp-on" }])
    expect(soundCues(lit, lit).filter((c) => c.kind === "play")).toEqual([])
  })

  it("[RF 5] zap only when the short starts", () => {
    const short = withState({}, { warnings: [{ kind: "shortCircuit" }] })
    expect(soundCues(base, short)).toContainEqual({ kind: "play", name: "zap" })
    expect(soundCues(short, short)).not.toContainEqual({ kind: "play", name: "zap" })
  })

  it("throttles lamp-on and zap within 300 ms, never loops", () => {
    const cues = [{ kind: "play", name: "lamp-on" }, { kind: "loop", name: "motor", on: true, rate: 1 }] as SoundCue[]
    const first = throttleCues(cues, {}, 1000)
    expect(first.cues).toHaveLength(2)
    expect(throttleCues(cues, first.lastAt, 1200).cues).toEqual([{ kind: "loop", name: "motor", on: true, rate: 1 }])
    expect(throttleCues(cues, first.lastAt, 1301).cues).toHaveLength(2)
  })

  it("motor and buzzer loops follow the state", () => {
    const spin = withState({ M1: { kind: "motor", spinning: true, direction: 1 }, Z1: { kind: "buzzer", sounding: true } }, { partCurrent: { M1: 0.1 } })
    const cues = soundCues(null, spin)
    expect(cues).toContainEqual({ kind: "loop", name: "motor", on: true, rate: 1.0 })
    expect(cues).toContainEqual({ kind: "loop", name: "buzzer", on: true, rate: 1 })
    expect(soundCues(spin, base)).toContainEqual({ kind: "loop", name: "motor", on: false, rate: 1 })
  })

  it("motor pitch is clamped", () => {
    const fast = withState({ M1: { kind: "motor", spinning: true, direction: 1 } }, { partCurrent: { M1: -5 } })
    expect(soundCues(null, fast)).toContainEqual({ kind: "loop", name: "motor", on: true, rate: 1.4 })
  })
})
