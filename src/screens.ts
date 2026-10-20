import type { LevelInfo, RewardItem } from "./game"
import type { SfxName } from "./audio"
import { bloom, phaseLabel, bounceLand, burst, countUp, fadeSlide, motionReduced, requestSkip, skipRequestedNow, softRise, spotlight, springTo, starIcon, type Box } from "./ui"

export type CompleteSummary = {
  phaseId: string
  goal: string
  parts: { label: string; count: number }[]
  cost: number
  budget: number | null
  referenceCost: number | null
  bestCost: number | null
  stars: { label: string; earned: boolean; isNew: boolean }[]
  xpGained: number
  levelBefore: LevelInfo
  levelAfter: LevelInfo
  unlocked: RewardItem[]
}

export type CompleteHandlers = {
  onNext: (() => void) | null
  onCheaper(): void
  onRetry(): void
  onMap(): void
  play(name: SfxName, pitch?: number): void
}

const STAR_PITCH = [1, 1.12, 1.26]

function wait(ms: number): Promise<void> {
  if (motionReduced() || skipRequestedNow()) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function xpLine(info: LevelInfo, xp: number): string {
  return info.next === null ? `${Math.round(xp)} XP · nível máximo` : `${Math.round(xp)} / ${info.next} XP`
}

export function createCompleteScreen(el: HTMLElement) {
  el.className = "complete-screen"
  el.hidden = true
  let handlers: CompleteHandlers | null = null
  let animating = false
  let skipped = false
  let seq = 0
  const skip = () => {
    if (!animating || skipped) return
    skipped = true
    requestSkip(true)
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && animating) {
      event.preventDefault()
      skip()
    }
  }
  el.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action
    if (!action) return skip()
    if (!handlers) return
    if (action === "next") handlers.onNext?.()
    if (action === "cheaper") handlers.onCheaper()
    if (action === "retry") handlers.onRetry()
    if (action === "map") handlers.onMap()
  })
  return {
    async show(summary: CompleteSummary, next: CompleteHandlers): Promise<void> {
      handlers = next
      el.hidden = false
      const before = summary.levelBefore
      const after = summary.levelAfter
      const levelUp = after.level > before.level
      const cheaper = summary.referenceCost !== null && summary.cost > summary.referenceCost
      const costLine =
        summary.referenceCost === null
          ? ""
          : cheaper
            ? `<p class="complete-cost">Seu circuito: <span class="mono">${summary.cost} créditos</span> \u00b7 dá pra fazer com <span class="mono">${summary.referenceCost}</span>.</p>`
            : `<p class="complete-cost">Seu circuito: <span class="mono">${summary.cost} créditos</span>. Esse é o menor custo que a gente conhece.</p>`
      const stars = summary.stars
        .map(
          (s) =>
            `<li class="complete-star ${s.earned ? "earned" : "missed"}" aria-label="${s.label}: ${s.earned ? "conquistada" : "ainda não"}${s.isNew ? ", nova" : ""}"><span class="complete-star-icon">${starIcon(s.earned ? "met" : "unmet", 60)}</span><span class="complete-star-label">${s.label}</span>${s.isNew ? '<span class="complete-star-new">nova</span>' : ""}</li>`,
        )
        .join("")
      const item = summary.unlocked[0]
      el.innerHTML = `
        <div class="complete-card animating" role="dialog" aria-modal="true" aria-labelledby="complete-title" tabindex="-1">
          <header class="complete-head">
            <h2 id="complete-title">Fase concluída</h2>
            <p class="complete-goal">${summary.goal.charAt(0).toUpperCase()}${summary.goal.slice(1)} <span class="mono">${phaseLabel(summary.phaseId)}</span></p>
          </header>
          <ol class="complete-stars">${stars}</ol>
          <section class="complete-xp" aria-label="Experiência">
            <div class="complete-xp-row">
              <span class="badge-level complete-level-badge" aria-hidden="true"><span class="badge-level-number">${before.level}</span></span>
              <span class="complete-level">Nível ${before.level}</span>
              <span class="complete-xp-gain">${summary.xpGained > 0 ? "+0 XP" : "Sem estrela nova"}</span>
            </div>
            <div class="xp-track"><div class="xp-fill" style="width:${Math.round(before.progress * 100)}%"></div></div>
            <span class="complete-xp-total">${xpLine(before, before.xp)}</span>
          </section>
          ${
            levelUp
              ? `<section class="complete-unlock" aria-live="polite"><p class="complete-unlock-level">Nível ${after.level}</p>${item ? `<p class="complete-unlock-item"><strong>${item.name}</strong><span>Novo item da oficina</span></p>` : ""}</section>`
              : ""
          }
          <div class="complete-details">
            ${summary.parts.length ? `<p class="complete-parts">Peças usadas: ${summary.parts.map((p) => `${p.count}\u00d7 ${p.label}`).join(", ")}</p>` : ""}
            ${costLine}
            ${summary.bestCost !== null && summary.budget !== null ? `<p class="complete-best">Melhor versão até agora: <span class="mono">${summary.bestCost} créditos</span></p>` : ""}
          </div>
          <div class="complete-actions">
            ${next.onNext ? '<button type="button" class="btn-primary" data-action="next">Próxima fase</button>' : ""}
            <button type="button" class="btn-secondary" data-action="retry">Tentar de novo</button>
            ${cheaper ? '<button type="button" class="btn-secondary" data-action="cheaper">Tentar versão mais barata</button>' : ""}
            <button type="button" class="btn-secondary" data-action="map">Mapa de fases</button>
          </div>
          <p class="complete-skip" aria-hidden="true">Clique ou Esc pra pular</p>
        </div>`
      const card = el.querySelector<HTMLElement>(".complete-card")!
      const levelBadge = card.querySelector<HTMLElement>(".badge-level-number")!
      const levelText = card.querySelector<HTMLElement>(".complete-level")!
      const gain = card.querySelector<HTMLElement>(".complete-xp-gain")!
      const fill = card.querySelector<HTMLElement>(".xp-fill")!
      const total = card.querySelector<HTMLElement>(".complete-xp-total")!
      const unlock = card.querySelector<HTMLElement>(".complete-unlock")
      const runId = ++seq
      const stale = () => runId !== seq
      const quiet = () => skipped || stale() || motionReduced()
      animating = true
      skipped = false
      window.addEventListener("keydown", onKey)
      card.focus({ preventScroll: true })
      next.play("win")
      await fadeSlide(card, { duration: 300 })
      // cada estrela cai um pouco depois da anterior, sem esperar a outra quicar até o fim
      let earnedIndex = 0
      const drops: Promise<void>[] = []
      for (const li of card.querySelectorAll<HTMLElement>(".complete-star")) {
        const icon = li.querySelector(".complete-star-icon")!
        if (li.classList.contains("earned")) {
          if (!quiet()) next.play("star", STAR_PITCH[Math.min(earnedIndex, STAR_PITCH.length - 1)])
          earnedIndex++
          drops.push(bounceLand(icon, -56))
        } else drops.push(fadeSlide(icon, { y: 8, duration: 300 }))
        await wait(320)
      }
      await Promise.all(drops)
      const firstTarget = levelUp ? 100 : Math.round(after.progress * 100)
      await Promise.all([
        summary.xpGained > 0 ? countUp(gain, 0, summary.xpGained, 1200, (n) => `+${Math.round(n)} XP`) : Promise.resolve(),
        countUp(total, before.xp, levelUp ? (before.next ?? after.xp) : after.xp, 1200, (n) => xpLine(before, n)),
        springTo(fill, "width", `${Math.round(before.progress * 100)}%`, `${firstTarget}%`),
      ])
      if (stale()) return
      if (levelUp) {
        if (!skipped) next.play("levelup")
        levelBadge.textContent = String(after.level)
        levelText.textContent = `Nível ${after.level}`
        const badgeBox = levelBadge.parentElement!.getBoundingClientRect()
        const cardBox = card.getBoundingClientRect()
        void burst(card, badgeBox.left - cardBox.left + badgeBox.width / 2, badgeBox.top - cardBox.top + badgeBox.height / 2)
        await springTo(fill, "width", "0%", `${Math.round(after.progress * 100)}%`)
        if (unlock) {
          unlock.classList.add("shown")
          if (!quiet() && item) next.play("unlock")
          await bloom(unlock)
        }
      }
      if (stale()) return
      for (const animation of card.getAnimations({ subtree: true })) animation.cancel()
      card.classList.remove("animating")
      unlock?.classList.add("shown")
      levelBadge.textContent = String(after.level)
      levelText.textContent = `Nível ${after.level}`
      if (summary.xpGained > 0) gain.textContent = `+${summary.xpGained} XP`
      fill.style.width = `${Math.round(after.progress * 100)}%`
      total.textContent = xpLine(after, after.xp)
      animating = false
      requestSkip(false)
      window.removeEventListener("keydown", onKey)
      card.querySelector<HTMLButtonElement>(".btn-primary, .btn-secondary")?.focus({ preventScroll: true })
    },
    hide() {
      el.hidden = true
      seq++
      if (animating) {
        animating = false
        requestSkip(false)
        window.removeEventListener("keydown", onKey)
      }
    },
  }
}

export type TourStep = { target: string; title: string; text: string }

export const TOUR_STEPS: TourStep[] = [
  { target: ".phase-brief", title: "Painel da fase", text: "Aqui fica o que a fase pede, as estrelas que dá pra ganhar e a tabela que o circuito tem que cumprir. A dica mora aqui também." },
  { target: ".tray-host", title: "Suas peças", text: "Clique numa peça pra pegar e depois clique no esquema ou na protoboard pra colocar. O número mostra quantas sobram." },
  { target: ".toolbar-host", title: "Ferramentas", text: "Selecionar, puxar fio e ver a corrente andando. O multímetro aparece aqui quando você liberar." },
  { target: ".view-toggle", title: "Blueprint e bancada", text: "No blueprint você desenha o esquema, na bancada monta de verdade. A tecla V troca entre os dois." },
  { target: ".topbar-host", title: "Nível e estrelas", text: "Cada estrela nova vale XP. Juntando XP você sobe de nível e libera coisas novas pra oficina." },
  { target: "[data-tool=undo], [data-tool=redo], [data-tool=rewind]", title: "Voltar atrás", text: "Desfazer, refazer e a linha do tempo, que leva a montagem de volta pra qualquer momento. Errar aqui sai barato." },
]

const PAD = 8
const GAP = 16

function boxOf(selector: string): Box | null {
  const rects = [...document.querySelectorAll<HTMLElement>(selector)]
    .filter((node) => !node.hidden && node.offsetParent !== null)
    .map((node) => node.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((r) => r.left)) - PAD
  const top = Math.min(...rects.map((r) => r.top)) - PAD
  const right = Math.max(...rects.map((r) => r.right)) + PAD
  const bottom = Math.max(...rects.map((r) => r.bottom)) + PAD
  return { x: left, y: top, w: right - left, h: bottom - top, r: 18 }
}

function placeBubble(bubble: HTMLElement, box: Box) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const bw = bubble.offsetWidth
  const bh = bubble.offsetHeight
  const clampX = (x: number) => Math.max(GAP, Math.min(vw - bw - GAP, x))
  const clampY = (y: number) => Math.max(GAP, Math.min(vh - bh - GAP, y))
  const options = [
    { fits: box.x + box.w + GAP + bw <= vw - GAP, x: box.x + box.w + GAP, y: clampY(box.y) },
    { fits: box.y + box.h + GAP + bh <= vh - GAP, x: clampX(box.x), y: box.y + box.h + GAP },
    { fits: box.y - GAP - bh >= GAP, x: clampX(box.x), y: box.y - GAP - bh },
    { fits: box.x - GAP - bw >= GAP, x: box.x - GAP - bw, y: clampY(box.y) },
  ]
  const pick = options.find((o) => o.fits) ?? { x: clampX(box.x + box.w / 2 - bw / 2), y: clampY(box.y + box.h / 2 - bh / 2) }
  bubble.style.left = `${pick.x}px`
  bubble.style.top = `${pick.y}px`
}

export function createTour(el: HTMLElement) {
  el.className = "tour"
  el.hidden = true
  el.setAttribute("role", "dialog")
  el.setAttribute("aria-modal", "true")
  el.innerHTML = `
    <div class="tour-hole" aria-hidden="true"></div>
    <div class="tour-bubble">
      <span class="tour-count"></span>
      <h2 class="tour-title"></h2>
      <p class="tour-text"></p>
      <div class="tour-actions">
        <button type="button" class="btn-secondary tour-skip" data-action="skip">Pular</button>
        <button type="button" class="btn-primary tour-next" data-action="next">Próximo</button>
      </div>
    </div>`
  const hole = el.querySelector<HTMLElement>(".tour-hole")!
  const bubble = el.querySelector<HTMLElement>(".tour-bubble")!
  const count = el.querySelector<HTMLElement>(".tour-count")!
  const title = el.querySelector<HTMLElement>(".tour-title")!
  const text = el.querySelector<HTMLElement>(".tour-text")!
  const next = el.querySelector<HTMLButtonElement>(".tour-next")!
  let steps: TourStep[] = []
  let index = -1
  let current: Box | null = null
  let done: (() => void) | null = null

  function show(i: number) {
    let target: Box | null = null
    while (i < steps.length && !(target = boxOf(steps[i].target))) i++
    if (!target) return stop()
    index = i
    const step = steps[i]
    const last = !steps.slice(i + 1).some((s) => boxOf(s.target))
    const shown = steps.filter((s) => boxOf(s.target)).length
    const position = steps.slice(0, i + 1).filter((s) => boxOf(s.target)).length
    count.textContent = `${position}/${shown}`
    title.textContent = step.title
    text.textContent = step.text
    next.textContent = last ? "Bora montar!" : "Próximo"
    el.setAttribute("aria-label", step.title)
    const from = current ?? { x: target.x + target.w / 2, y: target.y + target.h / 2, w: 0, h: 0, r: 999 }
    for (const a of hole.getAnimations()) a.cancel()
    Object.assign(hole.style, { left: `${target.x}px`, top: `${target.y}px`, width: `${target.w}px`, height: `${target.h}px`, borderRadius: `${target.r}px` })
    void spotlight(hole, from, target)
    current = target
    placeBubble(bubble, target)
    if (from.w === 0) void fadeSlide(bubble, { y: 10, duration: 400, delay: 200 })
    void softRise(text)
    next.focus({ preventScroll: true })
  }

  function stop() {
    if (el.hidden) return
    el.hidden = true
    window.removeEventListener("keydown", onKey, true)
    window.removeEventListener("resize", onResize)
    const callback = done
    done = null
    current = null
    callback?.()
  }

  function onKey(event: KeyboardEvent) {
    const onButton = event.target instanceof HTMLButtonElement && el.contains(event.target)
    if ((event.key === "Enter" || event.key === " ") && onButton) return
    // o tour engole o teclado pra nenhum atalho da bancada rodar por baixo
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === "Escape") stop()
    else if (event.key === "ArrowRight" || event.key === "Enter") show(index + 1)
    else if (event.key === "Tab") (document.activeElement === next ? el.querySelector<HTMLButtonElement>(".tour-skip")! : next).focus()
  }

  function onResize() {
    if (index < 0) return
    current = null
    for (const a of hole.getAnimations()) a.cancel()
    const target = boxOf(steps[index].target)
    if (!target) return
    Object.assign(hole.style, { left: `${target.x}px`, top: `${target.y}px`, width: `${target.w}px`, height: `${target.h}px`, borderRadius: `${target.r}px` })
    current = target
    placeBubble(bubble, target)
  }

  el.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action
    if (action === "skip") stop()
    else if (action === "next") show(index + 1)
  })

  return {
    start(list: TourStep[], onDone: () => void) {
      steps = list
      done = onDone
      current = null
      index = -1
      el.hidden = false
      window.addEventListener("keydown", onKey, true)
      window.addEventListener("resize", onResize)
      show(0)
    },
    stop,
    isOpen: () => !el.hidden,
  }
}
