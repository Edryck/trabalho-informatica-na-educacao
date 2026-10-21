import { expect, test } from "@playwright/test"

test("boots, opens the first phase and switches views without console errors", async ({ page }) => {
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text())
  })
  page.on("pageerror", (e) => errors.push(String(e)))
  await page.goto("/")
  await page.getByRole("button", { name: "Nova partida" }).click()
  await expect(page.locator(".datasheet-card")).toBeVisible()
  await page.getByRole("button", { name: "Entendi" }).click()
  await page.getByRole("button", { name: "Entendi" }).click()
  await expect(page.locator(".tour")).toBeVisible()
  await page.getByRole("button", { name: "Pular" }).click()
  await expect(page.locator(".tour")).toBeHidden()
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
  await page.goto("/")
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
  while (await page.locator(".datasheet-card:not([hidden])").count()) await page.getByRole("button", { name: "Entendi" }).click()
  await expect(page.locator(".tour")).toBeVisible()
  await expect(page.locator(".tour-count")).toHaveText("1/6")
  await page.getByRole("button", { name: "Pular" }).click()
  await expect(page.locator(".tour")).toBeHidden()
  await page.reload()
  await page.getByRole("button", { name: "Nova partida" }).click()
  while (await page.locator(".datasheet-card:not([hidden])").count()) await page.getByRole("button", { name: "Entendi" }).click()
  await expect(page.locator(".phase-brief")).toContainText("Navegar na bancada")
  await expect(page.locator(".tour")).toBeHidden()
})

test("winning a phase shows stars and xp", async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => {
    const hook = (window as unknown as { __fioTest: TestHook }).__fioTest
    hook.startPhase("g1p1")
  })
  while (await page.locator(".datasheet-card:not([hidden])").count()) await page.getByRole("button", { name: "Entendi" }).click()
  await page.evaluate(() => {
    const hook = (window as unknown as { __fioTest: TestHook }).__fioTest
    hook.update(structuredClone(hook.reference("g1p1")), { commit: true })
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
