import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "@playwright/test"

const BASE = process.env.SHOTS_URL ?? "http://localhost:5199/"
const OUT = "test-results/models"

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] })
const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
await page.goto(BASE)

const shots = await page.evaluate(async () => {
  // o three que o parts3d usa vem do pré-bundle do vite; importar outro daria duas cópias
  const source = await (await fetch("/src/parts3d.ts")).text()
  const threeUrl = /from\s+"(\/node_modules\/\.vite\/deps\/three\.js[^"]*)"/.exec(source)?.[1]
  if (!threeUrl) throw new Error("não achei o import do three no parts3d transformado")
  const THREE = await import(threeUrl)
  const P = await import("/src/parts3d.ts")

  const models = {
    multimeter: () => {
      const m = P.makeMultimeter()
      P.setMultimeterState(m, "V", "9,00 V")
      return m
    },
    "lamp-desk": () => P.makeDecor("lamp-desk"),
    shelf: () => P.makeDecor("shelf"),
    poster: () => P.makeDecor("poster"),
    trophy: () => P.makeDecor("trophy"),
    tools: () => P.makeDecor("tools"),
    battery: () => P.makeBattery(P.PART_COLORS.green, "9V"),
    lamp: () => {
      const g = new THREE.Group()
      g.add(P.makeLampBody(), P.makeBulb())
      return g
    },
    switch: () => P.makeSwitch(true, 8),
    button: () => P.makeButton(P.PART_COLORS.coral, false),
    chip: () => P.makeChip("7408", 20, 8, -1),
    motor: () => P.makeMotor(),
    buzzer: () => P.makeBuzzer(),
    led: () => P.makeLedHead(P.LED_COLORS.red, 0.6),
    diode: () => P.makeDiodeBody(10),
    resistor: () => P.makeResistorBody(P.resistorBands(220), 10),
  }

  const canvas = document.createElement("canvas")
  canvas.width = 640
  canvas.height = 480
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setSize(640, 480, false)
  const out = []
  for (const [name, build] of Object.entries(models)) {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xe8e4dc)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 2)
    sun.position.set(30, 60, 40)
    scene.add(sun)
    const model = build()
    scene.add(model)
    const box = new THREE.Box3().setFromObject(model)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3()).length()
    const camera = new THREE.PerspectiveCamera(35, 640 / 480, 0.1, 5000)
    const views = { front: new THREE.Vector3(0, 0.35, 1), side: new THREE.Vector3(1, 0.35, 0), top: new THREE.Vector3(0.01, 1, 0.01) }
    for (const [view, dir] of Object.entries(views)) {
      camera.position.copy(center).add(dir.normalize().multiplyScalar(size * 1.6))
      camera.lookAt(center)
      renderer.render(scene, camera)
      out.push({ file: `${name}-${view}.png`, data: canvas.toDataURL("image/png") })
    }
  }
  return out
})

for (const s of shots) writeFileSync(`${OUT}/${s.file}`, Buffer.from(s.data.split(",")[1], "base64"))

// bancada de verdade em g2p1, pra ver o aparelho na câmera padrão nos dois formatos de tela
for (const [label, viewport] of [["4x3", { width: 1024, height: 768 }], ["16x9", { width: 1280, height: 720 }]]) {
  const bench = await browser.newPage({ viewport })
  bench.on("pageerror", (e) => errors.push(String(e)))
  await bench.goto(BASE)
  await bench.waitForFunction(() => "__fio" in window)
  for (const [state, meter] of [["off", { mode: "off", red: "A5", black: "A12" }], ["on", { mode: "V", red: "A5", black: "A12" }]]) {
    await bench.evaluate((m) => {
      const fio = window.__fio
      fio.startPhase("g2p1")
      document.querySelectorAll(".tour, .work-order, .datasheet-card").forEach((el) => el.remove())
      document.body.classList.remove("overlay")
      const doc = structuredClone(fio.getView().doc)
      doc.bench.meter = m
      fio.update(doc, { commit: false })
    }, meter)
    await bench.waitForTimeout(800)
    await bench.locator(".layer-bench canvas").screenshot({ path: `${OUT}/bench-${label}-${state}.png` })
  }
  await bench.close()
}

await browser.close()
console.log(`${shots.length} imagens em ${OUT}`)
if (errors.length) console.log("erros na página:", errors.join("\n"))
