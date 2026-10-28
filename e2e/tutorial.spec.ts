import { expect, test, type Page } from "@playwright/test"

type Box = { x: number; y: number; w: number; h: number; r: number }
type TestHook = { startPhase(id: string): void; screenBox(target: string): Box | null; update(doc: unknown, opts: { commit: boolean }): void; reference(id: string): unknown }

const PARTS = ["battery", "lamp", "switch", "push_button", "dc_motor", "buzzer", "resistor", "led", "diode", "chip_nand", "chip_nor", "chip_not", "chip_and", "chip_or", "chip_xor", "chip_xnor", "logic_switch", "logic_probe", "multimeter", "breadboard", "jumper_wire"]

const won = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { won: true, bestCost: null, stars: [0] }]))

const save = (wonIds: string[], phaseId: string) => ({
  version: 3,
  progress: won(wonIds),
  settings: { standard: "IEC", reducedMotion: true, sfxVolume: 0, musicVolume: 0, muted: true },
  draft: null,
  sessionLog: [],
  seenDatasheets: PARTS,
  xp: 0,
  cosmetics: { board: "default", wires: "default", mat: "default" },
  daily: { lastWonDate: null, streak: 0, wonDates: [] },
  tutorialSeen: true,
  seenGroups: [],
  conceptSeen: [phaseId],
  partsIntroduced: PARTS,
})

const G0 = ["g0p1", "g0p2", "g0p3", "g0p4", "g0p5"]
const G1 = ["g1p1", "g1p2", "g1p3", "g1p4", "g1p5", "g1p6"]

async function open(page: Page, wonIds: string[], phaseId: string) {
  await page.addInitScript(
    ([data]) => {
      if (!localStorage.getItem("fio-continuo:v1")) localStorage.setItem("fio-continuo:v1", JSON.stringify(data))
    },
    [save(wonIds, phaseId)],
  )
  await page.goto("/")
  await page.evaluate((id) => (window as unknown as { __fioTest: TestHook }).__fioTest.startPhase(id), phaseId)
  await expect(page.locator(".brief-step")).toBeVisible()
}

async function center(page: Page, target: string) {
  const box = await page.evaluate((t) => (window as unknown as { __fioTest: TestHook }).__fioTest.screenBox(t), target)
  expect(box, target).not.toBeNull()
  return { x: box!.x + box!.w / 2, y: box!.y + box!.h / 2 }
}

const clickTarget = async (page: Page, target: string) => {
  const at = await center(page, target)
  await page.mouse.click(at.x, at.y)
}

async function dragTarget(page: Page, from: string, to: string) {
  const a = await center(page, from)
  const b = await center(page, to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 12 })
  await page.mouse.up()
}

async function clickCanvas(page: Page, fx: number, fy: number) {
  const rect = (await page.locator(".layer-bench canvas").boundingBox())!
  await page.mouse.click(rect.x + rect.width * fx, rect.y + rect.height * fy)
}

const counter = (page: Page, text: string) => expect(page.locator(".brief-step .mono")).toHaveText(text)

// o guia aparece e, quando está no holofote, o que fica embaixo dele ainda recebe o clique
async function expectGuideOpen(page: Page, text: string) {
  await expect(page.locator(".step-guide")).toBeVisible()
  await expect(page.locator(".step-guide-text")).toHaveText(text)
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".step-guide")!).pointerEvents)).toBe("none")
  await expect
    .poll(() =>
      page.evaluate(() => {
        const guide = document.querySelector(".step-guide")!
        if (guide.classList.contains("is-bubble")) return "bubble"
        const r = document.querySelector(".step-guide-hole")!.getBoundingClientRect()
        const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return under && !under.closest(".step-guide") ? "spot" : "blocked"
      }),
    )
    .not.toBe("blocked")
}

const stepText = (page: Page) => page.locator(".brief-step").evaluate((el) => el.textContent!.replace(/^\d+\/\d+/, ""))

async function step(page: Page, n: number, total: number, hasTarget: boolean) {
  await counter(page, `${n}/${total}`)
  if (hasTarget) await expectGuideOpen(page, await stepText(page))
  else await expect(page.locator(".step-guide")).toBeHidden()
}

test("g0p4: plays every guided step and reaches the victory screen", async ({ page }) => {
  // o Chromium com GL por software fica lento quando os dois navegadores rodam juntos
  test.setTimeout(240_000)
  await open(page, ["g0p1", "g0p2", "g0p3"], "g0p4")

  await step(page, 1, 7, true)
  await page.keyboard.press("v")
  await counter(page, "2/7")
  await page.keyboard.press("v")

  await step(page, 2, 7, true)
  await page.locator(".tray-item[data-part=battery]").click()
  await counter(page, "3/7")
  await clickCanvas(page, 0.16, 0.5)
  await clickTarget(page, "hole:T+3")
  await expect(page.locator(".brief-step .mono")).toHaveText("4/7")
  await clickTarget(page, "hole:T-3")

  await step(page, 4, 7, true)
  await page.locator(".tray-item[data-part=lamp]").click()
  await clickCanvas(page, 0.16, 0.78)
  await clickTarget(page, "hole:A10")
  await counter(page, "5/7")
  await clickTarget(page, "hole:A14")

  await step(page, 5, 7, false)
  await page.keyboard.press("w")
  await clickTarget(page, "hole:T+10")
  await clickTarget(page, "hole:B10")
  await counter(page, "6/7")
  await page.keyboard.press("s")

  await step(page, 6, 7, true)
  await dragTarget(page, "hole:A14", "hole:A16")
  await counter(page, "7/7")

  await step(page, 7, 7, false)
  await page.keyboard.press("w")
  await clickTarget(page, "hole:T-16")
  await clickTarget(page, "hole:B16")

  await expect(page.locator(".complete-card")).toBeVisible()
})

test("g2p1: plays every guided step and reaches the victory screen", async ({ page }) => {
  // o Chromium com GL por software fica lento quando os dois navegadores rodam juntos
  test.setTimeout(240_000)
  await open(page, [...G0, ...G1], "g2p1")

  await step(page, 1, 4, true)
  await clickTarget(page, "meter:dial")
  await counter(page, "2/4")

  await step(page, 2, 4, true)
  // T+3 e T-3 já têm os cabos da bateria: a ponta cairia em cima e o arraste pegaria o cabo
  await clickTarget(page, "hole:T+5")
  await clickTarget(page, "hole:T-20")
  await counter(page, "3/4")

  await step(page, 3, 4, true)
  await dragTarget(page, "hole:T+5", "hole:T+8")

  await expect(page.locator(".complete-card")).toBeVisible()
})

test("g0p3: an occupied hole explains itself and the wire tool still lets the lamp leads move", async ({ page }) => {
  test.setTimeout(240_000)
  await open(page, ["g0p1", "g0p2"], "g0p3")
  await page.evaluate(() => {
    const hook = (window as unknown as { __fioTest: TestHook }).__fioTest
    const doc = structuredClone(hook.reference("g0p3")) as { bench: { placements: { id: string; holes: Record<string, string | null> }[] } }
    doc.bench.placements.find((p) => p.id === "L1")!.holes = { a: "A11", b: "A13" }
    hook.update(doc, { commit: true })
  })

  await page.keyboard.press("w")
  await clickTarget(page, "hole:C20")
  await clickTarget(page, "hole:A11")
  await expect(page.locator(".toast").filter({ hasText: "Esse furo já está ocupado" })).toBeVisible()

  await page.keyboard.press("Escape")
  await dragTarget(page, "hole:A11", "hole:A10")
  await dragTarget(page, "hole:A13", "hole:A14")
  await expect(page.locator(".complete-card")).toBeVisible()
})

