import { describe, expect, it } from "vitest"
import { Box3, PerspectiveCamera, Vector3 } from "three"
import { boardHoleBox, DEFAULT_CAMERA, meterSlotBox, nextMeterMode, PITCH, probeRest } from "../src/bench"

function corners(b: Box3): Vector3[] {
  const out: Vector3[] = []
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new Vector3(x, y, z))
  return out
}

describe("bench multimeter placement", () => {
  it("sits outside the hole area", () => {
    expect(meterSlotBox().intersectsBox(boardHoleBox())).toBe(false)
  })
  it("does not overlap the breadboard body", () => {
    const board = new Box3(new Vector3(-16.5 * PITCH, -10, -10 * PITCH), new Vector3(16.5 * PITCH, 10, 10 * PITCH))
    expect(meterSlotBox().intersectsBox(board)).toBe(false)
  })
  it.each([4 / 3, 16 / 9])("all 8 corners are inside the default camera view at aspect %d", (aspect) => {
    const cam = new PerspectiveCamera(DEFAULT_CAMERA.fov, aspect, 1, 3000)
    cam.position.fromArray(DEFAULT_CAMERA.position)
    cam.lookAt(new Vector3().fromArray(DEFAULT_CAMERA.target))
    cam.updateMatrixWorld()
    for (const c of corners(meterSlotBox())) {
      const p = c.project(cam)
      expect(Math.abs(p.x)).toBeLessThan(1)
      expect(Math.abs(p.y)).toBeLessThan(1)
      expect(Math.abs(p.z)).toBeLessThan(1)
      // painel da fase cobre o terço direito da bancada; o aparelho tem que ficar à esquerda dele
      expect(p.x).toBeLessThan(0.25)
    }
  })
  it("probes rest on the holder when off, even with a saved hole", () => {
    expect(probeRest(false, "A5")).toBe("holder")
    expect(probeRest(true, null)).toBe("holder")
    expect(probeRest(true, "A5")).toBe("hole")
  })
})

describe("multimeter dial", () => {
  it("cycles the dial", () => {
    expect(nextMeterMode("off")).toBe("V")
    expect(nextMeterMode("V")).toBe("A")
    expect(nextMeterMode("A")).toBe("ohm")
    expect(nextMeterMode("ohm")).toBe("off")
  })
})
