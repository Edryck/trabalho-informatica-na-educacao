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

describe("audio", () => {
  it("play never throws when audio is unavailable", () => {
    const audio = createAudio({ volume: 0.8, make: () => null })
    expect(() => {
      audio.preload()
      audio.play("win")
    }).not.toThrow()
  })

  it("play swallows a rejected play()", async () => {
    const onUnhandled = vi.fn()
    process.on("unhandledRejection", onUnhandled)
    const audio = createAudio({ volume: 0.8, make: fake(() => Promise.reject(new Error("blocked"))).make })
    audio.play("click")
    await new Promise((r) => setTimeout(r, 10))
    process.off("unhandledRejection", onUnhandled)
    expect(onUnhandled).not.toHaveBeenCalled()
  })

  it("applies volume and pitch", () => {
    const f = fake()
    const audio = createAudio({ volume: 0.5, make: f.make })
    audio.play("star", 1.26)
    expect(f.played[0]).toMatchObject({ volume: 0.5, playbackRate: 1.26 })
    audio.setVolume(0)
    audio.play("star")
    expect(f.played).toHaveLength(1)
  })
})
