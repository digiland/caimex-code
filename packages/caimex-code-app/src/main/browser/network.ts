// caimex-code: Caimex Desktop can route a tab's traffic through the server it's connected
// to, so pages reach the server's network when the daemon is remote. This app runs
// against the local daemon, so pages use this machine's network directly and the hook
// is always absent (`null`). Only the shape the page code references is kept.
import type { WebContents } from "electron"

export type BrowserNetwork = {
  attach(contents: WebContents): (() => void) | undefined
  icon(url: string): Promise<{ mime: string; data: Buffer } | undefined>
}
