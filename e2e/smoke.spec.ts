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
  await expect(page.locator(".phase-map")).toBeVisible()
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
