// The browser protocol (version 4) between the Caimex daemon's browser plugin and the app
// that hosts the pages. Mirrors caimex-desktop packages/plugin-browser/src/rpc.ts as plain
// TypeScript types.
//
// The original is written with Effect Schema, which this repo can't share (it pins an
// older Effect whose Schema API differs). Nothing is lost by dropping it here: the daemon
// validates every command it sends and every result it receives, so the app only needs
// the shapes — not a second validator.

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_TEXT = 100_000

export type TabID = string & { readonly __brand?: "Browser.TabID" }
export type Ref = string & { readonly __brand?: "Browser.Ref" }
export type FileID = string & { readonly __brand?: "Browser.FileID" }

// The originals are branded schemas with a `make`; only `make` is used at runtime.
export const TabID = { make: (value: string) => value as TabID }
export const Ref = { make: (value: string) => value as Ref }
export const FileID = { make: (value: string) => value as FileID }

export type Tab = {
  id: TabID
  url: string
  title: string
  loading: boolean
  loadError?: string
  canGoBack: boolean
  canGoForward: boolean
  generation: number
}

export type State = { tabs: readonly Tab[]; focusedTabID: TabID | null }

export type FileInfo = { id: FileID; name: string; mime: string; bytes: number; path: string }

/** In memory the bytes are a Uint8Array; on the wire they travel as base64. */
export type File = { id: FileID; name: string; mime: string; data: Uint8Array }

export type ResourceType =
  | "document"
  | "stylesheet"
  | "image"
  | "media"
  | "font"
  | "script"
  | "xhr"
  | "fetch"
  | "eventsource"
  | "websocket"
  | "manifest"
  | "other"

export type Body =
  | { state: "notRequested" | "pending" | "empty" }
  | { state: "text"; text: string; truncated: boolean }
  | { state: "unavailable"; reason: "binary" | "notCaptured" | "backendUnavailable" }

type RequestFields = {
  id: string
  url: string
  method: string
  resourceType: ResourceType
  timestampMs: number
  statusCode?: number
}
export type NetworkRequest =
  | (RequestFields & { state: "pending" })
  | (RequestFields & { state: "completed"; durationMs: number })
  | (RequestFields & { state: "failed"; durationMs: number; failure: string })

export type ConsoleEntry = {
  id: string
  timestampMs: number
  level: "debug" | "info" | "warning" | "error"
  text: string
  textTruncated: boolean
  source?: { url: string; line: number; column: number }
}


// Field groups shared across operations, as in the original schema.
type TabArg = { tabID: TabID }
type FrameArg = { frameID?: string }
type TargetArg = TabArg & { ref: Ref }
type ArtifactArg = TabArg & { fileID: FileID }
type Limit = { limit?: number }
type TimeoutMs = { timeoutMs?: number }
type Level = ConsoleEntry["level"]

/** Every operation's arguments, by name. */
export type Operations = {
  "tabs.list": {}
  "tabs.open": { url?: string; focus?: boolean }
  "tabs.focus": TabArg
  "tabs.close": TabArg
  preview: { path: string }
  navigate: TabArg & { url: string }
  back: TabArg
  forward: TabArg
  reload: TabArg
  stop: TabArg
  frames: TabArg
  snapshot: TabArg & FrameArg & { ref?: Ref; depth?: number; boxes?: boolean }
  find: TabArg & FrameArg & { text: string }
  evaluate: TabArg & FrameArg & { ref?: Ref; script: string }
  click: TargetArg & {
    button?: "left" | "right" | "middle"
    count?: 1 | 2
    modifiers?: readonly ("Alt" | "Control" | "Meta" | "Shift")[]
  }
  hover: TargetArg
  drag: TabArg & { from: Ref; to: Ref }
  fill: TargetArg & { text: string }
  fill_form: TabArg & {
    fields: readonly (
      | { ref: Ref; type: "text"; value: string }
      | { ref: Ref; type: "select"; values: readonly string[] }
      | { ref: Ref; type: "check"; checked: boolean }
    )[]
  }
  select: TargetArg & { values: readonly string[] }
  check: TargetArg & { checked: boolean }
  press: TabArg & { key: string }
  scroll: TabArg & { deltaX?: number; deltaY: number }
  wait: TabArg & FrameArg & TimeoutMs & { condition: "load" | "text" | "textGone"; text?: string }
  screenshot: TabArg & {
    ref?: Ref
    fullPage?: boolean
    format?: "png" | "jpeg" | "webp"
    quality?: number
    maxWidth?: number
  }
  dialog: TabArg & { action: "get" | "accept" | "dismiss"; promptText?: string }
  "files.upload": TargetArg & { paths: readonly string[] }
  "files.drop": TargetArg & { paths: readonly string[] }
  "files.list": TabArg
  "files.get": ArtifactArg
  console: TabArg & Limit & { level?: Level }
  "network.list": TabArg & Limit & { urlContains?: string; resourceType?: ResourceType }
  "network.get": TabArg & { id: string; includeBody?: boolean; maxBodyChars?: number }
  "trace.start": TabArg & { durationMs?: number }
  "trace.stop": TabArg
  "trace.analyze": ArtifactArg & Limit
  "cpu.start": TabArg
  "cpu.stop": TabArg
  "cpu.analyze": ArtifactArg & Limit
  "heap.snapshot": TabArg
  "heap.summary": ArtifactArg & Limit
  "heap.query": ArtifactArg & Limit & { name?: string }
  "heap.object": ArtifactArg & Limit & { id: number }
  "heap.compare": TabArg & Limit & { before: FileID; after: FileID }
  lighthouse: TabArg
}

export type Method = keyof Operations

/** One operation and its arguments, tagged by `type`, as the daemon sends it. */
export type Action = { [M in Method]: { type: M } & Operations[M] }[Method]

/** Metadata the daemon sends with a permission decision: never page content. */
export type Target = { resources: readonly string[]; key: string }

export type Command = {
  action: Action
  generation?: number
  files: readonly File[]
  inspect?: boolean
  target?: Target
}

export type Result = { value: unknown; files: readonly File[] }

export type Outcome = { type: "success"; result: Result } | { type: "failure"; code: string; message: string }

export type Control =
  | { type: "attached"; connectionID: string; version: 4 }
  | { type: "command"; connectionID: string; requestID: string }
  | { type: "cancel"; connectionID: string; requestID: string }

/** The daemon's RPC id for the browser plugin. */
export const RPC_ID = "experimental.browser"
export const VERSION = 4
