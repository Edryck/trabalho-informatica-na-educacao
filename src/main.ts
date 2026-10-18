import "@fontsource/ibm-plex-sans/400.css"
import "@fontsource/ibm-plex-sans/500.css"
import "@fontsource/ibm-plex-sans/600.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "./style.css"
import { PerspectiveCamera, Scene, WebGLRenderer } from "three"

const app = document.getElementById("app")
if (!app) throw new Error("missing #app")

const renderer = new WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0x0e141b)
app.appendChild(renderer.domElement)

const scene = new Scene()
const camera = new PerspectiveCamera(45, 1, 0.1, 2000)
camera.position.set(0, 120, 160)
camera.lookAt(0, 0, 0)

function resize() {
  const { clientWidth, clientHeight } = app!
  renderer.setSize(clientWidth, clientHeight, false)
  camera.aspect = clientWidth / Math.max(clientHeight, 1)
  camera.updateProjectionMatrix()
}

window.addEventListener("resize", resize)
resize()

renderer.setAnimationLoop(() => renderer.render(scene, camera))
