import { describe, expect, it } from "vitest"
import { Box3, Mesh, Vector3, type CylinderGeometry, type Object3D } from "three"
import { makeDecor, makeMultimeter, METER_DIAL_ANGLE, setMultimeterState } from "../src/parts3d"

function worldBox(root: Object3D, name: string): Box3 {
  root.updateMatrixWorld(true)
  return new Box3().setFromObject(root.getObjectByName(name)!)
}
function armEnds(root: Object3D, name: string): [Vector3, Vector3] {
  root.updateMatrixWorld(true)
  const arm = root.getObjectByName(name) as Mesh
  const h = (arm.geometry as CylinderGeometry).parameters.height / 2
  return [new Vector3(0, -h, 0).applyMatrix4(arm.matrixWorld), new Vector3(0, h, 0).applyMatrix4(arm.matrixWorld)]
}
function center(root: Object3D, name: string): Vector3 {
  return worldBox(root, name).getCenter(new Vector3())
}

describe("desk lamp", () => {
  const lamp = makeDecor("lamp-desk")
  it("each arm runs from joint center to joint center", () => {
    const [a0, a1] = armEnds(lamp, "arm1")
    const [b0, b1] = armEnds(lamp, "arm2")
    expect(a0.distanceTo(center(lamp, "joint0"))).toBeLessThan(0.5)
    expect(a1.distanceTo(center(lamp, "joint1"))).toBeLessThan(0.5)
    expect(b0.distanceTo(center(lamp, "joint1"))).toBeLessThan(0.5)
    expect(b1.distanceTo(center(lamp, "joint2"))).toBeLessThan(0.5)
  })
  it("lower joint sits on the base center", () => {
    const base = center(lamp, "base")
    const j0 = center(lamp, "joint0")
    expect(Math.hypot(j0.x - base.x, j0.z - base.z)).toBeLessThan(0.5)
  })
  it("shade hangs from the last joint and holds the bulb", () => {
    expect(worldBox(lamp, "shade").expandByScalar(0.5).containsPoint(center(lamp, "joint2"))).toBe(true)
    expect(worldBox(lamp, "shade").containsBox(worldBox(lamp, "bulb"))).toBe(true)
  })
})

describe("poster", () => {
  it("easel legs stay behind the face", () => {
    const poster = makeDecor("poster")
    const face = worldBox(poster, "face")
    for (const leg of ["leg0", "leg1", "leg2"]) expect(worldBox(poster, leg).max.z).toBeLessThanOrEqual(face.min.z + 0.01)
  })
})

describe("trophy", () => {
  it("left handle mirrors the right one", () => {
    const trophy = makeDecor("trophy")
    const l = worldBox(trophy, "handleL")
    const r = worldBox(trophy, "handleR")
    expect(l.min.x).toBeCloseTo(-r.max.x, 1)
    expect(l.max.x).toBeCloseTo(-r.min.x, 1)
    expect(l.min.y).toBeCloseTo(r.min.y, 1)
    expect(l.max.y).toBeCloseTo(r.max.y, 1)
  })
})

describe("pliers", () => {
  it("pin joins both halves", () => {
    const tools = makeDecor("tools")
    const pin = worldBox(tools, "pliersPin")
    expect(pin.intersectsBox(worldBox(tools, "pliersA"))).toBe(true)
    expect(pin.intersectsBox(worldBox(tools, "pliersB"))).toBe(true)
  })
})

describe("multimeter", () => {
  it("has named body, screen, dial, jacks and holders", () => {
    const m = makeMultimeter()
    for (const n of ["body", "screen", "dial", "jackRed", "jackBlack", "holderRed", "holderBlack"]) expect(m.getObjectByName(n)).toBeDefined()
  })
  it("dial turns to the mode angle", () => {
    const m = makeMultimeter()
    setMultimeterState(m, "A", "12,0 mA")
    expect(m.getObjectByName("dial")!.rotation.y).toBeCloseTo(METER_DIAL_ANGLE.A)
  })
})
