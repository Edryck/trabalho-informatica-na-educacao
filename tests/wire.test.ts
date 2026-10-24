import { describe, it, expect } from "vitest"
import { Vector3, type CurvePath, type LineCurve3 } from "three"
import { PITCH, wireCurve, wirePath } from "../src/parts3d"

const a = new Vector3(0, 0.6, 0)
const b = new Vector3(20, 0.6, 10)

describe("wirePath", () => {
  it("plain arc stays the old curve", () => {
    expect(wirePath(a, b, { style: "arc", mid: null }).getPoint(0.5)).toEqual(wireCurve(a, b).getPoint(0.5))
  })

  it("arc ends on both holes and passes over the dragged middle", () => {
    const mid = new Vector3(5, 0.6, -8)
    const path = wirePath(a, b, { style: "arc", mid })
    expect(path.getPoint(0).distanceTo(a)).toBeLessThan(1e-6)
    expect(path.getPoint(1).distanceTo(b)).toBeLessThan(1e-6)
    expect(path.getPoints(200).some((p) => Math.hypot(p.x - mid.x, p.z - mid.z) < 0.5)).toBe(true)
  })

  it("arc grows with the wire length", () => {
    const top = (end: Vector3) => Math.max(...wirePath(a, end, { style: "arc", mid: new Vector3(end.x / 2, 0.6, end.z / 2) }).getPoints(100).map((p) => p.y))
    expect(top(new Vector3(60, 0.6, 0))).toBeGreaterThan(top(new Vector3(15, 0.6, 0)))
  })

  it("angle uses axis-aligned straight pieces through the middle", () => {
    const mid = new Vector3(5, 0.6, -8)
    const path = wirePath(a, b, { style: "angle", mid }) as CurvePath<Vector3>
    const pieces = path.curves as LineCurve3[]
    for (const c of pieces) {
      const moved = [c.v1.x !== c.v2.x, c.v1.y !== c.v2.y, c.v1.z !== c.v2.z].filter(Boolean).length
      expect(moved).toBe(1)
    }
    const corners = pieces.map((c) => c.v2)
    expect(corners.some((p) => p.x === 5 && p.z === -8)).toBe(true)
    expect(path.getPoint(0).distanceTo(a)).toBeLessThan(1e-6)
    expect(path.getPoint(1).distanceTo(b)).toBeLessThan(1e-6)
    expect(Math.max(...corners.map((p) => p.y))).toBeGreaterThanOrEqual(0.6 + PITCH)
  })

  it("angle without a middle still connects both holes", () => {
    const path = wirePath(a, b, { style: "angle", mid: null })
    expect(path.getPoint(0).distanceTo(a)).toBeLessThan(1e-6)
    expect(path.getPoint(1).distanceTo(b)).toBeLessThan(1e-6)
  })
})
