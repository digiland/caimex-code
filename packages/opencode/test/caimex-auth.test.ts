import { describe, expect, test, mock, beforeEach, afterEach, afterAll } from "bun:test"

const opened: string[] = []
const openMock = () => ({ default: async (url: string) => { opened.push(url); return {} as any } })
mock.module("open", openMock)

// Bun runs every test file in one process, so anything installed on globalThis here
// leaks into all files that run after this one. Restore both the fetch stub and the
// "open" mock below, or later suites get this device-code response for every request.
const originalFetch = globalThis.fetch

const { CaimexAuthPlugin } = await import("../src/plugin/caimex")

const DEVICE = {
  device_code: "dc", user_code: "DV3K-V6VS",
  verification_uri: "https://gw.example/activate",
  verification_uri_complete: "https://gw.example/activate?code=DV3K-V6VS",
  expires_in: 900, interval: 5,
}

beforeEach(() => {
  opened.length = 0
  delete process.env.CAIMEX_NO_BROWSER
  globalThis.fetch = (async () => new Response(JSON.stringify(DEVICE), {
    status: 200, headers: { "content-type": "application/json" },
  })) as any
})

afterEach(() => {
  globalThis.fetch = originalFetch
  // The last test swaps in a throwing "open"; put the recording one back.
  mock.module("open", openMock)
})

afterAll(() => {
  globalThis.fetch = originalFetch
  mock.restore()
})

async function authorize() {
  const hooks = await CaimexAuthPlugin({} as any)
  const oauth = hooks.auth!.methods.find((m: any) => m.type === "oauth") as any
  return oauth.authorize()
}

describe("caimex login", () => {
  test("opens the code-prefilled URL and still prints the manual one", async () => {
    const r = await authorize()
    expect(opened).toEqual([DEVICE.verification_uri_complete])
    expect(r.instructions).toContain(DEVICE.verification_uri)
    expect(r.instructions).toContain("DV3K-V6VS")
  })

  test("CAIMEX_NO_BROWSER=1 suppresses the open", async () => {
    process.env.CAIMEX_NO_BROWSER = "1"
    const r = await authorize()
    expect(opened).toEqual([])
    expect(r.instructions).toStartWith("Open ")
  })

  test("a failing open() does not break login", async () => {
    mock.module("open", () => ({ default: async () => { throw new Error("no display") } }))
    const r = await authorize()
    expect(r.url).toBe(DEVICE.verification_uri_complete)
    expect(r.instructions).toContain("DV3K-V6VS")
  })
})
