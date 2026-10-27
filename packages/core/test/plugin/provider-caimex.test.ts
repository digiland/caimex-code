import { afterEach, describe, expect, test } from "bun:test"
import { normalizeLoginUrl } from "@opencode/core/plugin/provider/caimex"

// Caimex: sign-in links. The gateway advertises its old host in `verification_uri`; people
// approve the code on caimex.ai.
describe("caimex normalizeLoginUrl", () => {
  const saved = process.env["CAIMEX_LOGIN_URL"]
  afterEach(() => {
    if (saved === undefined) delete process.env["CAIMEX_LOGIN_URL"]
    else process.env["CAIMEX_LOGIN_URL"] = saved
  })

  test("moves the gateway's advertised link to caimex.ai, keeping the path and code", () => {
    delete process.env["CAIMEX_LOGIN_URL"]
    expect(normalizeLoginUrl("https://caimex.econetai.co.zw/activate?code=Q9NZ-86VX")).toBe(
      "https://caimex.ai/activate?code=Q9NZ-86VX",
    )
    expect(normalizeLoginUrl("https://caimex.econetai.co.zw:2082/activate")).toBe("https://caimex.ai/activate")
  })

  test("leaves links on other hosts alone", () => {
    delete process.env["CAIMEX_LOGIN_URL"]
    expect(normalizeLoginUrl("https://example.com/activate?code=X")).toBe("https://example.com/activate?code=X")
  })

  test("CAIMEX_LOGIN_URL overrides the sign-in origin", () => {
    process.env["CAIMEX_LOGIN_URL"] = "http://localhost:4200"
    expect(normalizeLoginUrl("https://caimex.econetai.co.zw/activate?code=X")).toBe(
      "http://localhost:4200/activate?code=X",
    )
  })
})
