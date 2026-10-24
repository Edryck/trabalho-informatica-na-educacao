import type { GroupSummary, LevelInfo, RewardItem } from "./game"
import type { PhaseType } from "./phases"
import type { Datasheet } from "./ui"
import type { Cosmetics } from "./state"
import type { SfxName } from "./audio"
import { bloom, CHECK_ICON, CROSS_ICON, createPlayerBadge, LOCK_ICON, LOCK_SMALL, PHASE_TAGS, phaseLabel, pop, stagger, type BadgeData, bounceLand, burst, countUp, fadeSlide, motionReduced, requestSkip, skipRequestedNow, softRise, spotlight, springTo, starIcon, type Box } from "./ui"

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
  thanks: { from: string; text: string } | null
  discovery: string | null
}

export type CompleteHandlers = {
  onNext: (() => void) | null
  onCheaper(): void
  onBest: (() => void) | null
  onRetry(): void
  onMap(): void
  onNotebook: (() => void) | null
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
    if (action === "best") handlers.onBest?.()
    if (action === "retry") handlers.onRetry()
    if (action === "map") handlers.onMap()
    if (action === "notebook") handlers.onNotebook?.()
  })
  return {
    async show(summary: CompleteSummary, next: CompleteHandlers, instant = false): Promise<void> {
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
          ${summary.thanks ? `<blockquote class="complete-thanks"><p>${summary.thanks.text}</p><cite>${summary.thanks.from}</cite></blockquote>` : ""}
          ${summary.discovery ? `<section class="complete-discovery" aria-label="Anotado no caderno"><h3>Anotado no caderno</h3><p>${summary.discovery}</p></section>` : ""}
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
            ${cheaper && next.onBest ? '<button type="button" class="btn-secondary" data-action="best">Ver solução de menor custo</button>' : ""}
            ${summary.discovery && next.onNotebook ? '<button type="button" class="btn-secondary" data-action="notebook">Caderno</button>' : ""}
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
      skipped = instant
      // voltando da solução de menor custo: mostra o estado final sem refazer a festa
      if (instant) requestSkip(true)
      window.addEventListener("keydown", onKey)
      card.focus({ preventScroll: true })
      if (!skipped) next.play("win")
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

export type WorkshopState = { badge: BadgeData; level: LevelInfo; levels: number[]; items: RewardItem[]; equipped: Cosmetics }
export type WorkshopHandlers = { onEquip(item: RewardItem): void; onBack(): void }

const SLOTS: { kind: "board" | "wires" | "mat"; title: string; fallback: { name: string; swatch: string } }[] = [
  { kind: "board", title: "Protoboard", fallback: { name: "Branca", swatch: "#FBFBF8" } },
  { kind: "wires", title: "Fios", fallback: { name: "Clássicos", swatch: "#3D8BD9,#C62828,#202020" } },
  { kind: "mat", title: "Tapete", fallback: { name: "Sem tapete", swatch: "" } },
]

const KIND_WORDS: Record<RewardItem["kind"], string> = { board: "protoboard", wires: "fios", mat: "tapete", decor: "decoração" }

function swatchHtml(value: string): string {
  if (!value) return '<span class="ws-swatch ws-swatch-empty" aria-hidden="true"></span>'
  const colors = value.split(",")
  const fill = colors.length === 1 ? colors[0] : `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(", ")})`
  return `<span class="ws-swatch" style="background:${fill}" aria-hidden="true"></span>`
}

export function createWorkshopScreen(el: HTMLElement, handlers: WorkshopHandlers) {
  el.className = "workshop-screen"
  el.hidden = true
  let state: WorkshopState | null = null
  let popId: string | null = null
  el.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")
    if (!target || !state) return
    if (target.dataset.action === "back") return handlers.onBack()
    if (target.dataset.action !== "equip") return
    const kind = target.dataset.kind as RewardItem["kind"]
    const id = target.dataset.id!
    const item = id === "default" ? { level: 1, id, kind, name: "" } : state.items.find((i) => i.id === id)
    if (!item) return
    popId = `${kind}:${id}`
    handlers.onEquip(item)
  })

  function render(entering: boolean) {
    if (!state) return
    const s = state
    const unlocked = (item: RewardItem) => item.level <= s.level.level
    const next = s.items.filter((i) => !unlocked(i)).sort((a, b) => a.level - b.level)[0]
    const nextXp = next ? (s.levels[next.level - 1] ?? 0) : 0
    const slots = SLOTS.map((slot) => {
      const options = [{ level: 1, id: "default", kind: slot.kind, name: slot.fallback.name, value: slot.fallback.swatch } as RewardItem, ...s.items.filter((i) => i.kind === slot.kind)]
      const cards = options
        .map((item) => {
          const open = unlocked(item)
          const on = s.equipped[slot.kind] === item.id
          const status = on ? `${CHECK_ICON} Equipado` : open ? "Equipar" : `${LOCK_SMALL} Nível ${item.level}`
          return `<button type="button" class="ws-card ${on ? "on" : ""}" data-action="equip" data-kind="${slot.kind}" data-id="${item.id}" aria-pressed="${on}" ${open ? "" : "disabled"}>${swatchHtml(item.value ?? "")}<span class="ws-name">${item.name}</span><span class="ws-status">${status}</span></button>`
        })
        .join("")
      return `<section class="ws-section"><h3>${slot.title}</h3><div class="ws-cards">${cards}</div></section>`
    }).join("")
    const decor = s.items
      .filter((i) => i.kind === "decor")
      .map((i) => `<li class="${unlocked(i) ? "on" : ""}"><span>${i.name}</span><span class="ws-status">${unlocked(i) ? `${CHECK_ICON} Na bancada` : `${LOCK_SMALL} Nível ${i.level}`}</span></li>`)
      .join("")
    el.innerHTML = `
      <div class="workshop-panel">
        <header class="ws-head"><h2>Oficina</h2><button type="button" class="btn-secondary" data-action="back">Voltar</button></header>
        <div class="ws-badge"></div>
        <div class="ws-next">${
          next
            ? `<span class="ws-next-label">Próximo prêmio</span><strong>${next.name}</strong><span>${KIND_WORDS[next.kind]} · nível ${next.level} · faltam ${Math.max(0, nextXp - s.level.xp)} XP</span>`
            : `<span class="ws-next-label">Próximo prêmio</span><strong>Você liberou tudo</strong><span>A oficina está completa.</span>`
        }</div>
        ${slots}
        <section class="ws-section"><h3>Decoração</h3><ul class="ws-decor">${decor}</ul></section>
      </div>`
    void createPlayerBadge(el.querySelector<HTMLElement>(".ws-badge")!).render(s.badge)
    if (entering) void stagger([...el.querySelectorAll<HTMLElement>(".workshop-panel > *")], (block, delay) => fadeSlide(block, { delay, duration: 600 }), 50)
    if (popId) {
      const [kind, id] = popId.split(":")
      const card = el.querySelector<HTMLElement>(`.ws-card[data-kind="${kind}"][data-id="${id}"]`)
      popId = null
      if (card) {
        card.focus({ preventScroll: true })
        void pop(card)
      }
    } else el.querySelector<HTMLButtonElement>("[data-action=back]")?.focus({ preventScroll: true })
  }

  return {
    show(next: WorkshopState) {
      const entering = el.hidden
      state = next
      el.hidden = false
      render(entering)
    },
    hide() {
      el.hidden = true
    },
  }
}


export type MapHandlers = { onGroup(id: string): void; onHome(): void; onSettings(): void; onDatasheets?(): void; onUnlockSeen(id: string): void }

const BLOCKS: { id: GroupSummary["block"]; title: string }[] = [
  { id: "eletrica", title: "Elétrica" },
  { id: "eletronica", title: "Eletrônica" },
]

const STATE_TEXT: Record<GroupSummary["state"], string> = { locked: "bloqueado", available: "disponível", complete: "concluído", soon: "em breve" }

function groupAria(g: GroupSummary): string {
  const unlock = g.state === "locked" && g.requiresTitle ? `, conclua ${g.requiresTitle} pra liberar` : ""
  const progress = g.state === "soon" ? "" : `, ${g.stars} de ${g.maxStars} estrelas, ${g.done} de ${g.total} fases`
  return `${g.title}, ${STATE_TEXT[g.state]}${unlock}${progress}`
}

function groupCard(g: GroupSummary, index: number, justUnlocked: boolean): string {
  const open = g.state === "available" || g.state === "complete"
  const mark = g.state === "complete" ? CHECK_ICON : g.state === "available" ? String(index) : LOCK_ICON
  const foot =
    g.state === "soon"
      ? `<span class="group-foot">${LOCK_ICON} Em breve</span>`
      : g.state === "locked"
        ? `<span class="group-foot">${g.requiresTitle ? `Conclua ${g.requiresTitle} pra liberar` : "Bloqueado"}</span>`
        : `<span class="group-foot">${g.done}/${g.total} fases<span class="group-stars">${starIcon("met", 14)}${g.stars}/${g.maxStars}</span></span>`
  return `<li><button type="button" class="group-card ${g.state} ${justUnlocked ? "just-unlocked" : ""}" data-group="${g.id}" data-open="${open}" ${open ? "" : 'aria-disabled="true"'} aria-label="${groupAria(g)}"><span class="group-mark">${mark}</span><span class="group-title">${g.title}</span><span class="group-concept">${g.concept}</span>${foot}</button></li>`
}

export function createMapScreen(el: HTMLElement, handlers: MapHandlers) {
  el.className = "phase-map"
  el.hidden = true
  let backAction: { label: string; run(): void } | null = null
  el.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action
    if (action === "back") return backAction?.run()
    if (action === "home") return handlers.onHome()
    if (action === "settings") return handlers.onSettings()
    if (action === "datasheets") return handlers.onDatasheets?.()
    const card = target.closest<HTMLButtonElement>("[data-group]")
    if (card && card.dataset.open === "true") handlers.onGroup(card.dataset.group!)
  })
  return {
    show(groups: GroupSummary[], justUnlocked: string[], badge: BadgeData, back: { label: string; run(): void } | null = null) {
      backAction = back
      el.hidden = false
      const bands = BLOCKS.map((block) => {
        const cards = groups
          .map((g, i) => ({ g, i }))
          .filter(({ g }) => g.block === block.id)
          .map(({ g, i }) => groupCard(g, i + 1, justUnlocked.includes(g.id)))
          .join("")
        return `<section class="map-block" aria-labelledby="block-${block.id}"><h3 id="block-${block.id}" class="map-block-title">${block.title}</h3><ol class="group-grid">${cards}</ol></section>`
      }).join("")
      el.innerHTML = `
        <header class="map-head">
          <h2 class="map-title">Mapa de fases</h2>
          <div class="map-badge"></div>
          <div class="map-nav">
            ${handlers.onDatasheets ? '<button type="button" class="btn-secondary" data-action="datasheets">Datasheets</button>' : ""}
            <button type="button" class="btn-secondary" data-action="home">Início</button>
            <button type="button" class="btn-secondary" data-action="settings">Configurações</button>
            ${back ? `<button type="button" class="btn-primary" data-action="back">${back.label}</button>` : ""}
          </div>
        </header>
        ${bands}`
      void createPlayerBadge(el.querySelector<HTMLElement>(".map-badge")!).render(badge)
      void stagger([...el.querySelectorAll<HTMLElement>(".group-card")], (node, delay) => fadeSlide(node, { delay, y: 12, duration: 600 }), 40)
      for (const id of justUnlocked) {
        const card = el.querySelector<HTMLElement>(`[data-group="${id}"]`)
        if (card) void bloom(card)
        handlers.onUnlockSeen(id)
      }
    },
    hide() {
      el.hidden = true
    },
  }
}

export type GroupPhaseRow = { id: string; goal: string; type: PhaseType; stars: number; maxStars: number; won: boolean; available: boolean; cost: number | null }
export type GroupHandlers = { onPhase(id: string): void; onBack(): void; onDatasheets?(): void }

export function createGroupScreen(el: HTMLElement, handlers: GroupHandlers) {
  el.className = "phase-map group-screen"
  el.hidden = true
  el.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    if (target.closest("[data-action=back]")) return handlers.onBack()
    if (target.closest("[data-action=datasheets]")) return handlers.onDatasheets?.()
    const node = target.closest<HTMLButtonElement>("[data-phase]")
    if (node && !node.disabled) handlers.onPhase(node.dataset.phase!)
  })
  return {
    show(summary: GroupSummary, phases: GroupPhaseRow[], badge: BadgeData) {
      el.hidden = false
      const nodes = phases
        .map((p, i) => {
          const state = p.won ? "won" : p.available ? "available" : "locked"
          const status = p.won ? `concluída, ${p.stars} de ${p.maxStars} estrelas` : p.available ? "disponível" : "bloqueada"
          const stars = Array.from({ length: p.maxStars }, (_, k) => starIcon(k < p.stars ? "met" : "unmet", 14)).join("")
          const inner = state === "locked" ? LOCK_ICON : `<span class="map-node-number">${i + 1}</span>`
          const cost = p.won && p.cost !== null ? ` · ${p.cost} créditos` : ""
          return `<li class="map-step ${state}"><button type="button" class="map-node" data-phase="${p.id}" ${p.available || p.won ? "" : "disabled"} aria-label="Fase ${i + 1}: ${p.goal}, ${PHASE_TAGS[p.type] ?? p.type}, ${status}"><span class="map-circle">${inner}</span><span class="map-text"><span class="map-goal">${p.goal}</span><span class="map-meta">${PHASE_TAGS[p.type] ?? p.type}${cost}</span><span class="map-stars">${stars}</span></span></button></li>`
        })
        .join("")
      el.innerHTML = `
        <header class="map-head">
          <div class="group-head">
            <button type="button" class="btn-secondary" data-action="back">Mapa</button>
            <h2 class="map-title">${summary.title}</h2>
          </div>
          <div class="map-badge"></div>
          ${handlers.onDatasheets ? '<button type="button" class="btn-secondary group-sheets" data-action="datasheets">Datasheets</button>' : ""}
        </header>
        <section class="group-body">
          <p class="group-intro">${summary.concept}</p>
          <p class="map-progress">${starIcon("met", 14)} ${summary.stars}/${summary.maxStars} · ${summary.done}/${summary.total} fases</p>
          ${nodes ? `<ol class="map-path group-path">${nodes}</ol>` : `<p class="group-empty">As fases deste grupo ainda estão sendo montadas.</p>`}
        </section>`
      void createPlayerBadge(el.querySelector<HTMLElement>(".map-badge")!).render(badge)
      void stagger([...el.querySelectorAll<HTMLElement>(".map-step")], (node, delay) => fadeSlide(node, { delay, y: 12, duration: 600 }), 40)
      ;(el.querySelector<HTMLElement>(".map-step.available .map-node") ?? el.querySelector<HTMLElement>(".map-node:not(:disabled)"))?.focus({ preventScroll: true })
    },
    hide() {
      el.hidden = true
    },
  }
}

export type SheetState = {
  type: string
  sheet: Datasheet
  rows: [string, string][]
  sketch: string
  symbol: string
  application: string
  list: { type: string; title: string }[] | null
}

const SKETCH_FILTER =
  '<svg class="sketch-defs" width="0" height="0" aria-hidden="true"><filter id="sketch"><feTurbulence type="fractalNoise" seed="7" baseFrequency="0.04" numOctaves="2" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6"/></filter></svg>'

export function createDatasheetScreen(el: HTMLElement, handlers: { onClose(): void; onPick(type: string): void }) {
  el.className = "sheet-screen"
  el.hidden = true
  el.setAttribute("role", "dialog")
  el.setAttribute("aria-modal", "true")
  let open = false
  let types: string[] = []
  let current = ""
  let opener: HTMLElement | null = null
  const close = () => {
    if (!open) return
    open = false
    el.hidden = true
    handlers.onClose()
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    opener = null
  }
  el.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    if (target.closest("[data-action=close]")) return close()
    const item = target.closest<HTMLElement>("[data-sheet-type]")
    if (item) handlers.onPick(item.dataset.sheetType!)
  })
  el.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      return close()
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && types.length > 1) {
      event.preventDefault()
      const index = types.indexOf(current)
      const next = types[(index + (event.key === "ArrowDown" ? 1 : types.length - 1)) % types.length]
      handlers.onPick(next)
    }
  })
  return {
    isOpen: () => open,
    close,
    show(state: SheetState) {
      if (!open) opener = document.activeElement instanceof HTMLElement && !el.contains(document.activeElement) ? document.activeElement : null
      open = true
      current = state.type
      types = state.list?.map((i) => i.type) ?? []
      el.hidden = false
      el.setAttribute("aria-label", `Datasheet: ${state.sheet.title}`)
      const list = state.list
        ? `<nav class="sheet-list" aria-label="Peças"><ul>${state.list.map((i) => `<li><button type="button" class="sheet-list-item ${i.type === state.type ? "active" : ""}" data-sheet-type="${i.type}" ${i.type === state.type ? 'aria-current="true"' : ""}>${i.title}</button></li>`).join("")}</ul></nav>`
        : ""
      el.innerHTML = `
        ${SKETCH_FILTER}
        <div class="sheet-panel ${state.list ? "with-list" : ""}">
          <header class="sheet-screen-head">
            <div><h2>${state.sheet.title}</h2><p class="sheet-category">${state.sheet.category}</p></div>
            <button type="button" class="sheet-close" data-action="close" aria-label="Fechar datasheet">${CROSS_ICON}</button>
          </header>
          ${list}
          <div class="sheet-columns">
            <div class="sheet-left">
              <section><h3>Desenho</h3><div class="sheet-drawing">${state.sketch}</div></section>
              <section><h3>Símbolo elétrico</h3><div class="sheet-symbol-box" aria-hidden="true">${state.symbol}</div></section>
            </div>
            <div class="sheet-right">
              <section><h3>Descrição</h3><p>${state.sheet.description}</p></section>
              <section><h3>Características principais</h3><ul class="sheet-features">${state.sheet.features.map((f) => `<li>${f}</li>`).join("")}</ul></section>
              <section><h3>Especificações técnicas</h3><dl class="sheet-spec">${state.rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></section>
              <section><h3>Aplicação típica</h3><div class="sheet-application">${state.application}</div><p>${state.sheet.application.text}</p></section>
              <section><h3>Observações</h3><p><strong>Na protoboard.</strong> ${state.sheet.breadboard}</p><p><strong>Erro comum.</strong> ${state.sheet.mistake}</p></section>
            </div>
          </div>
        </div>`
      el.scrollTop = 0
      const active = el.querySelector<HTMLElement>(".sheet-list-item.active")
      ;(active ?? el.querySelector<HTMLElement>(".sheet-close"))?.focus({ preventScroll: true })
    },
    hide() {
      open = false
      el.hidden = true
    },
  }
}
