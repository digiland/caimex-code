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

// The device-code response each test serves; reset per test so a case can hand
// back a different verification_uri without leaking into the next one.
let device: Record<string, unknown> = DEVICE

beforeEach(() => {
  opened.length = 0
  device = DEVICE
  delete process.env.CAIMEX_NO_BROWSER
  // These cases are about the browser-opening behaviour, not the origin
  // rewrite, so pin the login origin to the stub's own host and let the
  // normalization suite below cover the rewrite on its own.
  process.env.CAIMEX_LOGIN_URL = "https://gw.example"
  globalThis.fetch = (async () => new Response(JSON.stringify(device), {
    status: 200, headers: { "content-type": "application/json" },
  })) as any
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.CAIMEX_LOGIN_URL
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

// The gateway still advertises the retired :2082 sign-in origin, so the CLI
// pins the URL it opens to the canonical one.
describe("caimex login url", () => {
  const LEGACY = {
    ...DEVICE,
    verification_uri: "https://caimex.econetai.co.zw:2082/activate",
    verification_uri_complete: "https://caimex.econetai.co.zw:2082/activate?code=DV3K-V6VS",
  }

  test("drops the retired port from the opened and printed URLs", async () => {
    delete process.env.CAIMEX_LOGIN_URL // exercise the shipped default
    device = LEGACY
    const r = await authorize()
    expect(r.url).toBe("https://caimex.econetai.co.zw/activate?code=DV3K-V6VS")
    expect(opened).toEqual(["https://caimex.econetai.co.zw/activate?code=DV3K-V6VS"])
    expect(r.instructions).toContain("https://caimex.econetai.co.zw/activate")
    expect(r.instructions).not.toContain(":2082")
  })

  test("CAIMEX_LOGIN_URL redirects the browser at another deployment", async () => {
    process.env.CAIMEX_LOGIN_URL = "http://localhost:8240"
    device = LEGACY
    const r = await authorize()
    expect(r.url).toBe("http://localhost:8240/activate?code=DV3K-V6VS")
  })

  test("keeps a verification_uri that carries no port", async () => {
    delete process.env.CAIMEX_LOGIN_URL
    device = { ...DEVICE, verification_uri: "https://caimex.econetai.co.zw/activate", verification_uri_complete: undefined }
    const r = await authorize()
    expect(r.url).toBe("https://caimex.econetai.co.zw/activate")
  })

  test("passes an unparseable verification_uri through untouched", async () => {
    delete process.env.CAIMEX_LOGIN_URL
    device = { ...DEVICE, verification_uri: "not a url", verification_uri_complete: undefined }
    const r = await authorize()
    expect(r.url).toBe("not a url")
  })

  // Without this guard, pointing CAIMEX_GATEWAY_URL at a dev gateway would send
  // the developer's browser to the production sign-in page.
  test("leaves a non-Caimex gateway's URL alone when no override is set", async () => {
    delete process.env.CAIMEX_LOGIN_URL
    device = {
      ...DEVICE,
      verification_uri: "http://localhost:8240/activate",
      verification_uri_complete: "http://localhost:8240/activate?code=DV3K-V6VS",
    }
    const r = await authorize()
    expect(r.url).toBe("http://localhost:8240/activate?code=DV3K-V6VS")
    expect(r.instructions).toContain("http://localhost:8240/activate")
  })
})
