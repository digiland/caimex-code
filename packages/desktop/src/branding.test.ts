import { expect, test } from "bun:test"
import { isDeepLink, toUpstreamDeepLink, wslInstallUrl } from "./branding"

test("accepts only caimex:// deep links", () => {
  expect(isDeepLink("caimex://open-project?directory=/tmp/demo")).toBe(true)
  expect(isDeepLink("opencode://open-project?directory=/tmp/demo")).toBe(false)
  expect(isDeepLink("--flag")).toBe(false)
})

test("rewrites caimex:// to the prefix the renderer parses", () => {
  expect(toUpstreamDeepLink("caimex://new-session?directory=/a&prompt=ship%20it")).toBe(
    "opencode://new-session?directory=/a&prompt=ship%20it",
  )
  expect(toUpstreamDeepLink("https://example.com")).toBe("https://example.com")
})

test("pins the WSL install script to the app's release", () => {
  expect(wslInstallUrl("1.4.0")).toBe("https://github.com/digiland/caimex-code/releases/download/v1.4.0/install.sh")
})
