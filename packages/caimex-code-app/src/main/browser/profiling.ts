// caimex-code: performance profiling (traces, CPU profiles, heap snapshots, Lighthouse) is
// not ported yet — it's the largest and most specialised part of Caimex Desktop's browser.
// Every profiling operation fails with a clear message so the agent picks another route,
// instead of the page code needing to know profiling is missing.
import type { WebContents } from "electron"
import type * as Browser from "./protocol"

export type Recording = {
  owner: WebContents
  pid: number
  started: number
  timer?: ReturnType<typeof setTimeout>
  finish: () => Promise<{ id: Browser.FileID; durationMs: number; incomplete: boolean }>
}

const unsupported = () => {
  throw new Error(
    "Performance profiling (traces, CPU, heap, Lighthouse) isn't available in Caimex Code yet. Use snapshot, console, network and evaluate instead.",
  )
}

export function createProfiling(..._args: unknown[]) {
  return {
    target(_type: "trace" | "cpu"): Browser.Target {
      return { resources: [], key: "" }
    },
    startTrace: async (_durationMs?: number): Promise<void> => unsupported(),
    stopTrace: async (): Promise<{ id: Browser.FileID; durationMs: number; incomplete: boolean }> => unsupported(),
    startCpu: async (): Promise<void> => unsupported(),
    stopCpu: async (): Promise<{ id: Browser.FileID; durationMs: number }> => unsupported(),
    heap: async (): Promise<Browser.FileID> => unsupported(),
    analyze: async (_action: unknown): Promise<Record<string, unknown>> => unsupported(),
    dispose: async () => {},
  }
}
