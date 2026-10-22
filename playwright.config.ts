import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  reporter: "list",
  use: { baseURL: "http://localhost:4173", viewport: { width: 1280, height: 760 } },
  webServer: { command: "npx vite preview --port 4173 --strictPort", port: 4173, reuseExistingServer: false },
  projects: [
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 760 } } },
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 760 } } },
  ],
})
