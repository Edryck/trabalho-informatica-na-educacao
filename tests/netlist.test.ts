import { describe, it, expect } from "vitest"
import * as netlist from "../src/netlist"

describe("setup", () => {
  it("imports netlist module in node", () => {
    expect(typeof netlist).toBe("object")
  })
})
