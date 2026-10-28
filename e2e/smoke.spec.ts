import { expect, test } from "@playwright/test"

test("boots, opens the first phase and switches views without console errors", async ({ page }) => {
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text())
  })
  page.on("pageerror", (e) => errors.push(String(e)))
  await page.goto("/")
  await page.getByRole("button", { name: "Nova partida" }).click()
  await expect(page.locator(".tour")).toBeVisible()
  await page.getByRole("button", { name: "Pular" }).click()
  await expect(page.locator(".tour")).toBeHidden()
  await expect(page.locator(".part-card")).toBeVisible()
  await page.getByRole("button", { name: "Entendi" }).click()
  await page.getByRole("button", { name: "Entendi" }).click()
  await expect(page.locator(".part-card")).toBeHidden()
  await expect(page.locator(".phase-brief")).toContainText("Navegar na bancada")
  await expect(page.locator(".layer-bench canvas")).toBeVisible()
  await page.keyboard.press("v")
  await expect(page.locator("svg.blueprint").first()).toBeVisible()
  await page.getByRole("button", { name: "Fases" }).click()
  await expect(page.locator(".group-screen")).toBeVisible()
  expect(errors).toEqual([])
})

test("runs without storage and says so", async ({ browser, browserName }) => {
  const context = await browser.newContext()
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked")
      },
    })
  })
  const page = await context.newPage()
  await page.goto("/", { waitUntil: "domcontentloaded" })
  const blocked = await page.evaluate(() => {
    try {
      void window.localStorage
      return false
    } catch {
      return true
    }
  })
  // se o navegador não deixar simular o bloqueio, o teste unitário de createStore já cobre o caso
  test.skip(!blocked, `não deu pra bloquear o localStorage no ${browserName}`)
  await expect(page.getByText(/Não deu pra salvar/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Nova partida" })).toBeVisible()
  await context.close()
})

type TestHook = { startPhase(id: string): void; update(doc: unknown, opts: { commit: boolean }): void; reference(id: string): unknown }

test("new game shows the tour and it can be skipped", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Nova partida" }).click()
  await expect(page.locator(".tour")).toBeVisible()
  await expect(page.locator(".tour-count")).toHaveText("1/6")
  await page.getByRole("button", { name: "Pular" }).click()
  await expect(page.locator(".tour")).toBeHidden()
  await page.reload()
  await page.getByRole("button", { name: "Nova partida" }).click()
  while (await page.locator(".part-card:not([hidden])").count()) await page.getByRole("button", { name: "Entendi" }).click()
  await expect(page.locator(".phase-brief")).toContainText("Navegar na bancada")
  await expect(page.locator(".tour")).toBeHidden()
})

test("winning a phase shows stars and xp", async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => {
    const hook = (window as unknown as { __fioTest: TestHook }).__fioTest
    hook.startPhase("g3p1")
  })
  while (await page.locator(".part-card:not([hidden])").count()) await page.getByRole("button", { name: "Entendi" }).click()
  await page.evaluate(() => {
    const hook = (window as unknown as { __fioTest: TestHook }).__fioTest
    hook.update(structuredClone(hook.reference("g3p1")), { commit: true })
  })
  await expect(page.locator(".complete-card")).toBeVisible()
  await expect(page.locator(".complete-star")).toHaveCount(3)
  await page.keyboard.press("Escape")
  await expect(page.locator(".complete-xp-gain")).toHaveText(/\+\d+ XP/)
  await expect(page.getByRole("button", { name: "Próxima fase" })).toBeVisible()
})

test("workshop opens", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Oficina" }).click()
  await expect(page.getByRole("heading", { name: "Oficina" })).toBeVisible()
  await expect(page.locator(".ws-card")).toHaveCount(7)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Nova partida" })).toBeVisible()
})

test("datasheet opens from the sandbox tray and closes with Esc", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Sandbox" }).click()
  await page.locator('[aria-label="Como usar: Resistor"]').click()
  await expect(page.locator(".part-card")).toBeVisible()
  await page.locator(".part-card").getByRole("button", { name: "Datasheet" }).click()
  await expect(page.locator(".sheet-screen")).toBeVisible()
  await expect(page.locator(".sheet-spec")).toContainText("vermelho")
  await page.locator(".sheet-columns p").first().click()
  await page.keyboard.press("Escape")
  await expect(page.locator(".sheet-screen")).toBeHidden()
  await page.locator(".part-card").getByRole("button", { name: "Entendi" }).click()
  await page.getByRole("button", { name: "Datasheets" }).click()
  await expect(page.locator(".sheet-list-item")).toHaveCount(19)
})

const seeded = (progress: Record<string, { won: boolean; bestCost: number | null; stars: number[] }>) => ({
  version: 3,
  progress,
  settings: { standard: "IEC", reducedMotion: true, volume: 0 },
  draft: null,
  sessionLog: [],
  seenDatasheets: ["battery", "lamp", "resistor", "switch"],
  xp: 0,
  cosmetics: { board: "default", wires: "default", mat: "default" },
  daily: { lastWonDate: null, streak: 0, wonDates: [] },
  tutorialSeen: true,
  seenGroups: [],
})
const g0Done = Object.fromEntries(["g0p1", "g0p2", "g0p3", "g0p4", "g0p5"].map((id) => [id, { won: true, bestCost: null, stars: [0] }]))

test("map shows groups and opens a group", async ({ page }) => {
  await page.addInitScript((save) => {
    if (!localStorage.getItem("fio-continuo:v1")) localStorage.setItem("fio-continuo:v1", JSON.stringify(save))
  }, seeded(g0Done))
  await page.goto("/")
  await page.getByRole("button", { name: "Continuar" }).click()
  for (let i = 0; i < 4; i++) await page.keyboard.press("Escape")
  await page.locator(".topbar-map").click()
  await expect(page.locator(".group-card")).toHaveCount(9)
  await expect(page.locator(".group-card.soon")).toHaveCount(4)
  await page.locator('[data-group="g1"]').click()
  await expect(page.locator(".group-screen .map-step")).toHaveCount(6)
  await page.keyboard.press("Escape")
  await expect(page.locator(".group-card")).toHaveCount(9)
  await expect(page.locator(".group-screen")).toBeHidden()
})

test("sandbox has every part without limit", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Sandbox" }).click()
  const counts = page.locator(".tray-count")
  await expect(counts.first()).toHaveText("∞")
  for (const text of await counts.allInnerTexts()) expect(text).toBe("∞")
  await expect(page.getByRole("button", { name: /ultímetro/ }).first()).toBeVisible()
})

test("escape closes the datasheet before the group", async ({ page }) => {
  await page.addInitScript((save) => {
    if (!localStorage.getItem("fio-continuo:v1")) localStorage.setItem("fio-continuo:v1", JSON.stringify(save))
  }, seeded(g0Done))
  await page.goto("/")
  await page.getByRole("button", { name: "Continuar" }).click()
  for (let i = 0; i < 4; i++) await page.keyboard.press("Escape")
  await page.locator(".topbar-map").click()
  await page.locator('[data-group="g1"]').click()
  await page.locator(".group-screen").getByRole("button", { name: "Datasheets" }).click()
  await expect(page.locator(".sheet-screen")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator(".sheet-screen")).toBeHidden()
  await expect(page.locator(".group-screen")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator(".group-screen")).toBeHidden()
  await expect(page.locator(".group-card")).toHaveCount(9)
})
