// Places browser pages (Electron WebContentsViews) in the window's layout.
//
// Caimex Desktop gets this from its extension SDK; this is the small part of that the
// browser actually uses. A page sits on top of the window's own web contents, so the
// renderer can't lay it out like an element — instead the renderer reports the rectangle
// the page should occupy (or that it's not on screen), and this keeps the native view
// matched to it.
import { type BrowserWindow, type NativeImage, type WebContentsView } from "electron"

export interface Embed {
  readonly id: string
  /** Page-side gate: the view shows only while the renderer lays it out AND this is on. */
  show(visible: boolean): void
  /** Runs when the view goes on or off screen. Returns a function that removes it. */
  on(event: "visible", handler: (visible: boolean) => void): () => void
  /** A still of the page; undefined while it isn't shown. */
  capture(): Promise<NativeImage | undefined>
  /** Removes the view from the window. */
  dispose(): void
}

export interface Embeds {
  create(view: WebContentsView, window: BrowserWindow): Embed
}

export type Rect = { x: number; y: number; width: number; height: number }

type Entry = {
  view: WebContentsView
  window: BrowserWindow
  /** The renderer is showing a slot for it, at `rect`. */
  laid: boolean
  /** The page side wants it shown. */
  wanted: boolean
  visible: boolean
  handlers: Set<(visible: boolean) => void>
}

export function createEmbeds() {
  const entries = new Map<string, Entry>()

  const sync = (entry: Entry) => {
    const visible = entry.laid && entry.wanted && !entry.window.isDestroyed()
    if (visible === entry.visible) return
    entry.visible = visible
    entry.view.setVisible(visible)
    for (const handler of entry.handlers) handler(visible)
  }

  const embeds: Embeds = {
    create(view, window) {
      const id = `embed_${crypto.randomUUID()}`
      const entry: Entry = { view, window, laid: false, wanted: false, visible: false, handlers: new Set() }
      entries.set(id, entry)
      view.setVisible(false)
      window.contentView.addChildView(view)
      return {
        id,
        show(visible) {
          entry.wanted = visible
          sync(entry)
        },
        on(_event, handler) {
          entry.handlers.add(handler)
          return () => entry.handlers.delete(handler)
        },
        async capture() {
          return entry.visible ? entry.view.webContents.capturePage() : undefined
        },
        dispose() {
          if (!entries.delete(id)) return
          if (!window.isDestroyed()) window.contentView.removeChildView(view)
          entry.handlers.clear()
        },
      }
    },
  }

  return {
    embeds,
    /**
     * The renderer reports where a page should sit (CSS pixels of the window's contents,
     * which are Electron's DIPs), or `null` once its slot is gone or hidden.
     */
    layout(id: string, rect: Rect | null) {
      const entry = entries.get(id)
      if (!entry) return
      if (rect && rect.width > 0 && rect.height > 0) {
        entry.view.setBounds({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
        entry.laid = true
      } else entry.laid = false
      sync(entry)
    },
    /** Hides every page in a window, e.g. while a dialog covers the pane. */
    hideAll(window: BrowserWindow) {
      for (const entry of entries.values())
        if (entry.window === window) {
          entry.laid = false
          sync(entry)
        }
    },
  }
}
