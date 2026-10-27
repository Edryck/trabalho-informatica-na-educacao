import type { SolveResult } from "./solver"

export type SfxName = "click" | "snap" | "wire" | "toggle" | "tick" | "star" | "win" | "levelup" | "unlock" | "soft-error" | "lamp-on" | "zap" | "dial"
export type LoopName = "motor" | "buzzer"

const SFX: SfxName[] = ["click", "snap", "wire", "toggle", "tick", "star", "win", "levelup", "unlock", "soft-error", "lamp-on", "zap", "dial"]

export const DEFAULT_TRACKS = ["workshop-1.mp3", "workshop-2.mp3"]

const FADE_MS = 2000
const FADE_STEP_MS = 100
const FADE_STEPS = FADE_MS / FADE_STEP_MS
const DUCK_RETURN_MS = 1000

type AudioOptions = {
  sfxVolume: number
  musicVolume: number
  muted?: boolean
  base?: string
  musicBase?: string
  tracks?: string[]
  make?: (src: string) => HTMLAudioElement | null
}

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

const clamp = (v: number) => Math.max(0, Math.min(1, v))

export function createAudio(opts: AudioOptions) {
  const make = opts.make ?? defaultMake
  const base = opts.base ?? "sfx/"
  const musicBase = opts.musicBase ?? "music/"
  const tracks = opts.tracks ?? DEFAULT_TRACKS
  const loaded = new Map<SfxName, HTMLAudioElement | null>()
  const elements = new Map<string, HTMLAudioElement | null>()
  const loops = new Map<LoopName, HTMLAudioElement | null>()
  const bad = new Set<string>()

  let sfxVolume = clamp(opts.sfxVolume)
  let musicVolume = clamp(opts.musicVolume)
  let muted = opts.muted ?? false
  let hidden = false
  let ducked = false
  let duckTimer: ReturnType<typeof setTimeout> | undefined
  let duckFade: ReturnType<typeof setInterval> | undefined
  let gestureSeen = false
  let unlocked = false
  let pending = false
  let attempt = 0
  let trackIndex = 0
  let active: HTMLAudioElement | null = null
  let fade: ReturnType<typeof setInterval> | undefined

  const source = (name: SfxName) => {
    if (!loaded.has(name)) loaded.set(name, make(`${base}${name}.ogg`))
    return loaded.get(name) ?? null
  }

  const musicTarget = () => (muted ? 0 : musicVolume * (ducked ? 0.5 : 1))
  const sfxTarget = () => (muted ? 0 : sfxVolume)
  const playAllowed = () => gestureSeen && !muted && !hidden && musicVolume > 0

  const loopElement = (name: LoopName) => {
    if (!loops.has(name)) {
      const el = make(`${base}${name}.ogg`)
      if (el) {
        el.loop = true
        el.preservesPitch = false
        el.volume = sfxTarget()
      }
      loops.set(name, el)
    }
    return loops.get(name) ?? null
  }

  const syncLoops = () => {
    for (const el of loops.values()) if (el) el.volume = sfxTarget()
  }

  const stopLoops = () => {
    for (const el of loops.values()) {
      if (!el) continue
      el.pause()
      el.currentTime = 0
    }
  }

  const cancelDuck = () => {
    clearTimeout(duckTimer)
    clearInterval(duckFade)
    duckTimer = undefined
    duckFade = undefined
    ducked = false
  }

  const releaseDuck = (el: HTMLAudioElement) => {
    ducked = false
    const from = el.volume
    const steps = DUCK_RETURN_MS / FADE_STEP_MS
    let step = 0
    duckFade = setInterval(() => {
      step++
      el.volume = from + (musicTarget() - from) * Math.min(1, step / steps)
      if (step >= steps) {
        clearInterval(duckFade)
        duckFade = undefined
      }
    }, FADE_STEP_MS)
  }

  const clearFade = () => {
    clearInterval(fade)
    fade = undefined
  }

  const fadeIn = (el: HTMLAudioElement) => {
    clearFade()
    let step = 0
    el.volume = 0
    fade = setInterval(() => {
      step++
      el.volume = musicTarget() * Math.min(1, step / FADE_STEPS)
      if (step >= FADE_STEPS) clearFade()
    }, FADE_STEP_MS)
  }

  const pickTrack = (from: number) => {
    for (let step = 0; step < tracks.length; step++) {
      const index = (from + step) % tracks.length
      if (!bad.has(tracks[index])) return index
    }
    return -1
  }

  const onTrackFail = (name: string, el: HTMLAudioElement) => {
    bad.add(name)
    if (active !== el) return
    el.pause()
    active = null
    pending = false
    startMusic()
  }

  const onTrackEnded = (index: number, el: HTMLAudioElement) => {
    if (active !== el) return
    trackIndex = (index + 1) % tracks.length
    active = null
    startMusic()
  }

  const element = (index: number) => {
    const name = tracks[index]
    if (!elements.has(name)) {
      const el = make(`${musicBase}${name}`)
      elements.set(name, el)
      if (el) {
        el.loop = tracks.length === 1
        el.addEventListener("error", () => onTrackFail(name, el))
        el.addEventListener("ended", () => onTrackEnded(index, el))
      }
    }
    return elements.get(name) ?? null
  }

  function startMusic(): void {
    if (pending || !playAllowed()) return
    const index = pickTrack(trackIndex)
    if (index < 0) return
    trackIndex = index
    const el = element(index)
    if (!el) {
      bad.add(tracks[index])
      return startMusic()
    }
    const id = ++attempt
    pending = true
    active = el
    el.volume = 0
    el.play().then(
      () => {
        if (id !== attempt) return
        pending = false
        unlocked = true
        if (playAllowed()) fadeIn(el)
      },
      (err: DOMException) => {
        if (id !== attempt) return
        pending = false
        if (err.name === "NotAllowedError" || err.name === "AbortError") return
        onTrackFail(tracks[index], el)
      },
    )
  }

  const refresh = () => {
    cancelDuck()
    if (!playAllowed()) {
      clearFade()
      if (active) {
        active.pause()
        active.volume = 0
      }
      return
    }
    if (!active || active.paused) return startMusic()
    clearFade()
    active.volume = musicTarget()
  }

  return {
    preload() {
      for (const name of SFX) source(name)
    },
    setSfxVolume(v: number) {
      sfxVolume = clamp(v)
      syncLoops()
    },
    setMusicVolume(v: number) {
      musicVolume = clamp(v)
      refresh()
    },
    setMuted(m: boolean) {
      muted = m
      syncLoops()
      refresh()
    },
    setHidden(h: boolean) {
      hidden = h
      if (h) stopLoops()
      refresh()
    },
    setLoop(name: LoopName, on: boolean, rate = 1) {
      const el = loopElement(name)
      if (!el) return
      if (!on) {
        el.pause()
        el.currentTime = 0
        return
      }
      if (hidden) return
      el.volume = sfxTarget()
      el.playbackRate = rate
      if (el.paused) void el.play()?.catch(() => undefined)
    },
    stopLoops,
    duck(ms: number) {
      cancelDuck()
      if (!active || active.paused) return
      const el = active
      clearFade()
      ducked = true
      el.volume = musicTarget()
      duckTimer = setTimeout(() => {
        duckTimer = undefined
        releaseDuck(el)
      }, ms)
    },
    unlock() {
      gestureSeen = true
      if (!unlocked) startMusic()
    },
    isUnlocked() {
      return unlocked
    },
    play(name: SfxName, pitch = 1) {
      if (muted || sfxVolume <= 0) return
      try {
        const original = source(name)
        if (!original) return
        const node = original.cloneNode(true) as HTMLAudioElement
        node.volume = sfxVolume
        // sem isso o navegador acelera mas segura o tom, e a escada das estrelas some
        node.preservesPitch = false
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

export type SoundCue = { kind: "play"; name: SfxName } | { kind: "loop"; name: LoopName; on: boolean; rate: number }

export const CUE_MIN_GAP_MS = 300

const litParts = (result: SolveResult | null) =>
  new Set(Object.entries(result?.partState ?? {}).filter(([, s]) => (s.kind === "lamp" || s.kind === "led") && s.lit).map(([id]) => id))

export function soundCues(prev: SolveResult | null, next: SolveResult): SoundCue[] {
  const cues: SoundCue[] = []
  const before = litParts(prev)
  if ([...litParts(next)].some((id) => !before.has(id))) cues.push({ kind: "play", name: "lamp-on" })
  const hadShort = prev?.warnings.some((w) => w.kind === "shortCircuit") ?? false
  if (!hadShort && next.warnings.some((w) => w.kind === "shortCircuit")) cues.push({ kind: "play", name: "zap" })
  const spinning = Object.entries(next.partState).filter(([, s]) => s.kind === "motor" && s.spinning)
  const strongest = Math.max(0, ...spinning.map(([id]) => Math.abs(next.partCurrent[id] ?? 0)))
  cues.push({ kind: "loop", name: "motor", on: spinning.length > 0, rate: spinning.length > 0 ? Math.min(1.4, Math.max(0.8, 0.8 + strongest * 2)) : 1 })
  cues.push({ kind: "loop", name: "buzzer", on: Object.values(next.partState).some((s) => s.kind === "buzzer" && s.sounding), rate: 1 })
  return cues
}

export function throttleCues(cues: SoundCue[], lastAt: Partial<Record<SfxName, number>>, now: number): { cues: SoundCue[]; lastAt: Partial<Record<SfxName, number>> } {
  const nextAt = { ...lastAt }
  const passed = cues.filter((cue) => {
    if (cue.kind === "loop" || (cue.name !== "lamp-on" && cue.name !== "zap")) return true
    const last = nextAt[cue.name]
    if (last !== undefined && now - last < CUE_MIN_GAP_MS) return false
    nextAt[cue.name] = now
    return true
  })
  return { cues: passed, lastAt: nextAt }
}
