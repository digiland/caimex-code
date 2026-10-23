// caimex-code: Lighthouse isn't bundled here — it's a large dependency and part of the
// profiling set not ported yet. The audit fails with a message the agent can act on.
import type * as Browser from "./protocol"

export async function audit(
  ..._args: unknown[]
): Promise<{ scores: unknown[]; failures: unknown[]; files: Browser.FileID[] }> {
  throw new Error("Lighthouse audits aren't available in Caimex Code yet. Inspect the page with snapshot, console and network instead.")
}
