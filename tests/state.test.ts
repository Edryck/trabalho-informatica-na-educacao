import { describe, it, expect } from "vitest"
import { createHistory, current, emptyDoc, nextInstanceId, pushSnapshot, redo, rewindTo, undo } from "../src/state"
import type { CircuitDoc, Instance } from "../src/state"

const inst = (id: string, type = "lamp"): Instance => ({ id, type, value: 0, actualValue: 0 })
const docWithIds = (ids: string[]): CircuitDoc => ({ ...emptyDoc(), instances: ids.map(id => inst(id)) })

describe("history", () => {
  it("caps at limit", () => {
    let h = createHistory(emptyDoc(), 3)
    for (let i = 0; i < 5; i++) h = pushSnapshot(h, docWithIds([`L${i}`]))
    expect(h.snapshots.length).toBe(3)
    expect(current(h).instances[0].id).toBe("L4")
  })

  it("push after undo drops the future", () => {
    const docA = docWithIds(["A1"])
    const docB = docWithIds(["B1"])
    const docC = docWithIds(["C1"])
    let h = pushSnapshot(pushSnapshot(createHistory(emptyDoc()), docA), docB)
    h = pushSnapshot(undo(h), docC)
    expect(redo(h)).toEqual(h)
    expect(current(h)).toEqual(docC)
  })

  it("undo and redo stop at the ends", () => {
    const h = createHistory(emptyDoc())
    expect(undo(h)).toEqual(h)
    expect(redo(h)).toEqual(h)
  })

  it("snapshots are independent copies", () => {
    const doc = docWithIds(["L1"])
    const h = pushSnapshot(createHistory(emptyDoc()), doc)
    doc.instances[0].id = "X9"
    expect(current(h).instances[0].id).toBe("L1")
  })

  it("rewinds to any index", () => {
    let h = createHistory(emptyDoc())
    h = pushSnapshot(h, docWithIds(["L1"]))
    h = pushSnapshot(h, docWithIds(["L2"]))
    expect(current(rewindTo(h, 1)).instances[0].id).toBe("L1")
    expect(rewindTo(h, 99).index).toBe(2)
  })
})

describe("nextInstanceId", () => {
  it("fills gaps", () => {
    expect(nextInstanceId(docWithIds(["L1", "L3"]), "L")).toBe("L2")
    expect(nextInstanceId(docWithIds([]), "B")).toBe("B1")
  })

  it("does not confuse prefixes", () => {
    expect(nextInstanceId(docWithIds(["LED1"]), "L")).toBe("L1")
  })
})
