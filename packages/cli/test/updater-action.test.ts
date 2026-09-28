import { expect, test } from "bun:test"
import { action } from "../src/services/updater-action"

test("a newer release is offered", () => {
  expect(action("2.0.0", "2.0.1", "notify")).toBe("notify")
  expect(action("1.19.1", "2.0.0", "auto")).toBe("auto")
})

test("the same release is not offered", () => {
  expect(action("2.0.0", "v2.0.0", "notify")).toBe("none")
})

test("an older release is never offered", () => {
  expect(action("2.0.0", "1.19.1", "notify")).toBe("none")
  expect(action("2.10.0", "2.9.9", "auto")).toBe("none")
})
