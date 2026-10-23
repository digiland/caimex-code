// caimex-code: the pieces of Caimex Desktop's browser IPC the page code depends on.
import type * as Browser from "./protocol"

export const MAX_ICON_URL = 24_576

/** An element the user picked in the page, reported to the renderer. */
export type PaneElement = {
  ref: Browser.Ref
  selector: string
  label: string
  role?: string
  name?: string
  text?: string
  /** Border box in the native view's DIPs. */
  rect: { x: number; y: number; width: number; height: number }
}
