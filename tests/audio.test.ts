import { describe, it, expect, vi } from "vitest"
import { createAudio } from "../src/audio"

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
