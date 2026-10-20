export type SfxName = "click" | "snap" | "wire" | "toggle" | "tick" | "star" | "win" | "levelup" | "unlock" | "soft-error"

const SFX: SfxName[] = ["click", "snap", "wire", "toggle", "tick", "star", "win", "levelup", "unlock", "soft-error"]

type AudioOptions = { volume: number; base?: string; make?: (src: string) => HTMLAudioElement | null }

function defaultMake(src: string): HTMLAudioElement | null {
  try {
    if (typeof Audio === "undefined") return null
    const audio = new Audio(src)
    audio.preload = "auto"
    return audio
  } catch {
    return null
  }
}

export function createAudio(opts: AudioOptions) {
  const make = opts.make ?? defaultMake
  const base = opts.base ?? "sfx/"
  let volume = opts.volume
  const loaded = new Map<SfxName, HTMLAudioElement | null>()

  const source = (name: SfxName) => {
    if (!loaded.has(name)) loaded.set(name, make(`${base}${name}.ogg`))
    return loaded.get(name) ?? null
  }

  return {
    preload() {
      for (const name of SFX) source(name)
    },
    setVolume(v: number) {
      volume = Math.max(0, Math.min(1, v))
    },
    play(name: SfxName, pitch = 1) {
      if (volume <= 0) return
      try {
        const original = source(name)
        if (!original) return
        const node = original.cloneNode(true) as HTMLAudioElement
        node.volume = volume
        node.playbackRate = pitch
        // navegador pode bloquear áudio antes do primeiro clique: ignora
        void node.play()?.catch(() => undefined)
      } catch {
        return
      }
    },
  }
}

export type GameAudio = ReturnType<typeof createAudio>
